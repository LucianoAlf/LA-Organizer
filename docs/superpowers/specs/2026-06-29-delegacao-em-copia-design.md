# Delegação "Em cópia" — Design

**Data:** 2026-06-29
**Origem:** Pedido da Fabíola (staff de cliente) via WhatsApp, 29/06. Dois áudios pedindo a mesma coisa: na hora de delegar, poder colocar **mais de uma pessoa** — especificamente, pôr o **gerente da unidade em cópia** de uma tarefa que é da Gabi, pra que o gerente também receba a cobrança e lembre a Gabi de executar.
**Autor:** Catraca (sessão revisor/implementador).

---

## 1. Problema

Hoje a delegação é estritamente **1-pra-1**: a coluna `tasks.assigned_to` guarda **um** colaborador.

- Modal "Novo → Delegar" ([QuickCreateSheet.tsx](../../../web/src/components/QuickCreateSheet.tsx)): seletor "PRA QUEM" único.
- "Delegar pra alguém" em tarefa existente ([DelegateTaskSheet.tsx](../../../web/src/components/DelegateTaskSheet.tsx)): seletor único; grava `assigned_to` + `delegated_to` + `status='delegated'`.
- TOM pelo WhatsApp ([engine.js ~5361](../../../src/engine.js), `parseTaskActions` action `delegate`): atualiza `assigned_to` único.

A Fabi não consegue colocar o gerente da unidade no circuito de cobrança de uma tarefa que é da Gabi.

## 2. Modelo conceitual (decisões do brainstorm)

Toda tarefa delegada tem:

- **1 executor** — quem faz e **conclui**. Continua sendo o `assigned_to`.
- **0..N pessoas "em cópia"** — acompanham e **cobram**, **não concluem**. Análogo ao CC do e-mail.

Decisões travadas com o Alf:

1. **Em cópia só acompanha e cobra.** Quem conclui é só o executor. Quando o executor conclui, a tarefa some para todos (como hoje). O observador nunca "faz" nem "fecha".
2. **O observador recebe o circuito completo de cobrança**, no tom "cobra a \<executor\>": aviso no momento em que entra em cópia + lembrete de prazo (mesma cadência da executora) + alerta de atraso.
3. **Escopo desta entrega: App + TOM de uma vez.** Colocar em cópia pelos modais do app **e** pedindo pro TOM no zap.
4. **Quem pode entrar em cópia: qualquer colaborador ativo** (não a lista restrita de delegáveis), porque o gerente da unidade pode não ser subordinado de quem delega.

## 3. Arquitetura

### 3.1 Dados — tabela `task_watchers` (camada aditiva)

Relação many-to-many tarefa ↔ observador. **`assigned_to` permanece único e intacto** → zero regressão nas queries que filtram por executor.

```sql
create table public.task_watchers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  collaborator_id uuid not null,         -- quem está em cópia
  added_by uuid,                         -- quem pôs em cópia
  created_at timestamptz not null default now(),
  unique (task_id, collaborator_id)
);
create index task_watchers_collab_idx on public.task_watchers (collaborator_id);
create index task_watchers_task_idx on public.task_watchers (task_id);
```

**RLS** (padrão da casa, via `current_collab_id()` — nunca `auth.uid()`, ver memória `collaborator.id ≠ auth.uid()`):
- SELECT: o próprio observador (`collaborator_id = current_collab_id()`) **ou** quem criou a tarefa (`added_by = current_collab_id()` / dono da tarefa).
- INSERT/DELETE: quem está delegando (dono/criador da tarefa) ou quem adicionou.
- O **engine escreve via service_role** (ignora RLS); `collaborator_id`/`added_by` vêm resolvidos no backend a partir do remetente, nunca de marker cru do LLM (memória `dado-sensível: RLS não basta no service_role`).

### 3.2 Visibilidade no app

- **Executor:** aba "Trabalho" — **inalterada**.
- **Delegador:** aba "Delegadas" — **inalterada**.
- **Em cópia:** **nova visão "Em cópia"** — leitura **separada** (hook próprio `useWatchedTasks` ou cláusula isolada), **sem** alterar a `.or()` central de [useAgendaTasks.ts](../../../web/src/screens/agenda/hooks/useAgendaTasks.ts) (risco #1 de regressão; a query central já é delicada — não mexer).
  - Query do observador: `tasks` onde `id in (select task_id from task_watchers where collaborator_id = me)`, com os mesmos filtros de status/visibilidade-do-dia que o resto.
  - Badge/rótulo "Em cópia" pra deixar claro que não é dele pra fazer.

### 3.3 Cobrança (dispatcher)

Os rituais que cobram tarefa com prazo ([dispatcher.js](../../../src/rituals/dispatcher.js): `checkDeadlineAlerts`, `checkOverdueAlerts`) passam a, **além** de notificar o executor, buscar os `task_watchers` da tarefa e disparar pra cada observador.

- **Tom da mensagem ao observador:** "cobra a \<executor\>" (acompanhamento), não "faça isso". Voz do TOM sagrada — só muda o destinatário e o enquadramento factual, não o jeito.
- **Dedup próprio** por `(task_id, collaborator_id_do_observador, dia, tipo)`. O claim atual (`notifications_alert_daily_uq`) é por `(collaborator, tipo, dia)`; como o observador é outro `collaborator_id`, gera linha distinta naturalmente — **verificar no banco** que a constraint não colide e que não duplica (memória: teste verde ≠ fix → checar o banco).
- **Cadência:** sai **junto** com a cobrança da executora (mesmo gatilho de prazo). Respeita quiet hours / DND **do observador**.
- **`reminder_lead`:** a cobrança ao observador espelha o **timing da tarefa** (mesma da executora). Não se cria um `reminder_lead` separado pro observador nesta fatia.
- **Aviso de entrada em cópia:** no momento em que alguém é posto em cópia (via app ou TOM), o observador recebe uma mensagem única "Você entrou em cópia: *\<tarefa\>* é da \<executor\>, prazo \<data\>. Fico te lembrando junto."

### 3.4 UI dos modais

Campo novo **"EM CÓPIA (opcional)"** — multi-seleção de pessoas com **chips** — logo abaixo do "PRA QUEM", em dois lugares:

1. [QuickCreateSheet.tsx](../../../web/src/components/QuickCreateSheet.tsx) (modal Novo → Delegar): novo state `ccIds: string[]`.
2. [DelegateTaskSheet.tsx](../../../web/src/components/DelegateTaskSheet.tsx) (tarefa existente): carrega os watchers atuais, permite adicionar/remover.

- **Fonte da lista:** **todos os colaboradores ativos** (exceto o executor já escolhido e o próprio usuário). Distinta de `delegableMembers` (que restringe não-diretores à própria equipe).
- **Componente:** multi-select de pessoas com chips. Reusar/derivar de um picker existente se houver (`AssigneePicker`/`CheckpointAssigneePicker`); senão, componente pequeno e focado `WatchersPicker`.
- **Persistência (app):** ao salvar a delegação, fazer o `update` do executor (como hoje) e o upsert/replace dos `task_watchers` (diff add/remove). Depois `notifyTaskDelegated(taskId)` (executor) + um aviso aos novos observadores.

### 3.5 TOM no zap (engine)

- **Marker de delegação** ganha campo opcional `cc` (lista de nomes/telefones). Ex.: "Delega pra Gabi e põe o gerente da unidade em cópia" → `assigned_to = Gabi` + inserir watchers resolvidos.
- **Nova ação "pôr em cópia" em tarefa existente** ("põe o Jereh em cópia nessa tarefa") — resolve a tarefa por short_id/contexto e insere watcher(s).
- Resolução de pessoa por nome reusa `resolveCollaboratorByName` / `findCollaboratorByPhone` (mesmo do delegate). Ambíguo/não encontrado → TOM pergunta, não chuta (anti-confabulação).
- **Skill de delegar** + **system prompt** atualizados pra expor a capacidade (mapa: "põe em cópia", "manda cópia pro gerente", "deixa o fulano acompanhando"). **Voz/tom intactos.**
- `.deploy-hold` na raiz **antes** de editar `src/`. Deploy do engine no checkpoint de produção com OK do Alf.

## 4. Fora de escopo (YAGNI)

- Notificar o observador "o executor concluiu" (a tarefa simplesmente some). Pode virar fatia futura.
- Sugerir automaticamente o gerente da unidade como cópia (pré-preenchido pela governança).
- Cópia em **tarefa de grupo** (`assigned_group_id`) e em **eventos/compromissos**.
- `reminder_lead` próprio por observador.
- Observador poder editar/concluir a tarefa.

## 5. Plano de validação

1. **Funções puras com TDD** (vitest no PWA) onde houver lógica derivável (ex.: diff de watchers add/remove; montagem da lista "em cópia"). Backend: helper puro pra montar a cobrança do observador, com teste.
2. **Migration + RLS:** aplicar, depois **provar no banco** (insert/select como observador e como dono) que a RLS deixa ler/gerenciar certo e bloqueia o resto.
3. **Dispatcher:** verificar **no banco** o dedup `(task, observador, dia, tipo)` — forçar a pré-condição e conferir que dispara 1x por observador, sem colidir com o claim da executora.
4. **Preview do app** (localhost:4173): modal Novo→Delegar e DelegateTaskSheet com o campo "Em cópia"; visão "Em cópia" do observador. Sem mutar dado real (ficha descartável / soft-cancel).
5. **E2E do engine na VPS** com ficha descartável: delegar com cópia via marker + pôr em cópia em tarefa existente; conferir watchers gravados e o aviso, **sem** WhatsApp real (soft-cancel).
6. Só então **deploy** (PWA via auto-deploy; engine via scp+pm2 no checkpoint com OK do Alf). Registrar known-issue/aprendizados.

## 6. Riscos

- **Regressão na agenda (risco #1):** mexer na `.or()` central de `useAgendaTasks`. Mitigação: leitura separada pra "Em cópia".
- **Dedup de cobrança:** colisão/duplicação no claim. Mitigação: chave de dedup por observador + verificação no banco.
- **Engine parser de delegação:** adicionar `cc` sem quebrar o `delegate` atual. Mitigação: campo opcional + TDD + E2E na VPS antes do deploy.

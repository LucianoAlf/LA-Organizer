# Modelos de Checklist reutilizáveis (Agenda + Grupos + TOM) — Design

**Data:** 2026-07-06 · **Demanda:** Jonathan ADM (via Alf) · **Status:** aprovado pelo Alf (brainstorm 06/07)

## Problema

O time ADM delega tarefas repetitivas que levam sempre o mesmo checklist (ex.: visita/experimental →
Vitória: *Mensagem enviada → Cliente respondeu → Visita agendada → Aluno fez a Experimental*).
Hoje os itens são digitados um a um a cada tarefa — atrito que faz o recurso não ser usado.

**Auditoria (90 dias, time ADM):** Clayton delegou 207 tarefas, Gabi 31, Krissya 14; Jhonatan criou
317 tarefas; uso de checklist ≈ zero (só Gabi 5 itens e Vitoria 7). A Vitoria montou na mão um
checklist "Ligar para aluno" com o MESMO formato de funil que o Jonathan pediu — o padrão já
existe organicamente, falta o atalho.

## Decisões (fechadas com o Alf)

1. **Compartilhados no time** — todo colaborador vê e usa os modelos de todos; edita/exclui só o
   criador ou coordenação. Sem escopo por departamento no v1 (organiza-se pelo nome, ex.
   "ADM — Experimental"); coluna de escopo entra depois se doer.
2. **App + TOM juntos** — o fluxo real do Jonathan é pelo WhatsApp; só-app não resolve.
3. **Criação inline + CRUD completo** — "salvar como modelo" onde a dor acontece; sheet de
   gestão com criar do zero, editar nome E itens, excluir. Sem tela/rota nova.
4. **NÃO reaproveitar `op_checklists`** — aquele motor (módulo /checklists) carrega cron,
   completions, threshold e anexos; os crons do dispatcher varrem a tabela (template lá dentro =
   risco de disparo fantasma). Reaproveitamos o padrão de UX, não o banco.

## Modelo de dados

Migration nova (Supabase `cesnbnrynvxvgdhfmaua`):

```sql
CREATE TABLE checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,  -- array de strings, ordem = posição
  created_by uuid NOT NULL REFERENCES collaborators(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX checklist_templates_name_uq ON checklist_templates (lower(trim(name)));
```

- **RLS** (espelhar padrão de tabela team-shared existente, ex. `event_categories`; lembrar:
  `collaborator.id ≠ auth.uid()` → usar `current_collab_id()`): SELECT para todo colaborador
  ativo; INSERT com `created_by = current_collab_id()`; UPDATE/DELETE para criador OU
  coordenação (`has_coord_permissions`/role coord+).
- **Seed** (na própria migration): "Aula Experimental (visita)" com os 4 itens do Jonathan e
  "Contato com aluno (cobrança)" com o funil da Vitoria (*Enviei mensagem → Aguardando
  resposta → Aluno respondeu/pagamento → Resolvido*). `created_by` = Admin.
- Excluir = DELETE físico (não afeta tarefas já criadas — os itens viram filhas independentes
  no momento do uso; o template não é referenciado depois).

## App (PWA)

**Superfície única: `QuickCreateSheet`** — abas Tarefa e Delegar. Cobre Agenda E Grupos
(workspace de grupos abre o mesmo sheet com `defaultGroupId`), mobile E desktop. Nenhuma
outra tela muda.

Novos arquivos:
- `web/src/lib/checklistTemplates.ts` — tipos + I/O (load/create/update/delete via supabase) +
  helper PURO `applyTemplate(draftItems: string[], templateItems: string[]): string[]`
  (append dos itens do modelo ao rascunho, sem duplicar item idêntico consecutivo).
- `web/src/lib/checklistTemplates.test.ts` — vitest do helper puro + validações de nome.
- `web/src/components/ChecklistTemplatesSheet.tsx` — sheet de gestão (CRUD completo):
  listar, criar do zero, editar nome/itens (adicionar/remover/reordenar ↑↓), excluir
  (ConfirmDialog). Botões de editar/excluir desabilitados quando não-criador e não-coord.

Mudanças em `QuickCreateSheet.tsx` (seção CHECKLIST, componente `ChecklistDraftField`):
- Acima do campo "Adicionar item…": `CustomSelect` **"Usar modelo…"** (size sm) com os
  modelos do time (react-query, `staleTime` 5min) + opção fixa **"Gerenciar modelos…"** que
  abre o `ChecklistTemplatesSheet`. Selecionar um modelo → `applyTemplate` no rascunho
  (itens continuam editáveis antes de criar).
- Quando `checklistDraft.length > 0`: link **"salvar como modelo"** → input de nome inline
  (Enter salva; erro de nome duplicado → toast amigável).
- DS obrigatório: CustomSelect/Button/ConfirmDialog/tokens; nada de `<select>` nativo.

## TOM (WhatsApp)

**Zero mudança em `engine.js`** — o create de TASK já materializa `subtasks:[...]`
(engine.js:5312) e o parser inline `services/checklist-parse.js` já existe.

Mudança só em `src/prompts/system.js`: no bloco de contexto de criação/delegação de tarefa,
injetar os modelos do time:

```
MODELOS DE CHECKLIST DO TIME (use quando o usuário pedir "com o checklist/modelo de X"):
• Aula Experimental (visita): ["Mensagem enviada", "Cliente respondeu", ...]
• ...
REGRA: ao usar um modelo, emita subtasks:[...] copiando os itens EXATAMENTE como listados
(sem parafrasear, sem omitir, sem acrescentar).
```

- Carregar via query única com cache curto no builder (mesmo padrão dos outros contextos).
- Atenção à transição do Mapa por intenção (ADR 2026-07-01): injetar no(s) bloco(s) que a
  montagem dirigida usa para intenção de tarefa/delegação; coordenar com o chat dono do
  engine se o ponto de injeção for ambíguo.
- Endurecimento futuro (fora do v1): resolver determinístico "com o modelo X" no engine
  (base: `checklist-parse.js`) se auditoria mostrar confabulação de itens.

## Testes / verificação

1. **Unit (vitest):** `applyTemplate` (append, dedup consecutivo, rascunho vazio) + validação
   de nome (trim, 2–80, duplicado).
2. **E2E preview (localhost:4173):** criar Delegada com modelo "Aula Experimental" → conferir
   NO BANCO as 4 filhas (`parent_task_id`, `sort_position`, `assigned_to` = delegado);
   salvar modelo novo → aparece no select; editar/excluir no sheet de gestão. Testar 375px e
   1440px. Dados de teste apagados ao final.
3. **E2E TOM (VPS):** mensagem real "cria tarefa teste com o checklist de experimental" numa
   conta de teste → conferir filhas no banco → apagar. Verificar logs pm2.
4. `tsc --noEmit` + `vite build` + testes existentes verdes (303 vitest).

## Fora de escopo (YAGNI)

- Aplicar modelo em tarefa JÁ criada (EditTaskSheet/TaskEditDrawer).
- Escopo por departamento/grupo; versionamento; soft-delete de modelos.
- Resolver determinístico no engine (só se confab aparecer).
- Integração com o módulo /checklists (`op_checklists`) — domínios distintos.

## Riscos

- **LLM parafrasear itens do modelo** no caminho TOM → mitigado pela regra "EXATAMENTE" +
  itens curtos; plano B determinístico documentado acima.
- **Concorrência com o chat do engine** → v1 não toca engine.js; system.js é edição pequena e
  localizada (mesmo padrão da devolutiva 02/07). Deploy do engine-side via scp cirúrgico.
- **Nome duplicado entre unidades** → índice único global + toast; convenção de prefixo no nome.

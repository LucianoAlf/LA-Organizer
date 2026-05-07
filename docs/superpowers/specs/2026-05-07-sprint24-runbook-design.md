# Sprint 23 — Primitivos de Projeto: Rationale, Runbook T-minus, Contingências

> Inspiração: app `musicolandia.netlify.app` (monoprojeto Matheus Felipe). Três primitivos
> desse app são superiores ao que ProjetoDetalhe/Checklists têm hoje e merecem virar
> conceito de primeira classe no LA Organizer.

**Status:** Design aprovado em 2026-05-07. Implementação posterior ao Sprint 21
(autogovernança) e Phase A do rollout de design system (ProjetoDetalhe/Checklists/NovoProjeto).

**Escopo:** schema + UI no ProjetoDetalhe e Checklists. Zero impacto no TOM (engine/dispatcher).

---

## §1. Motivação

Hoje no LA Organizer:
- Checkpoint só descreve **o que** fazer (lista de itens). Falta o **porquê** — sem isso,
  o colaborador não entende o sentido do CP, e erro pequeno em CP1 contamina CP2..N.
- Projetos `category = event` precisam de cronograma intra-dia (T-2h, T-1h, T-40min, ...),
  diferente do roadmap por data. Hoje a gente força isso em "tasks com horário", o que polui.
- Riscos de evento (criança chora, professor falta, instrumento quebra) ficam como observação
  solta no projeto. Sem protocolo prévio, decisão é tomada no calor — mal.

## §2. Primitivos novos

### §2.1. `checkpoints.rationale` (texto markdown curto)

Campo opcional em `project_checkpoints`. Renderizado no topo da lista de itens do CP, em
card destacado com ícone 💡 e título "POR QUE ESSE CHECKPOINT?". Markdown básico (parágrafos,
ênfase). Limite ~600 caracteres.

**Schema:**
```sql
ALTER TABLE project_checkpoints ADD COLUMN rationale text;
```

**UI:** ProjetoDetalhe → seção Checkpoints → cada CP expandido mostra `rationale` antes
dos itens, em surface levemente colorido (`bg-tom/5 border-l-2 border-tom`).

### §2.2. Runbook T-minus para projetos `event`

Novo conceito ortogonal a checkpoint: **bloco de runbook** com offset em minutos antes do
evento (negativo) ou após (positivo). Usado pra cronograma intra-dia ("2H ANTES — Chegada e
Estrutura", "10MIN — Check final"). Cada bloco tem itens checáveis próprios.

**Schema:**
```sql
CREATE TABLE event_runbook_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  offset_minutes int NOT NULL,    -- negativo = antes, positivo = depois
  label text NOT NULL,             -- "Chegada e Estrutura", "Abertura"
  description text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_runbook_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES event_runbook_blocks(id) ON DELETE CASCADE,
  text text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  position int NOT NULL DEFAULT 0
);
```

**UI:** ProjetoDetalhe → aba nova "Dia do Evento" (só visível se `category = 'event'` e
`event_date IS NOT NULL`). Lista vertical de blocos ordenados por `offset_minutes ASC`,
label tipo "2H ANTES" / "10MIN" / "ABERTURA" computado a partir de `offset_minutes`.

**Quando habilitar:** somente para `category = 'event'`. Usuário ativa via botão "Criar
runbook" na aba se ainda não tiver blocos.

### §2.3. `project_contingencies` (cenário × protocolo)

Pares "Se X acontecer → faça Y" definidos antes do evento, vivem no projeto.

**Schema:**
```sql
CREATE TABLE project_contingencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scenario text NOT NULL,          -- "Se criança chorar"
  protocol text NOT NULL,          -- "Responsável definido para retirar discretamente"
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**UI:** ProjetoDetalhe → seção dobrável "🚨 Contingências" abaixo dos checkpoints. Cards
empilhados (cenário em destaque, protocolo abaixo). Botão "+ Adicionar cenário".
Disponível para qualquer categoria, não só `event` (também útil em projetos pedagógicos
e operacionais).

## §3. O que NÃO entra

- Sync com Google Sheets (LA Organizer é fonte de verdade).
- Mapa de Equipe dinâmico estilo Musicolândia (a gente já tem `collaborators` + `roles`).
- Modo edit global (✎) — nosso fluxo de edição já é inline.
- Countdown card grande na Visão Geral (já temos `event_date` no ProjectCard).

## §4. Dependências

- Sprint 21 (autogovernança) deve estar deployado antes — schema e UI estabilizados.
- Phase A do design system (ProjetoDetalhe/Checklists/NovoProjeto) idealmente concluída
  antes — assim este sprint só adiciona conteúdo, não redesenha shell.

## §5. Critérios de sucesso

- CP com `rationale` mostra bloco 💡 acima dos itens; sem, não mostra nada (zero ruído).
- Projeto `event` ganha aba "Dia do Evento"; categorias outras não veem.
- Contingências disponíveis em qualquer projeto, opcional, dobrável.
- Migrations cumulativas, idempotentes (CREATE TABLE IF NOT EXISTS, ALTER ... ADD COLUMN IF NOT EXISTS).
- Zero alteração no TOM/dispatcher/engine.

## §6. Riscos

- **Inflar ProjetoDetalhe:** já é página densa. Mitigação: rationale só aparece quando
  preenchido, contingências dobrável colapsado por padrão, runbook em aba separada.
- **Confusão runbook vs checkpoint:** alguns usuários podem querer transformar CP em
  runbook. Documentar no NovoProjeto: CP = planejamento (datas), runbook = execução
  (offset do evento).
- **Migrations sem rollback claro:** scripts de DOWN não cobrem dados. Aceitável em dev;
  antes de prod, escrever DOWN explícito.

## §7. Próximo passo

Após user review deste spec → invocar `superpowers:writing-plans` pra fatiar em tasks
acionáveis (provável: 1 migration cumulativa + 3 fatias UI, uma por primitivo).

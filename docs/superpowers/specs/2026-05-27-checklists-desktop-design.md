# Checklists Desktop — Design Spec

**Data:** 2026-05-27
**Autor:** Luciano Alf + Claude (brainstorming superpowers)
**Status:** Aprovado para implementação
**Sprint estimada:** 9 sprints sequenciais em sessão única

---

## 1. Contexto

A página `/checklists` hoje é **mobile-only esticado pro desktop** — funciona, mas não aproveita o espaço, não tem fluxo de gestão e não diferencia visões de execução vs. aderência. Com a entrada das primeiras Farmers em produção (Gabi, Campo Grande), Checklists vira ferramenta diária crítica (Abertura/Fechamento Escola, Limpeza, Fiscalização Salas) e precisa ganhar tratamento de desktop equivalente ao que Agenda e Projetos receberam.

Manter mobile intocado nesta sprint — só adicionar versão desktop via dispatcher de breakpoint, idêntico ao padrão das outras telas. Mobile será revisitado em sprint posterior.

## 2. Persona e permissões

Liderança (director/coordinator/manager) e Farmers (collaborator) têm **os mesmos poderes** nesta primeira versão. A Gabi vê e gerencia templates igual a Alf. Quando a equipe crescer, a política `op_checklists_write_mgmt` (já existente) será endurecida — fora do escopo desta sprint, mas o spec documenta o caminho.

## 3. Arquitetura macro

```
/checklists                       ← rota principal
  ├─ Tab "Hoje" (default)         ← execução do dia (Trabalho + Pessoal)
  ├─ Tab "Aderência"              ← visão de gestão (toggle Cards|Tabela)
  └─ ⚙️ → /checklists/templates   ← admin de templates (rota separada)
```

Dispatcher de breakpoint em `screens/Checklists.tsx`:
```tsx
export function Checklists() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <ChecklistsMobile />;  // existente, renomeado
  return <ChecklistsDesktop />;                       // novo
}
```

## 4. Tela "Hoje" — execução

### Header
Faixa compacta horizontal (KpiStripe), 1 linha, 4 métricas:
- **X/Y feitas hoje** (do colaborador logado)
- **N pendentes** (próximos horários, ainda não disparados)
- **N atrasadas** (passou do `dispatch_time + 6h` sem 100%)
- **Aderência mês** — `instâncias completadas (completed_at IS NOT NULL e ≥ threshold) ÷ instâncias dispatchadas` nos últimos 30 dias, do colaborador logado

KPIs grandes (estilo Projetos/Credenciais) **rejeitados** — roubam espaço da execução. Faixa compacta dá feedback sem competir com a lista.

### Toggle interno
Chip horizontal: `💼 Trabalho (N)` ↔ `🏡 Pessoal (N)`. Foco numa coisa por vez. Mantém coerência com a estrutura mental do mobile.

### Lista + Drawer
Layout split (grid 2 colunas, ~40/60):
- **Esquerda:** lista de checklists do dia (CompactRow estilo Agenda)
- **Direita:** `ChecklistExecucaoDrawer` — abre ao clicar num item, padrão `DetailDrawer` da Agenda

### Drawer de execução — features
1. **Itens marcáveis** com checkbox grande, click toggle
2. **Nota/observação** por item (campo `notes` já em `op_checklist_item_completions.notes`)
3. **Item ad-hoc** — botão `+ adicionar item` no fim (vai pra `op_checklist_completion_extra_items`). Criador pode editar a descrição e remover o próprio item ad-hoc enquanto o checklist não está fechado
4. **Foto/anexo** — botão 📎 por item, upload pra `checklist_attachments` (Supabase Storage)
5. **Criar tarefa derivada** — botão `🪄 gerar tarefa` por item (cria task com link em `op_checklist_item_completions.derived_task_id`)
6. **Justificar não-execução** — botão único pelo checklist todo (campo `op_checklist_completions.justification`)

## 5. Tela "Aderência" — gestão

### Filtros
Chips horizontais: **Hoje | Semana | Mês** + filtro lateral de unidade.

### View toggle
Botão no canto superior direito alterna entre:

**Cards (default)** — grid 2 colunas, um card por template:
- Donut % completion do dia
- Avatares dos colaboradores (verde = fez, vermelho = atrasou, neutro = pendente)
- Sparkline mensal pequeno
- Card é **visual-only nesta sprint** (sem drill-down). Click pra detalhe individual fica como iteração futura (seção 15)

**Tabela** — densa estilo Excel:
- Linhas: template × colaborador (uma linha por combinação)
- Colunas: Template | Colaborador | Horário | Status (badge) | Progresso (X/Y · %)

Ambas vistas usam mesma query agregada, só renderizam diferente.

**Mobile vai receber só Cards na sprint futura.** Tabela é desktop-only por natureza.

## 6. Templates — `/checklists/templates`

Rota separada. Layout split idêntico ao Hoje:
- **Esquerda:** lista de templates (toggle ativo/inativo, nome, função, horário)
- **Direita:** `TemplateEditDrawer` com form completo

### Campos do template
- Nome
- Horário (dispatch_time)
- Dias da semana (`days_of_week`)
- Função (`function_role`)
- Turno (`shift`)
- Unidade (`unit`)
- Threshold de completion (% pra considerar feito — default 100)
- Responsável (`responsible_id`, opcional — pessoa específica)
- Líder (`leader_id`, pra escalação)
- **Itens** (lista ordenável via DnD, igual mobile)

## 7. Listas pessoais — recorrência

Novidade do escopo. Tipos:
- **once** — uma vez (comportamento atual)
- **daily** — todo dia
- **weekly** — escolhe dias da semana (`days_of_week: int[]`)
- **monthly** — escolhe dia do mês (`day_of_month: int`)

Componente `RecurrenceField.tsx` com chips de recorrência + sub-campos condicionais.

**Não passa pelo WhatsApp.** Listas pessoais ficam privadas no PWA. TOM só vê via system prompt (read-only context).

## 8. Banco de dados — migrations

### 8.1 Recorrência em listas pessoais

```sql
ALTER TABLE personal_checklists
  ADD COLUMN recurrence_type text DEFAULT 'once'
    CHECK (recurrence_type IN ('once','daily','weekly','monthly')),
  ADD COLUMN days_of_week int[] NULL,
  ADD COLUMN day_of_month int NULL
    CHECK (day_of_month BETWEEN 1 AND 31);
```

### 8.2 Completions de listas pessoais recorrentes

```sql
CREATE TABLE personal_checklist_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES personal_checklists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  reference_date date NOT NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  channel text DEFAULT 'pwa',
  created_at timestamptz DEFAULT now(),
  UNIQUE (checklist_id, user_id, reference_date)
);

CREATE TABLE personal_checklist_item_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid NOT NULL REFERENCES personal_checklist_completions(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES personal_checklist_items(id) ON DELETE CASCADE,
  is_checked boolean DEFAULT false,
  checked_at timestamptz NULL,
  notes text NULL,
  derived_task_id uuid NULL REFERENCES tasks(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (completion_id, item_id)
);
```

RLS: só `auth.uid() = user_id`.

### 8.3 Anexos genéricos

```sql
CREATE TABLE checklist_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('work','personal')),
  item_completion_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_checklist_attachments_lookup
  ON checklist_attachments (scope, item_completion_id);
```

RLS:
- `work`: dono do `op_checklist_completion` pode SELECT/INSERT/DELETE.
- `personal`: dono do `personal_checklist_completion` pode SELECT/INSERT/DELETE.

### 8.4 Tarefa derivada (work)

```sql
ALTER TABLE op_checklist_item_completions
  ADD COLUMN derived_task_id uuid NULL REFERENCES tasks(id);
```

### 8.5 Supabase Storage

Bucket `checklist-attachments`:
- Path pattern: `{scope}/{item_completion_id}/{uuid}-{filename}`
- Acesso público: NÃO. Signed URLs com TTL curto.
- Mime types permitidos: image/jpeg, image/png, image/webp, application/pdf.
- Tamanho máximo por arquivo: 10MB.

## 9. Integração com TOM

### 9.1 Continua funcionando

- `dispatchChecklists()` em `src/rituals/dispatcher.js` — cria completions no horário e manda WhatsApp.
- `<<CHECKLIST_ACTION>>` marker em `src/engine.js` — TOM marca itens.
- Escalação 6h + 20min.
- `op_checklists` é fonte de verdade — TOM e PWA leem da mesma tabela.

### 9.2 Adições

**Bidirecional via Realtime:**
- PWA marca item → `op_checklist_item_completions` UPDATE → broadcast Realtime
- TOM lê estado atual no próximo turno do colaborador (system prompt já carrega completions)
- PWA recebe broadcast e atualiza UI sem reload

Subscriber atual em `src/realtime/tom-realtime.js` já cobre `op_checklist_completions`. Ampliar para:
- `op_checklist_item_completions`
- `personal_checklist_item_completions`
- `checklist_attachments`

### 9.3 Skills novas do TOM (Sprint 7)

| Skill | Marker | Comportamento |
|---|---|---|
| `checklists-anexo.md` | `<<CHECKLIST_ATTACHMENT>>` | Colaborador manda foto → TOM pergunta "qual item?" → persiste em `checklist_attachments` |
| `checklists-tarefa-derivada.md` | `<<DERIVE_TASK>>` | Colaborador menciona problema em item ("lâmpada queimada") → TOM oferece criar task → cria + linka via `derived_task_id` |
| `checklists-justificar.md` | `<<CHECKLIST_JUSTIFY>>` | Colaborador diz "hoje não fiz porque X" → TOM persiste em `op_checklist_completions.justification` |

### 9.4 Listas pessoais

`dispatchPersonalRecurrentes()` em `src/rituals/dispatcher.js`:
- Roda 1×/dia às 00:30 BRT
- Pra cada `personal_checklists` com `recurrence_type != 'once'` ativa
- Verifica match (daily / weekly / monthly)
- Cria `personal_checklist_completions` se ainda não existe
- **Não dispara WhatsApp** — listas pessoais ficam só no PWA

TOM **lê** completions pessoais no system prompt (read-only context) para responder perguntas tipo "o que eu fiz hoje?", mas **não dispara** lembretes via WhatsApp.

## 10. Componentes

### Novos (em `web/src/screens/checklists/`)

| Arquivo | Responsabilidade |
|---|---|
| `ChecklistsDesktop.tsx` | Dispatcher tabs + KPI strip + roteamento interno |
| `HojeTab.tsx` | Toggle Trabalho/Pessoal + lista + drawer execução |
| `ChecklistExecucaoDrawer.tsx` | Drawer direito: itens marcáveis + nota + ad-hoc + ações |
| `AderenciaTab.tsx` | View toggle + filtros |
| `AderenciaCards.tsx` | Grid de cards (donut + avatares + sparkline) |
| `AderenciaTabela.tsx` | Tabela densa (template × colaborador) |
| `TemplatesPage.tsx` | Rota /checklists/templates — lista + drawer edição |
| `TemplateEditDrawer.tsx` | Form edição: nome, horário, dias, função, itens DnD |
| `KpiStripe.tsx` | Faixa compacta horizontal (4 métricas) |
| `RecurrenceField.tsx` | Chips Uma vez/Diária/Semanal/Mensal + dias |
| `ChecklistAttachments.tsx` | Upload + thumbnail por item |
| `JustifyDialog.tsx` | Modal pra justificativa |
| `DeriveTaskDialog.tsx` | Modal pra criar tarefa derivada |

### Hooks novos (em `web/src/screens/checklists/hooks/`)

- `useChecklistsHoje()` — query React Query: completions de hoje (trabalho + pessoal)
- `useAderencia(range)` — query agregada por template
- `useTemplates()` — CRUD de `op_checklists`
- `useChecklistAttachments(itemCompletionId, scope)` — Supabase Storage
- `useDeriveTask()` — mutation que cria task vinculada

### Patches em arquivos existentes

- `Checklists.tsx` (existente) — vira dispatcher mobile/desktop, renomeia versão atual pra `ChecklistsMobile.tsx`
- `App.tsx` (router) — adiciona rota `/checklists/templates`

## 11. Plano de sprints

| Sprint | Escopo | Critério de pronto |
|---|---|---|
| **S1 — Base + Migrations** | Migrations 8.1–8.4, bucket Storage 8.5, RLS | Migrations aplicadas + bucket criado + tabela responde aos selects esperados |
| **S2 — Dispatcher + Hoje (estrutura)** | `ChecklistsDesktop.tsx`, tabs, `KpiStripe`, `HojeTab` (toggle + lista, sem drawer ainda) | Tela abre no desktop, toggle funciona, KPIs calculados |
| **S3 — Drawer execução completo** | `ChecklistExecucaoDrawer` com todas as 6 features (marcar, nota, ad-hoc, foto, tarefa derivada, justificar) | Marca item, persiste, item ad-hoc OK, anexo OK, gera tarefa OK |
| **S4 — Aderência** | `AderenciaTab` com toggle Cards/Tabela, filtros (Hoje/Semana/Mês) | Cards mostram dados reais, tabela cruzada, filtros funcionam |
| **S5 — Templates** | `/checklists/templates` + lista + `TemplateEditDrawer` (DnD de itens, dispatch_time, days_of_week, role, unit) | Cria/edita/ativa template, itens reordenáveis, salva |
| **S6 — Cron recorrentes pessoais** | `dispatchPersonalRecurrentes()` em rituals, sem WhatsApp + `RecurrenceField` no Sheet pessoal | Cron roda, cria completions pessoais conforme recorrência |
| **S7 — TOM Skills novas** | `checklists-anexo.md`, `checklists-tarefa-derivada.md`, `checklists-justificar.md`, parsers no engine.js, deploy VPS | Mandar foto → persiste, "abre tarefa" → cria task, "não fiz porque X" → justifica |
| **S8 — Realtime sync** | Subscriber em item_completions (work + personal) + attachments | Marcar via WhatsApp atualiza PWA instantâneo, e vice-versa |
| **S9 — Polimento mobile** | Garantir mobile não quebrou + portar Cards de Aderência pro mobile | Mobile @ 375px funcional |

### Critério de fechamento de cada sprint

1. `npx tsc --noEmit` zero erros
2. `npx vite build` zero warnings críticos
3. `node --check src/<arquivos>.js` zero erros (sprints com backend)
4. Chrome MCP validation no Simple Browser (screenshots de cada tela nova)
5. Smoke test funcional manual (Claude via Chrome MCP)
6. Commit (auto-deploy hook) + push manual se necessário
7. SCP `src/*` + `pm2 restart tom` se sprint mexer no engine
8. Aprovação humana antes de seguir pra próxima sprint

## 12. Considerações de segurança

- **RLS em `checklist_attachments`** — fundamental, pois lista pessoal contém dados sensíveis
- **Signed URLs com TTL curto** (5 minutos) pra anexos
- **Mime type whitelist** — só image/* e application/pdf
- **Sanitização de filename** antes de salvar no Storage
- **Threshold de tamanho** — 10MB por arquivo, evita abuso
- **Permissões de template** mantêm o status quo (qualquer authenticated). Documenta plano de endurecer.

## 13. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Realtime overload com muitos eventos | Throttle no subscriber, batch updates de UI |
| Upload de anexo lento em conexão ruim | Progress UI + retry automático |
| TOM marcar item via WhatsApp e PWA não saber | Realtime subscription (S8) resolve |
| Quebrar mobile durante refactor | Manter `ChecklistsMobile.tsx` intocado + breakpoint dispatcher |
| Migrations falhando em prod | Aplicar primeiro via branch Supabase, testar, depois merge |

## 14. Métricas de sucesso

- Gabi consegue executar Abertura Escola via desktop em < 60s
- Aderência da Gabi sobe pra > 90% após 1 semana de uso
- Tempo de criação de novo template cai de "impossível no app" pra < 2 min
- Bidirecional WhatsApp↔PWA tem latência < 3s

## 15. Out of scope (sprints futuras)

- Aderência por colaborador individual (drill-down do card)
- Análises temporais (gráfico de evolução de aderência)
- Templates com sub-tasks ou dependências entre itens
- Modo offline com sync posterior
- Mobile redesign completo (sprint dedicada)
- Endurecimento de RLS de templates
- Notificações push do PWA (substituir lembrete WhatsApp por push pra quem instalou)

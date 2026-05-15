# Janela Temporal Mensal — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expandir o contexto temporal do TOM de 7 dias para o mês calendário completo (dia 1 ao último dia do mês atual), com resumo compacto por categoria + comparativos com o mês anterior.

**Architecture:** Camada mensal separada (`buildMonthlyContext()`) injetada ao lado do contexto 7-day detalhado existente. Ativada por detecção de palavras-chave mensais na mensagem recebida OU nos últimos 7 dias do mês (always-on). Formato: stats compactas + destaques — nunca lista completa de itens. O contexto 7-day detalhado permanece inalterado.

**Tech Stack:** Node.js (CommonJS), Supabase JS Client (service_role), America/Sao_Paulo TZ, `src/prompts/system.js`, `src/engine.js`

---

## 1. Janela de Tempo

- **Mês atual:** `YYYY-MM-01` até `YYYY-MM-{último dia}` (calculado dinamicamente)
- **Mês anterior:** mesmo cálculo para o mês precedente (para comparativos)
- **Timezone:** America/Sao_Paulo — todos os limites calculados em BRT, não UTC
- **Futuro do mês:** eventos e tarefas com data futura dentro do mês atual são incluídos (TOM pode dizer "ainda tem 3 eventos esse mês")

---

## 2. Trigger de Ativação

O contexto mensal é injetado quando **qualquer** das condições é verdadeira:

### 2a. Detecção por keyword (em `selectSkill` / antes de `buildContext`)

```js
const monthlyContextRe = /\b(esse\s+m[eê]s|este\s+m[eê]s|no\s+m[eê]s|do\s+m[eê]s|m[eê]s\s+atual|m[eê]s\s+passado|ao\s+longo\s+do\s+m[eê]s|mensal|balan[çc]o|resumo\s+do\s+m[eê]s|como\s+(?:foi|est[áa]|fui|estou)\s+(?:esse|este|o)\s+m[eê]s|o\s+que\s+fiz\s+esse\s+m[eê]s|produtividade|quanto\s+eu\s+fiz|evolui|evoluindo|meta\s+do\s+m[eê]s|estou\s+bem\s+(?:esse|este)\s+m[eê]s)\b/i;
```

### 2b. Always-on nos últimos 7 dias do mês

```js
const dayOfMonth = parseInt(todayISO.slice(8), 10);
const daysInMonth = new Date(year, month, 0).getDate(); // último dia
const isEndOfMonth = dayOfMonth >= (daysInMonth - 6);
```

Se `monthlyContextRe.test(lastUserMessage)` **ou** `isEndOfMonth`, injeta `buildMonthlyContext()`.

---

## 3. Dados Consultados

Função: **`buildMonthlyContext(collaboratorId, monthStart, monthEnd, lastMonthStart, lastMonthEnd)`**

| Categoria | Tabela | Filtro |
|---|---|---|
| Eventos | `calendar_events` | `date BETWEEN monthStart AND monthEnd AND collaborator_id = id` |
| Tarefas concluídas | `tasks` | `status = 'done' AND assigned_to = id AND (completed_at OR due_date) BETWEEN monthStart AND monthEnd` |
| Tarefas pendentes | `tasks` | `status NOT IN ('done','cancelled') AND assigned_to = id AND due_date BETWEEN monthStart AND monthEnd` |
| Hábitos | `habit_logs` | `date BETWEEN monthStart AND monthEnd AND collaborator_id = id` |
| Checklists | `op_checklist_completions` | `reference_date BETWEEN monthStart AND monthEnd AND (collaborator_id = id OR justified_by_id = id)` |

**Nota:** As queries mensais são feitas em paralelo via `Promise.all`, em chamada separada das queries 7-day existentes. Não substitui as queries atuais.

### Lógica de `completed_at` para tarefas

Muitas tasks têm `completed_at = null` (campo ainda não populado universalmente). Fallback:
```js
// Se completed_at IS NULL e status='done', usar due_date como proxy
// Só inclui no mês se due_date BETWEEN monthStart AND monthEnd
```

---

## 4. Formato de Output (injetado no contexto)

```
📅 *Maio 2026 — mês completo (1–31):*
• Eventos: 8 agendados (3 passados | 5 futuros)
• Tarefas: 12 ✅ concluídas | 4 ⏳ pendentes | 1 🔴 atrasada
• Hábitos: 18 registros em 15 dias (meta: diário)
• Checklists: 45/52 cumpridos (87%)
📊 vs abril: tarefas +20% | hábitos ↑3 dias | checklists -5%
```

### Regras de renderização

1. **Nunca listar itens individualmente** — só stats. TOM pode detalhar se o usuário pedir.
2. **Dias parciais:** se `today < endOfMonth`, mostrar "1–15 de 31" para clareza.
3. **Comparativo:** exibir só as categorias com dado suficiente no mês anterior (mínimo: ≥3 itens no mês anterior).
4. **Zero itens:** omitir categoria completamente (não mostrar "Hábitos: 0").

---

## 5. Integração em `buildContext()`

### 5a. Assinatura (adição de parâmetro)

```js
function buildContext(
  collab, memories, prefs, tasks, projects, lastMsgAge,
  habits, events, delegatedTasks, todayChecklists,
  teamAdherence, personalChecklists, teamTodayChecklists,
  teamExpectedTemplates, schoolEvents = [], eventTypes = [],
  doneFutureTasks = [],
  monthlyContext = null   // ← NOVO
) {
```

### 5b. Posição de injeção no prompt

O bloco mensal é injetado **imediatamente após** o bloco de tarefas do dia (antes de eventos):

```js
// Após renderização de tasks e doneFutureTasks:
if (monthlyContext) {
  lines.push('', monthlyContext);
}
// Depois vêm eventos, hábitos, etc.
```

### 5c. Call site em `fetchCollaboratorContext()`

```js
// Após Promise.all das queries 7-day:
let monthlyContext = null;
if (opts.includeMonthlyContext) {
  monthlyContext = await buildMonthlyContext(id, monthStart, monthEnd, lastMonthStart, lastMonthEnd);
}
// ...
return { ..., monthlyContext };
```

### 5d. Cálculo das datas mensais (em BRT)

```js
function getMonthBounds(todayISO) {
  const [y, m] = todayISO.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${y}-${String(m).padStart(2,'0')}-${lastDay}`;
  // Mês anterior
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const pmLastDay = new Date(py, pm, 0).getDate();
  const lastMonthStart = `${py}-${String(pm).padStart(2,'0')}-01`;
  const lastMonthEnd   = `${py}-${String(pm).padStart(2,'0')}-${pmLastDay}`;
  return { monthStart, monthEnd, lastMonthStart, lastMonthEnd };
}
```

---

## 6. Detecção de Keyword em `engine.js`

O flag `includeMonthlyContext` é calculado **antes** de chamar `fetchCollaboratorContext()`:

```js
const monthlyContextRe = /\b(esse\s+m[eê]s|este\s+m[eê]s|no\s+m[eê]s|do\s+m[eê]s|m[eê]s\s+atual|m[eê]s\s+passado|ao\s+longo\s+do\s+m[eê]s|mensal|balan[çc]o|resumo\s+do\s+m[eê]s|como\s+(?:foi|est[áa]|fui|estou)\s+(?:esse|este|o)\s+m[eê]s|o\s+que\s+fiz\s+esse\s+m[eê]s|produtividade|quanto\s+eu\s+fiz|evolui|evoluindo|meta\s+do\s+m[eê]s|estou\s+bem\s+(?:esse|este)\s+m[eê]s)\b/i;

const dayOfMonth = parseInt(todayISO.slice(8), 10);
const daysInMonth = new Date(parseInt(todayISO.slice(0,4)), parseInt(todayISO.slice(5,7)), 0).getDate();
const isEndOfMonth = dayOfMonth >= (daysInMonth - 6);

const includeMonthlyContext = monthlyContextRe.test(lastUserMessage || '') || isEndOfMonth;

const ctx = await fetchCollaboratorContext(collaboratorId, { includeMonthlyContext });
```

---

## 7. Novo Marker: `<<MONTHLY_PLAN>>` (já existente)

O marker `<<MONTHLY_PLAN>>` já existe na lista de markers válidos (BLOCK_RULES linha 21). Não são necessários novos markers para esta feature.

---

## 8. O que NÃO muda

- Janela de 7 dias para contexto detalhado diário — **inalterada**
- Queries existentes de tasks, events, habits — **sem alteração**
- Frontend (PWA) — **sem alteração**
- TOM engine (`processMessage`) — só recebe o flag `includeMonthlyContext` antes de chamar fetch
- Dispatcher (`rituals/dispatcher.js`) — **sem alteração**
- Nenhuma nova tabela ou migração de banco de dados

---

## 9. Limitações conhecidas (aceitas)

- `completed_at` não populado em tasks antigas → usa `due_date` como proxy (pode distorcer levemente o mês de conclusão)
- Comparativo omitido quando mês anterior tem <3 itens (evita % sem significado)
- Sem contexto mensal para delegados (tarefas atribuídas a outros) nesta versão — possível expansão futura
- Sem team monthly view nesta versão (sub-feature separada)

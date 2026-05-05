# Sprint 21 — Autogovernança Guiada — Design Técnico

**Data:** 2026-05-05
**Status:** aprovado pelo PO (consenso 3 vozes — Alf, OpenClaw, Claude — com 8 ajustes obrigatórios)
**Princípio mãe:** transformar TOM em parceiro de autogovernança da liderança através de rituais mensais, captura de lista mental e feedback de progresso contextual. Reúsa frameworks existentes (Eisenhower implícito via `priorizacao-inteligente`, 5W2H via `cadastro-projeto-5w2h`, planejamento semanal). Sem refatorar o que funciona.

---

## 1. Goal

Implementar a camada de autogovernança do TOM:
- 2 rituais mensais (planejamento + fechamento) cadenciados automaticamente para a liderança
- Skill nova de **lista mental** (dump batch + classificação + persistência via markers existentes)
- Helper genérico de progresso (`computeProgress`) com barrinhas contextuais nos rituais
- Camada **TOM-instrutor** transversal — explica rituais na 1ª vez e quando user pergunta
- Captura retroativa contextual no fechamento diário (condicional por sinal, não obrigatória)
- Limite suave anti-relay (5/destinatário/dia → aviso, não bloqueio)

## 2. Architecture

- **Schema:** 1 tabela nova (`monthly_plans`) + 2 colunas em `user_preferences` + 1 ALTER em `tasks.source` CHECK. **`ritual_logs.status` é texto livre — NÃO adicionar CHECK constraint** (ajuste 1).
- **Engine:** 5 helpers novos em `src/engine.js` + 1 função de marker (`applyMonthlyPlan`).
- **Skills:** 3 novas (`lista-mental.md`, `planejamento-mensal.md`, `fechamento-mensal.md`) + 3 blocos novos em `rituais-diarios.md`. Demais skills intactas.
- **Dispatcher:** 2 blocos novos (`checkMonthlyPlanning`, `checkMonthlyClosing`) com helpers de calendário.
- **Markers:** 1 novo (`<<MONTHLY_PLAN>>`). Demais reutilizados (`<<TASK_UPDATE>>`, `<<EVENT_CREATE>>`, `<<MEMORY_SAVE>>`, `<<PROJECT_CREATE>>`).
- **PWA:** sem alteração nesta sprint (Sprint 22 cuida da governança visual).

---

## 3. Schema Changes (migration cumulativa)

### 3.1 Nova tabela `monthly_plans`

```sql
CREATE TABLE monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  goals text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','skipped')),
  tasks_planned integer NOT NULL DEFAULT 0,
  tasks_completed integer NOT NULL DEFAULT 0,
  completion_rate numeric NOT NULL DEFAULT 0,
  retrospective_notes text,
  wins text[] NOT NULL DEFAULT '{}',
  carry_over_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collaborator_id, month_start)
);
ALTER TABLE monthly_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON monthly_plans FOR ALL USING (true);
CREATE POLICY "auth_read_own" ON monthly_plans FOR SELECT TO authenticated
  USING (collaborator_id = current_collab_id() OR current_collab_role() IN ('coordinator','director'));
CREATE POLICY "auth_write_own" ON monthly_plans FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());
```

### 3.2 Estender `tasks.source` CHECK (ajuste extra)

Valores atuais: `manual, agent_briefing, agent_closing, checkpoint_decomposition, coordinator_assignment, system`.
Adicionar: `mental_dump`, `retroactive_capture`.

```sql
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual','agent_briefing','agent_closing',
                    'checkpoint_decomposition','coordinator_assignment',
                    'system','mental_dump','retroactive_capture'));
```

### 3.3 `user_preferences` — 2 colunas novas (ajuste 2)

Apenas **horário** é configurável por pessoa. Cadência/dia (1ª segunda + última sexta) é default global no MVP.

```sql
ALTER TABLE user_preferences
  ADD COLUMN monthly_planning_time time NOT NULL DEFAULT '07:00',
  ADD COLUMN monthly_closing_time  time NOT NULL DEFAULT '18:00';
```

### 3.4 `ritual_logs.status` — NÃO MEXER (ajuste 1)

`ritual_logs.status` é **texto livre** no banco (sem CHECK constraint, verificado via query). Valores em uso atual: `sent`, `skipped`, `error`, `ignored`.

**Decisão:** preservar todos os statuses existentes. Adicionar `intro_shown` como novo valor possível **sem migration** (basta usar). Não redefinir lista no escuro. Documentar valores conhecidos no schema doc após implementação.

**Semântica para rituais com instrução (planejamento mensal, fechamento mensal):**
- `intro_shown` — preâmbulo entregue, aguardando aceite
- `sent` — ritual completo executado (implica aceite — explícito ou implícito por já ter rodado antes)
- `skipped` — user explicitamente pulou ou ignorou o preâmbulo
- `error` — falha técnica

**Detecção de "já instruído"** depende apenas de existir um `sent` no histórico (ver `getRitualIntroDecision` em §5.3). `skipped` ou `intro_shown` isolados não significam aceite.

---

## 4. Helper `computeProgress`

`src/engine.js`, novo helper exportado:

```js
async function computeProgress(scope, collabId, refDateOrProjectId, opts = {}) {
  // scope ∈ 'day' | 'week' | 'month' | 'project'
  // refDateOrProjectId: YYYY-MM-DD (date scopes) ou projectId (scope='project')
  // opts.context ∈ 'work' | 'personal' | 'all' (default 'all')
  // retorna { pct, done, total, scope, period: { start, end }, empty }
}
```

### Semântica (ajuste 7 + Q3)

- **`day`:** tasks com `due_date = refDate`
- **`week`:** tasks com `due_date` entre segunda e domingo da semana de refDate
- **`month`:** tasks com `due_date` entre 1º e último dia do mês de refDate
- **`project`:** tasks com `project_id = X` (sem filtro de data, sem fórmula híbrida com checkpoints — MVP simples). Cruzamento com checkpoints é evolução futura, fora deste MVP.
- **Filtro de status:** `done` = `status='done'`. `cancelled` é excluído (não conta nem em total). Demais (`pending, in_progress, overdue, awaiting_confirmation, delegated`) contam em total mas não em done.
- **Filtro de context:** parametrizável (default `'all'` = work + personal). Hábitos NUNCA entram (têm streak próprio).
- **Retroativas:** tasks `source='retroactive_capture'` com `due_date` no range contam em done E total.
- **`empty=true` quando `total=0`:** `pct` retorna `null`. Quem renderiza decide mensagem natural ("hoje não tinha nada planejado", "essa semana não tinha tasks com prazo definido", etc.). **Nunca mostrar "0%" pra empty.**

---

## 5. Markers e funções engine

### 5.1 Novo marker `<<MONTHLY_PLAN>>`

```
<<MONTHLY_PLAN>>
{
  "month_start": "2026-06-01",
  "goals": ["meta 1", "meta 2", "meta 3"],
  "carry_over_notes": "..."
}
<<END>>
```

Análogo a `<<WEEKLY_PLAN>>`. Engine ganha:
- `parseMonthlyPlanMarker(text)` — espelha `parseWeeklyPlanMarker`
- `applyMonthlyPlan(collab, plan)` — espelha `applyWeeklyPlan`. Upsert em `monthly_plans` (manual SELECT/UPDATE/INSERT por `(collaborator_id, month_start)`).

### 5.2 Markers reutilizados na lista mental (Q2 + ajuste 5)

Confirmado no runtime: `<<TASK_UPDATE>>`, `<<EVENT_CREATE>>`, `<<MEMORY_SAVE>>`, `<<PROJECT_CREATE>>` todos existentes e validados.

### 5.3 Helpers novos no engine

```js
// Retorna decisão sobre o ritual baseada no histórico de ritual_logs.
// Substitui shouldShowRitualIntro com 3 estados distintos (resolve ambiguidade
// onde "false" significaria coisas diferentes — já aceitou vs saturado).
async function getRitualIntroDecision(collabId, ritualType) {
  // Retorna uma de 3 strings:
  //   'show_intro'    — mostra preâmbulo (1ª vez OU reoferta após skip)
  //   'send_ritual'   — dispara ritual completo direto (já instruído + aceitou no passado)
  //   'skip_saturated'— não envia nada (3 skipped/intro_shown consecutivos sem aceite)
  const { data } = await supabase
    .from('ritual_logs')
    .select('status, created_at')
    .eq('collaborator_id', collabId)
    .eq('ritual_type', ritualType)
    .order('created_at', { ascending: false })
    .limit(5);
  if (!data || data.length === 0) return 'show_intro';
  // Já instruído: ritual completo rodou ao menos uma vez (sent)
  const wasInstructed = data.some(r => r.status === 'sent');
  if (wasInstructed) return 'send_ritual';
  // Saturação: últimos 3 todos sem aceite
  const recent = data.slice(0, 3);
  if (recent.length === 3 && recent.every(r => ['intro_shown','skipped'].includes(r.status))) {
    return 'skip_saturated';
  }
  return 'show_intro';
}

async function countRecentRelaysToRecipient(requesterId, recipientId, refDate) {
  // Query coordination_requests inline (SEM RPC — ajuste 3)
  // count com requester_id + recipient_id + status IN (sent,responded) + created_at no dia
  // retorna integer
}

async function buildRelayLimitHint(requesterId) {
  // Lista recipients pra quem o requester mandou ≥5 relays hoje (com nomes)
  // Query inline em coordination_requests + JOIN collaborators (ajuste 3)
  // Retorna string [RELAY_LIMIT_HINT] específica por destinatário, OU null se nenhum saturado
}

function isFirstMondayOfMonth(date) { /* ... */ }
function isLastFridayOfMonth(date)  { /* ... */ }
```

### 5.4 Injeção do `[RELAY_LIMIT_HINT]` no system prompt (Q6)

Em `processMessage`, antes de chamar LLM, calcula `buildRelayLimitHint(collab.id)`. Se não-null, injeta no system prompt junto com COORD_HINT/ACC. Hint **específico por destinatário** (ajuste 6 da Q6):

```
[RELAY_LIMIT_HINT]
Canal saturado com:
- Leo: 5 relays hoje
- Juliana: 6 relays hoje

Antes de emitir novo relay para esses destinatários, sugira ao usuário falar direto.
Não bloqueie — apenas avise: "Você já usou o TOM 5 vezes com Leo hoje. Posso mandar
esse, mas talvez valha falar direto com ele depois dessa." Para outros destinatários
(não listados acima), opere normalmente.
```

LLM lê e ajusta resposta. Não há bloqueio no engine — limite é suave por design.

---

## 6. Skill nova `lista-mental.md`

### 6.1 Carregamento

**Primary** via pickSkill quando user dispara gatilhos:
- "tô com várias coisas na cabeça"
- "lista mental"
- "descarrega essa lista"
- "anota tudo isso"
- Áudio/texto longo com ≥3 itens distintos detectados

**Auxiliar contextual:** TOM pergunta UMA vez no briefing matinal *"Tem algo na cabeça que ainda não anotamos?"* (Bloco A em `rituais-diarios.md`). Se user disser não, cala. Não insiste.

### 6.2 Pipeline obrigatório (Q2)

Ordem **sagrada** — pular etapa quebra a UX:

1. **Capturar** — receber input bruto (texto ou áudio transcrito)
2. **Agrupar** — classificar internamente (Eisenhower implícito):
   - `task` → executável com prazo plausível → `<<TASK_UPDATE>>` create + `source='mental_dump'`
   - `event` → data/hora marcada → `<<EVENT_CREATE>>` (notes inclui "via mental dump")
   - `project` → 5W2H aplicável, estrutura grande → `<<PROJECT_CREATE>>`
   - `memory` → reflexão, contexto, dúvida → `<<MEMORY_SAVE>>` `memory_type='context'`, `source='explicit'`, content prefixado com "(via mental dump YYYY-MM-DD)"
   - `resolve_now` → ação resolúvel em até 5min na própria conversa → **NÃO persiste automaticamente** (ajuste 4)
3. **Propor** — apresentar classificação ao user em texto humano
4. **Confirmar** — user confirma ou ajusta
5. **Persistir** — emite N markers em sequência (skill compõe na resposta do mesmo turno)

### 6.3 Regra explícita `resolve_now` (ajuste 4)

`resolve_now` **não persiste automaticamente**. TOM só usa essa categoria quando:
- A ação é claramente resolvível na própria conversa (resposta direta, info que TOM tem, decisão simples que user pode tomar agora)
- TOM apresenta a resolução no texto da resposta

Caso contrário (não resolvível inline), TOM **reclassifica para `task` ou para reminder** (`<<TASK_UPDATE>>` com `remind_at`). Nunca deixa em limbo.

Senão `resolve_now` vira buraco negro: itens "resolvidos" sem rastro.

### 6.4 Microconfirmação condicional (Q4)

- **Item único e claro** ("anota: ligar pro fornecedor X amanhã") → emite marker direto, sem propor
- **Lote (≥2 itens) ou ambíguo** → pipeline sagrado completo (capturar→agrupar→propor→confirmar→persistir)

### 6.5 Contextual por papel (proativo no briefing)

TOM ajusta a pergunta proativa conforme `role`:
- Coord (Juliana, Quintela, Anne): "Tem professor pra conversar? Projeto travado?"
- Gerente (Jereh, Clayton, Krissya): "Tem aluno em risco? Atendimento pendente?"
- Director (Alf): "Tem decisão estratégica em aberto?"
- Manager+all (Yuri/Marketing): "Tem campanha travada? Briefing pendente?"

### 6.6 Tag de origem (rastreabilidade futura)

Todos os artefatos persistidos via lista mental ganham marca de origem:
- `tasks.source = 'mental_dump'`
- `collaborator_memory`: `source='explicit'` + content prefixado `"(via mental dump YYYY-MM-DD) ..."`
- `events`/`projects`: nota livre `"Origem: mental dump YYYY-MM-DD"` em campo de notas

---

## 7. Skills novas: planejamento mensal e fechamento mensal

### 7.1 `skills/planejamento-mensal.md` (~6KB)

Estrutura:
1. **Quando ativa** — disparado pelo dispatcher na primeira segunda do mês (mais gatilho explícito do user: "planejamento mensal", "objetivos do mês")
2. **Pra que serve** (seção α — usada em preâmbulo de 1ª vez E quando user pergunta "como funciona?")
3. **Fluxo** — (a) revisão do mês anterior (consulta `monthly_plans` anterior + `computeProgress('month', collab, lastMonth)`); (b) escolha de 3-5 metas/OKRs leves; (c) definição de carry_over_notes (o que sobrou do mês passado)
4. **Marker emitido** — `<<MONTHLY_PLAN>>`
5. **Não-objetivos** — não criar tasks individuais (essas vêm via outras skills); não substituir planejamento semanal (que continua acontecendo nos domingos/segundas dentro do mês)

### 7.2 `skills/fechamento-mensal.md` (~5KB)

Estrutura:
1. **Quando ativa** — disparado pelo dispatcher na última sexta do mês (mais gatilho user: "fechamento mensal", "retrospectiva do mês")
2. **Pra que serve** (seção α)
3. **Fluxo** — (a) `computeProgress('month', collab, today)` exibe % execução + barrinha; (b) coleta `wins` (3-5 conquistas); (c) coleta `retrospective_notes` (livre); (d) coleta `carry_over_notes` (o que vai pro próximo mês); (e) marca `monthly_plans.status='completed'`
4. **Marker emitido** — `<<MONTHLY_PLAN>>` action='close' (ou similar — espelha fechamento de weekly_plan)
5. **Apresentação** — barra de progresso contextual, comparação com mês anterior se disponível

---

## 8. Extensões em `skills/rituais-diarios.md`

3 blocos novos (cada um claramente delimitado):

### 8.1 Bloco A — Captura proativa lista mental no briefing (~10 linhas)

TOM pergunta UMA vez por dia no briefing: *"Tem algo na cabeça que ainda não anotamos?"*. Se user disser não, cala. Não insiste. Pergunta contextual por papel (Q5.5).

### 8.2 Bloco B — Captura retroativa contextual no fechamento (Q4 — ~25 linhas)

**Sinais (any-of) que disparam a pergunta** (ajuste do user em Q4):
- Conversa do dia menciona ações executadas fora da agenda
- Volume de atividade no chat não refletido em tasks
- Aderência baixa COM conversa ativa

**Critério verbal:**
> "Se vira task clara sem inventar contexto → task done com `source='retroactive_capture'` e `due_date=hoje` e `completed_at=now()`. Se precisa adivinhar → `<<MEMORY_SAVE>>` `memory_type='context'` com content prefixado '(retroativo YYYY-MM-DD)'. Se nem isso, não persiste."

**Microconfirmação:**
- Item único e claro ("resolvi o pacote da TIM") → emite marker direto
- Lote ou ambíguo → pipeline sagrado (propor→confirmar→persistir)

### 8.3 Bloco C — Barrinhas contextuais (~15 linhas)

Mensagens de fechamento ganham progresso via `computeProgress`:
- **Fechamento diário** → `% do dia` (ou mensagem natural se `empty=true`)
- **Planejamento semanal** (segunda) e **Fechamento semanal** (sexta) → `% da semana` (nomenclatura ajuste 8)
- **Fechamento mensal** → `% do mês` + delta vs mês anterior
- **Projeto** → só quando user pergunta explicitamente ("como tá o projeto X?")
- **Hábitos** NUNCA aparecem nas barrinhas (têm streak próprio)

---

## 9. Dispatcher (rituais mensais)

`src/rituals/dispatcher.js` ganha 2 blocos novos + helpers de calendário.

### 9.1 `checkMonthlyPlanning`

```js
async function checkMonthlyPlanning(now) {
  if (!isFirstMondayOfMonth(now)) return;
  const collabs = await listLeadership();
  for (const c of collabs) {
    const matchesTime = currentSlot(now) === timeToSlot(c.user_preferences?.monthly_planning_time || '07:00');
    if (!matchesTime) continue;
    if (await alreadySent(c.id, 'monthly_planning', ymdToday)) continue;
    const decision = await getRitualIntroDecision(c.id, 'monthly_planning');
    if (decision === 'show_intro') {
      await sendRitual(c, 'monthly_planning_intro');                       // só preâmbulo
      await logRitualEvent(c.id, 'monthly_planning', 'intro_shown', null, ymdToday);
      // ritual completo NÃO dispara nesta execução — separado por design
      // próxima janela (próximo mês) reavalia: se user aceitou nesse meio tempo
      // e ritual rodou, decision='send_ritual'; se não respondeu, 'show_intro' de novo
    } else if (decision === 'send_ritual') {
      await sendRitual(c, 'monthly_planning');                             // ritual completo
      await logRitualEvent(c.id, 'monthly_planning', 'sent', null, ymdToday);
    } else { // 'skip_saturated'
      // 3 skipped/intro_shown consecutivos — para de reoferecer automaticamente
      await logRitualEvent(c.id, 'monthly_planning', 'skipped', 'saturated', ymdToday);
      // re-oferta só se user pedir explicitamente OU após 6+ meses sem registro
    }
  }
}
```

### 9.2 `checkMonthlyClosing` (espelho)

Mesmo padrão. Dispara na última sexta do mês com `monthly_closing_time` per user.

### 9.3 `listLeadership()` (ajuste 6)

**Princípio do produto:** "grupo atual de liderança validado pelo PO no momento do deploy". Não cristalizar número no spec.

**Implementação MVP:**

```js
async function listLeadership() {
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, role, unit, user_preferences(monthly_planning_time, monthly_closing_time)')
    .in('role', ['director', 'coordinator', 'manager'])
    .eq('is_active', true);
  return data || [];
}
```

Filtro inicial = `role IN ('director','coordinator','manager')` ativos. No deploy atual (verificado pré-implementação), esse filtro retorna **8 pessoas**:

- **Alf** (director, all)
- **Anne Susan** (director, all) — atualizada para director conforme dado fornecido pelo PO
- **Juliana** (coordinator, lead pedagógico School)
- **Quintela** (coordinator, lead pedagógico Kids)
- **Jereh** (manager, gerente Campo Grande)
- **Clayton** (manager, gerente Recreio)
- **Krissya** (manager, gerente Barra)
- **Yuri** (manager+all, líder Marketing)

Yuri é incluído por ser líder de departamento (Marketing) — justifica ritual mensal próprio. Se PO quiser ajustar (ex: excluir Yuri ou expandir para outros papéis), edita o filtro em runtime sem mexer no spec.

### 9.4 Helpers de calendário

```js
function isFirstMondayOfMonth(date) {
  if (date.getDay() !== 1) return false;             // 1 = segunda
  return date.getDate() <= 7;
}
function isLastFridayOfMonth(date) {
  if (date.getDay() !== 5) return false;             // 5 = sexta
  const next = new Date(date); next.setDate(date.getDate() + 7);
  return next.getMonth() !== date.getMonth();
}
```

Ambos em America/Sao_Paulo. Usar `nowSaoPaulo()` existente.

### 9.5 Wiring

Ambos os blocos vão em `run()` de `dispatcher.js`, entre `checkChecklistConsequences` (Sprint 15) e `notifyCoordinators`. Try/catch por bloco (não-fatal).

---

## 10. Camada TOM-instrutor (transversal)

**Não é skill nova.** É composição de:

1. **Conteúdo embutido** em cada skill nova (`lista-mental.md`, `planejamento-mensal.md`, `fechamento-mensal.md`) — seção "Pra que serve" curta. LLM lê quando skill ativa, usa para preâmbulo de 1ª vez OU para responder dúvidas espontâneas ("como funciona?", "pra que isso?").

2. **Helper `getRitualIntroDecision`** + status `intro_shown`/`sent`/`skipped` em `ritual_logs` para 3 estados (1ª vez / já aceitou / saturado).

3. **Cadência separada e regra de aceite explícito** (apertada em ajuste pós-spec):
   - **1ª execução em janela cron** (1ª segunda do mês para planejamento, última sexta para fechamento): preâmbulo + convite ("quer ativar agora?") → registra `intro_shown`
   - **Se user aceitar** (responde "sim", "manda", "vamos", "pode"): ritual completo dispara (mesmo turno se cabível, ou na próxima janela) → registra `sent`
   - **Se user pular ou ignorar** ("não, depois", "agora não", "deixa pra próxima") OU não responder: registra `skipped`. TOM **reoferece** o preâmbulo na próxima janela cron (próximo mês). **NÃO assume aceite implícito** automático na execução seguinte.
   - **"Já instruído"** (não mostra preâmbulo de novo, dispara ritual completo direto) requer apenas:
     - existe registro `status='sent'` no histórico daquele `ritual_type` para aquele `collab_id` (significa que pelo menos uma vez o ritual completo rodou — implica que user já passou pelo aceite)
   - **`skipped` ou `intro_shown` isolados NÃO bastam** para considerar "já instruído"
   - **Saturação de desinteresse:** se os 3 registros mais recentes daquele ritual forem todos `intro_shown` ou `skipped` (nenhum `sent`), TOM para de reoferecer automaticamente. Re-oferta só se user explicitamente pedir ("ativa o planejamento mensal") ou após 6+ meses sem registro

4. **Comportamento ad-hoc** (não cron): user pergunta "como funciona X?" ou "pra que isso?" → LLM responde com base no conteúdo da skill ativa.

---

## 11. Limite suave anti-relay

### 11.1 Counter

`countRecentRelaysToRecipient(requesterId, recipientId, refDate)` — query inline em `coordination_requests`:

```js
async function countRecentRelaysToRecipient(requesterId, recipientId, refDate) {
  const start = new Date(refDate); start.setHours(0,0,0,0);
  const end   = new Date(refDate); end.setHours(23,59,59,999);
  const { count } = await supabase
    .from('coordination_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requester_id', requesterId)
    .eq('recipient_id', recipientId)
    .in('status', ['sent','responded'])
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  return count || 0;
}
```

### 11.2 Hint construction

`buildRelayLimitHint(requesterId)` — query inline (ajuste 3, sem RPC):

```js
async function buildRelayLimitHint(requesterId) {
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);
  const { data } = await supabase
    .from('coordination_requests')
    .select('recipient_id, recipient:collaborators!coordination_requests_recipient_id_fkey(full_name)')
    .eq('requester_id', requesterId)
    .in('status', ['sent','responded'])
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  if (!data?.length) return null;
  // Agrupa por recipient_id, conta
  const counts = new Map();
  for (const row of data) {
    const key = row.recipient_id;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const heavy = [...counts.entries()]
    .filter(([_, n]) => n >= 5)
    .map(([id, n]) => {
      const name = data.find(r => r.recipient_id === id)?.recipient?.full_name?.split(' ')[0] || 'destinatário';
      return `- ${name}: ${n} relays hoje`;
    });
  if (!heavy.length) return null;
  return `[RELAY_LIMIT_HINT]\nCanal saturado com:\n${heavy.join('\n')}\n\nAntes de emitir novo relay para esses destinatários específicos, sugira ao usuário falar direto. Não bloqueie — avise: "Você já usou o TOM N vezes com [nome] hoje. Posso mandar esse, mas talvez valha falar direto com ele/ela depois dessa." Para destinatários não listados acima, opere normalmente.`;
}
```

### 11.3 Injeção

Em `src/engine.js processMessage`, após carregar COORD_HINT/ACC, antes de chamar LLM:

```js
const relayHint = await buildRelayLimitHint(collab.id);
if (relayHint) systemPrompt += '\n\n' + relayHint;
```

---

## 12. Decisões fechadas (consenso 3 vozes + 8 ajustes)

| ID | Decisão | Justificativa |
|---|---|---|
| Q1 | `monthly_plans` tabela própria + `wins[]` + `carry_over_notes` | Não polui weekly. Semântica mensal distinta. Restrição "não refatorar" |
| Q2 | Lista mental reusa markers existentes (sem `<<MENTAL_DUMP>>` novo). Pipeline sagrado | Engine já valida cada marker. Risco menor |
| Q3 | `computeProgress` filtra por `due_date` no range. Empty UX | Semântica clara: "% do que comprometi e fiz" |
| Q4 | Captura retroativa A2 condicional + critério verbal + microconfirmação só em lote/ambíguo | Não vira etapa obrigatória. Rigor evita task fantasma |
| Q5 | TOM-instrutor transversal (não skill própria). `ritual_logs` detecta 1ª vez. Preâmbulo separado do ritual | Conteúdo junto com skill (sem drift). Sem schema novo |
| Q6 | Counter inline em `coordination_requests`. Hint específico por destinatário | Limite suave de verdade. Sem RPC nova |
| Aj.1 | `ritual_logs.status` é texto livre — não criar CHECK | Preserva statuses existentes (sent/skipped/error/ignored). Adiciona `intro_shown` sem migration |
| Aj.2 | Cadência/dia mensal NÃO configurável MVP. Só horário | Defaults globais (1ª segunda + última sexta). Não abrir escopo |
| Aj.3 | Anti-relay: query inline, sem RPC | 16 colaboradores não saturam |
| Aj.4 | `resolve_now` regra explícita: não persiste automaticamente | Reclassifica pra task/reminder se não resolvível |
| Aj.5 | `<<EVENT_CREATE>>` confirmado no runtime | 7 usos em `marker_logs` |
| Aj.6 | `listLeadership()` não cristaliza número no spec | "Grupo atual de liderança validado". Detalhe runtime |
| Aj.7 | `computeProgress('project')` MVP só tasks do projeto | Sem fórmula híbrida. Cruzamento futuro |
| Aj.8 | Nomenclatura: "planejamento semanal" / "fechamento semanal" (não "briefing semanal") | Consistência com sistema atual |
| Aj. extra | `tasks.source` CHECK ganha `mental_dump` + `retroactive_capture` | Tag de origem (rastreabilidade) |

---

## 13. Componentes alterados (resumo)

| Arquivo / Local | Tipo | Tamanho aprox |
|---|---|---|
| Migration única (1 CREATE + 2 ALTER + 1 ADD COLUMN x2) | nova | ~30 linhas SQL |
| `src/engine.js` | +5 helpers + 1 marker function | ~250 linhas |
| `src/rituals/dispatcher.js` | +2 blocos cron + 2 helpers calendário + listLeadership | ~120 linhas |
| `src/prompts/system.js` | +injeção de RELAY_LIMIT_HINT | ~10 linhas |
| `skills/lista-mental.md` | NOVA | ~6 KB |
| `skills/planejamento-mensal.md` | NOVA | ~6 KB |
| `skills/fechamento-mensal.md` | NOVA | ~5 KB |
| `skills/rituais-diarios.md` | +3 blocos | ~50 linhas |

PWA: zero alteração nesta sprint.

---

## 14. Critérios de sucesso

- ✅ Liderança (8 pessoas no deploy atual) recebe planejamento mensal automático na 1ª segunda do mês
- ✅ Preâmbulo aparece na 1ª vez de cada ritual; ritual completo só após aceite ou na 2ª execução
- ✅ Fechamento mensal apresenta `% execução + wins + carry_over` na última sexta
- ✅ User pode invocar lista mental → TOM classifica em ≤6 categorias → confirma → persiste com tag `mental_dump`
- ✅ Item único e claro vai direto; lote ou ambíguo passa pelo pipeline sagrado
- ✅ `resolve_now` resolve inline ou reclassifica — nunca deixa em limbo
- ✅ Fechamento diário mostra barra contextual ou mensagem humana se vazio
- ✅ Captura retroativa só dispara quando há sinal real (não toda noite)
- ✅ Relay #6 pra mesmo destinatário no dia → TOM avisa antes de emitir, sem bloquear
- ✅ Zero regressão em rituais existentes (briefing matinal/fechamento diário/planejamento semanal/hábitos/checklists)
- ✅ Migration aplica sem perda de dados

---

## 15. Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| R1 | Skill `lista-mental` complexa demais | Pipeline sagrado obrigatório. Testar com 3-5 itens reais antes de 10+ |
| R2 | Captura retroativa cria ambiguidade ("foi feito ou não?") | Critério verbal rigoroso + memory `context` como fallback seguro |
| R3 | RELAY_LIMIT_HINT inflar prompt | Hint só aparece quando há recipient ≥5 — ausente em 99% dos turnos |
| R4 | Migration falha em produção | Aplicada via Supabase MCP em horário baixa atividade. Rollback documentado |
| R5 | Confusão entre planejamento_semanal e planejamento_mensal | Skills separadas, fluxos distintos, markers diferentes (`<<WEEKLY_PLAN>>` vs `<<MONTHLY_PLAN>>`) |
| R6 | Yuri (manager+all) recebe ritual mensal mas não tem "unit" pessoal | Skill mensal é genérica — não depende de unit. OK no MVP |
| R7 | `intro_shown` colide com status existente futuro | Texto livre permite, mas documentar valores conhecidos pós-implementação |
| R8 | `resolve_now` virar buraco negro (item desaparece sem rastro) | Regra explícita §6.3 — TOM reclassifica se não resolvível inline |

---

## 16. Não-objetivos afirmados

- ❌ Memória semântica (camada 3 estilo OpenClaw/Hermes) — adiado pra Sprint 24+
- ❌ Active Thread Stack — Sprint 22
- ❌ PWA Governança Pessoal — Sprint 22
- ❌ Refatoração de `priorizacao-inteligente`, `cadastro-projeto-5w2h`, `planejamento-semanal`, `rituais-diarios` core, `checklist-tarefas`, `habitos-pessoais` — apenas extensões pontuais em `rituais-diarios.md`
- ❌ TOM em grupos WhatsApp como participante ativo
- ❌ Departamentos novos (4 já cobrem operação)
- ❌ Cadência/dia configurável dos rituais mensais (defaults globais)
- ❌ Cruzamento `computeProgress('project')` com checkpoints (futuro)
- ❌ Painel de uso/aderência geral (Sprint 22 PWA)
- ❌ RPC ou cache para counter de relay (query inline basta)
- ❌ Bloqueio duro de relay acima de N (limite é suave por design)

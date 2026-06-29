# Antecedência de Lembrete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) para implementar task-a-task. Steps usam checkbox (`- [ ]`).

**Goal:** Trocar o default de lembrete de tarefa (de "antecipa todo dia + véspera redundante" para "véspera ~18h + no dia") e dar ao usuário um seletor de **Antecedência de lembrete** (Só no dia / Véspera + dia / Todos os dias), configurável pela tela e pela conversa com o TOM.

**Architecture:** Uma coluna `user_preferences.reminder_lead` vira a fonte única. Um helper PURO traduz o enum em 2 decisões (disparar véspera? / cutoff do briefing). O dispatcher consolida os 3 crons de véspera em 1 (noturno, gated) e o briefing passa o cutoff conforme o enum. PWA troca o toggle binário por um seletor; o engine aceita o campo via `PREFS_UPDATE`.

**Tech Stack:** Node.js (dispatcher/engine, CommonJS), Supabase Postgres, React+TS+Tailwind (PWA), `node:test` (TDD backend), DS components (`CustomSelect`).

## Global Constraints
- **Default global = `eve_and_day`** (backfill TODOS os existentes). Blast radius consciente.
- **Voz/tom do TOM sagrados** — só mexer em QUAIS tarefas entram e QUANDO o cron dispara, nunca no fraseado dos rituais.
- **Idempotência da véspera**: manter claim atômico (`notifications_alert_daily_uq`); NUNCA reintroduzir check-then-act (regressão histórica Jhonatan 12x).
- **Fora de escopo:** tarefa de grupo (`remindGroupTasks`), alerta de atraso (`notify_overdue_alerts`), antecedência por-contexto.
- Deploy: `scp` + `pm2 restart` (engine/dispatcher) / auto-deploy hook commita+pusha no fim do turno (PWA via Vercel). Migration aplicada via Supabase MCP. `_remote` NÃO é git repo → "commit" aqui = scp/deploy no fim da fatia.
- TDD onde há lógica pura. E2E real na VPS com ficha descartável (sem mutar dado real).

---

## File Structure
- **Create** `supabase/migrations/2026-06-29_reminder_lead.sql` — coluna + CHECK + default + backfill.
- **Create** `src/rituals/reminder-lead.js` — helper PURO: `shouldRemindEve(lead)`, `briefingCutoffYmd(lead, todayYmd, tomorrowYmd)`, `normalizeLead(v)`, `LEADS`.
- **Create** `src/rituals/reminder-lead.test.js` — TDD do helper.
- **Modify** `src/rituals/dispatcher.js` — (a) consolidar `remindOperationalTasks`+`remindPersonalTasks`+`checkDeadlineAlerts` em `remindDeadlineEve` (~18h, gate por `reminder_lead`); (b) briefing passa cutoff do helper.
- **Modify** `src/engine.js` — `parsePrefsMarker` (~3996) + `applyPrefsUpdate` (~4018): aceitar `reminder_lead`.
- **Modify** skill de preferências (`skills/preferencias-*.md` — localizar) — linguagem natural → enum.
- **Modify** `web/src/screens/Configuracoes.tsx` — seletor substitui o toggle "Alertas de prazo (D-1)".

---

## Task 1 — Migration + backfill (F1)

**Files:**
- Create: `supabase/migrations/2026-06-29_reminder_lead.sql`

- [ ] **Step 1: Escrever a migration**
```sql
-- reminder_lead: antecedência de lembrete de tarefa com prazo.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS reminder_lead text NOT NULL DEFAULT 'eve_and_day';
DO $$ BEGIN
  ALTER TABLE user_preferences
    ADD CONSTRAINT user_preferences_reminder_lead_check
    CHECK (reminder_lead IN ('same_day','eve_and_day','daily'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- backfill explícito (linhas antigas já pegam o default, mas garante consistência)
UPDATE user_preferences SET reminder_lead = 'eve_and_day' WHERE reminder_lead IS NULL;
```

- [ ] **Step 2: Aplicar via Supabase MCP** (`apply_migration`, project `cesnbnrynvxvgdhfmaua`).

- [ ] **Step 3: Verificar** — `SELECT reminder_lead, count(*) FROM user_preferences GROUP BY 1;`
Esperado: todas as linhas em `eve_and_day`.

---

## Task 2 — Helper PURO reminder-lead.js (F2a)

**Files:**
- Create: `src/rituals/reminder-lead.js`
- Test: `src/rituals/reminder-lead.test.js`

**Interfaces — Produces:**
- `LEADS = { SAME_DAY:'same_day', EVE_AND_DAY:'eve_and_day', DAILY:'daily' }`
- `normalizeLead(v) -> 'same_day'|'eve_and_day'|'daily'` (default `eve_and_day` p/ null/inválido)
- `shouldRemindEve(lead) -> boolean` (true se lead !== 'same_day')
- `briefingCutoffYmd(lead, todayYmd, tomorrowYmd) -> string` (daily→tomorrow; senão→today)

- [ ] **Step 1: Escrever os testes (falhando)**
```js
'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { normalizeLead, shouldRemindEve, briefingCutoffYmd, LEADS } = require('./reminder-lead');

test('normalizeLead: válidos passam; inválido/null → eve_and_day', () => {
  assert.strictEqual(normalizeLead('same_day'), 'same_day');
  assert.strictEqual(normalizeLead('daily'), 'daily');
  assert.strictEqual(normalizeLead('eve_and_day'), 'eve_and_day');
  assert.strictEqual(normalizeLead(null), 'eve_and_day');
  assert.strictEqual(normalizeLead('xpto'), 'eve_and_day');
});
test('shouldRemindEve: só same_day NÃO dispara véspera', () => {
  assert.strictEqual(shouldRemindEve('same_day'), false);
  assert.strictEqual(shouldRemindEve('eve_and_day'), true);
  assert.strictEqual(shouldRemindEve('daily'), true);
  assert.strictEqual(shouldRemindEve(null), true); // default eve_and_day
});
test('briefingCutoffYmd: daily=amanhã (antecipa); senão=hoje', () => {
  assert.strictEqual(briefingCutoffYmd('daily', '2026-06-29', '2026-06-30'), '2026-06-30');
  assert.strictEqual(briefingCutoffYmd('eve_and_day', '2026-06-29', '2026-06-30'), '2026-06-29');
  assert.strictEqual(briefingCutoffYmd('same_day', '2026-06-29', '2026-06-30'), '2026-06-29');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd _remote && node --test src/rituals/reminder-lead.test.js` → FAIL (Cannot find module).

- [ ] **Step 3: Implementar**
```js
'use strict';
// reminder_lead: antecedência de lembrete de tarefa com prazo (caso Fabi 29/06).
const LEADS = { SAME_DAY: 'same_day', EVE_AND_DAY: 'eve_and_day', DAILY: 'daily' };
const VALID = new Set(Object.values(LEADS));
function normalizeLead(v) { return VALID.has(v) ? v : LEADS.EVE_AND_DAY; }
function shouldRemindEve(lead) { return normalizeLead(lead) !== LEADS.SAME_DAY; }
function briefingCutoffYmd(lead, todayYmd, tomorrowYmd) {
  return normalizeLead(lead) === LEADS.DAILY ? tomorrowYmd : todayYmd;
}
module.exports = { LEADS, normalizeLead, shouldRemindEve, briefingCutoffYmd };
```

- [ ] **Step 4: Rodar e ver passar** — `node --test src/rituals/reminder-lead.test.js` → PASS (todos).

---

## Task 3 — Consolidar a véspera em 1 cron gated (F2b)

**Files:**
- Modify: `src/rituals/dispatcher.js` (funções `remindOperationalTasks` ~1163, `remindPersonalTasks` ~1226, `checkDeadlineAlerts` ~4536, e o registro delas no tick)

**Interfaces — Consumes:** `shouldRemindEve` de `./reminder-lead`.

**Contexto:** hoje 3 funções disparam D-1: `remindOperationalTasks`/`remindPersonalTasks` (09h, marcam `tasks.reminded_at`) e `checkDeadlineAlerts` (~15h, claim atômico em `notifications` via `notifications_alert_daily_uq`, gate `notify_deadline_alerts`). Vamos UNIFICAR num cron noturno único.

- [ ] **Step 1:** Criar `remindDeadlineEve(now)` em dispatcher.js — base no `checkDeadlineAlerts` (que já tem o claim atômico robusto), mudando:
  - **Janela:** ~18:00 BRT = `utcH === 21 && utcM <= 10`.
  - **Gate:** trocar `notify_deadline_alerts` por `shouldRemindEve(normalizeLead(collab.user_preferences?.reminder_lead))`.
  - **Tom por contexto:** se a task tem `department_id` → texto operacional (`⏰ ${nick}, lembrete: *${t.title}* vence amanhã. Tudo certo da sua parte?`); senão → leve (`📌 ${nick}, amanhã está marcado: *${t.title}*. Se rolar antes ou quiser remarcar, é só dizer.`). (Preserva os 2 tons que existiam.)
  - **Mantém:** cooldown 6h, `isQuietNow`, `getDndState`, `school_event_id IS NULL`, `assigned_group_id IS NULL`, status pending/in_progress, claim atômico `deadline_alert`.

- [ ] **Step 2:** No tick (a função que chama os crons — localizar onde `remindOperationalTasks`/`remindPersonalTasks`/`checkDeadlineAlerts` são invocados), **remover as 3 chamadas** e chamar só `remindDeadlineEve(now)`. (Manter as funções antigas exportadas só se houver teste; senão remover p/ não disparar duplicado.)

- [ ] **Step 3: `node --check src/rituals/dispatcher.js`** → sem erro de sintaxe.

- [ ] **Step 4: E2E manual (force) na Task 7** — validado no pacote E2E (não dá pra unit-testar o cron com I/O; o gate puro já tem teste na Task 2).

---

## Task 4 — Briefing deixa de antecipar futuras (F3)

**Files:**
- Modify: caller do briefing que usa `isVisibleForDay` (localizar com `grep -rn isVisibleForDay src/`) — passar cutoff do helper.

**Interfaces — Consumes:** `briefingCutoffYmd` de `./reminder-lead`; `isVisibleForDay` de `../lib/day-visibility`.

- [ ] **Step 1:** `grep -rn "isVisibleForDay\|day-visibility" src/` para achar o caller do briefing (provável `system.js` builder do contexto OU dispatcher buildBriefing). Confirmar onde o cutoff = amanhã é passado pro briefing.

- [ ] **Step 2:** No caller, trocar o cutoff fixo (amanhã) por `briefingCutoffYmd(normalizeLead(prefs.reminder_lead), todayYmd, tomorrowYmd)`. O FECHAMENTO continua cutoff=hoje (não mexer). Resultado: `daily`→briefing antecipa "vence amanhã"; `eve_and_day`/`same_day`→briefing só hoje+atrasadas.

- [ ] **Step 3: `node --check`** do arquivo modificado → ok. Cobertura real na Task 7 (E2E).

---

## Task 5 — Engine PREFS_UPDATE + skill (F5)

**Files:**
- Modify: `src/engine.js` — `parsePrefsMarker` (~3996, branch novo) + `applyPrefsUpdate` (~4018, persistir).
- Modify: skill de preferências (`grep -rn "task_checkin\|preferencias\|silêncio" skills/` p/ achar a skill PREFS).

- [ ] **Step 1:** Em `parsePrefsMarker`, após o branch `task_checkin_times`, adicionar:
```js
    } else if (k === 'reminder_lead') {
      const { normalizeLead } = require('../rituals/reminder-lead'); // ajustar path relativo
      if (['same_day','eve_and_day','daily'].includes(v)) update.reminder_lead = v;
      else if (typeof v === 'string') update.reminder_lead = normalizeLead(v);
```
(garantir que `applyPrefsUpdate` faz `update(update)` em `user_preferences` — `reminder_lead` entra junto, sem código extra.)

- [ ] **Step 2:** Na skill PREFS, adicionar a regra de mapeamento natural:
  - "me lembra só no dia" / "não quero ser lembrado antes" → `<<PREFS_UPDATE>>{"reminder_lead":"same_day"}<<END>>`
  - "me lembra na véspera e no dia" / "volta ao normal" → `"eve_and_day"`
  - "me lembra todo dia" / "pode antecipar" → `"daily"`
  + 1 linha de honestidade (só confirma se persistiu — Camada 1 já cobre).

- [ ] **Step 3: `node --check src/engine.js`** → ok. Smoke na Task 7.

---

## Task 6 — PWA: seletor em Notificações (F4)

**Files:**
- Modify: `web/src/screens/Configuracoes.tsx` (seção Notificações; hoje tem o toggle "Alertas de prazo (D-1)" lendo/escrevendo `notify_deadline_alerts`).

- [ ] **Step 1:** Substituir o toggle "Alertas de prazo (D-1)" por um `<CustomSelect>` (DS) "Antecedência de lembrete":
  - opções: `{value:'same_day',label:'Só no dia'}`, `{value:'eve_and_day',label:'Véspera + dia'}`, `{value:'daily',label:'Todos os dias'}`.
  - value = `prefs.reminder_lead ?? 'eve_and_day'`; onChange grava via o mesmo caminho de auto-save já usado pelos outros campos (debounce existente).
  - sub-texto: "Quando o TOM te lembra de tarefa com prazo."
  - Manter "Alertas de atraso" e "Resumo do time" como estão.

- [ ] **Step 2: Validar** — `cd _remote/web && npx tsc --noEmit` (sem erro) + `npx vite build` (build ok).

- [ ] **Step 3: Preview** — `localhost:4173/configuracoes`: o seletor aparece, troca o valor, persiste (checar via preview_eval/snapshot na Task 7).

---

## Task 7 — Validação E2E + deploy + comunicação + registro (F6)

- [ ] **Step 1: Rodar todos os testes puros** — `cd _remote && node --test src/rituals/reminder-lead.test.js` → PASS.
- [ ] **Step 2: `node --check`** em dispatcher.js, engine.js + arquivo do briefing → ok.
- [ ] **Step 3: scp** dispatcher.js, engine.js, reminder-lead.js(+test), arquivo do briefing pra VPS; md5 parity.
- [ ] **Step 4: E2E real (ficha descartável)** na VPS (`node --env-file=.env`): criar tarefa futura (due=amanhã) p/ um colaborador de teste; setar `reminder_lead` nos 3 valores e rodar `remindDeadlineEve(forcedNowEve)` + a seleção do briefing:
  - `same_day` → 0 véspera; briefing não lista (cutoff hoje).
  - `eve_and_day` → 1 véspera; briefing não antecipa.
  - `daily` → véspera + briefing antecipa.
  Soft-cleanup (cancelar fixtures).
- [ ] **Step 5: pm2 restart** + checar online/uptime.
- [ ] **Step 6: PWA** — preview localhost:4173 prova o seletor (screenshot). Auto-deploy publica no fim do turno.
- [ ] **Step 7: Texto pro Alf passar pra Fabi** (não era ela; ajustado; configurável em Configurações › Notificações › Antecedência, ou pedindo "me lembra só no dia").
- [ ] **Step 8: Registrar known-issue** `REMINDER-DAILY-ANTICIPATION-OVERNAG` (+ redundância de véspera) em `tom_known_issues` (status corrigido) + memória `project_*`.

---

## Self-review (feita)
- **Spec coverage:** F1→T1, F2→T2+T3, F3→T4, F5→T5, F4→T6, F6→T7. ✔ todos cobertos.
- **Placeholder scan:** os "localizar com grep" são passos de descoberta concretos (função/símbolo reais: `isVisibleForDay`, `task_checkin_times`), não placeholders de conteúdo. Código dos helpers e da migration está completo.
- **Type consistency:** `reminder_lead` enum idêntico em migration/helper/engine/PWA; `shouldRemindEve`/`briefingCutoffYmd`/`normalizeLead` mesmas assinaturas em todas as tasks. ✔

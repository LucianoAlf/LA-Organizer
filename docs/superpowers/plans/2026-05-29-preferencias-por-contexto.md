# Preferências de Silêncio por Contexto (Pessoal vs Trabalho) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar as janelas de silêncio/lembretes do TOM por contexto (`work` = LA Music / `personal` = tudo fora), expor isso na tela de Configurações, e fazer o dispatcher respeitar o contexto de cada mensagem proativa.

**Architecture:** Colunas `_work`/`_personal` em `user_preferences` (completa o padrão `briefing_time`/`personal_briefing_time`). `isQuietNow` ganha 3º param `context` com fallback pras colunas globais antigas (back-compat). Migração copia global→ambos (zero mudança de comportamento). UI ganha abas Pessoal/Trabalho nas seções de silêncio.

**Tech Stack:** Supabase Postgres (migration via MCP `apply_migration`), Node.js dispatcher (CommonJS), React PWA (Vite+TS), componente `TimeInput` existente.

**Spec:** `docs/superpowers/specs/2026-05-29-preferencias-por-contexto-design.md`
**Handoff TOM-Coach:** `docs/superpowers/handoffs/2026-05-29-semantica-pessoal-trabalho-para-tom-coach.md`

**Convenções deste projeto (importante):**
- Não há framework de testes formal. "Teste" = `node --check`, `npx tsc --noEmit`, `npx vite build`, e smoke determinístico via script Node.
- Deploy backend: `scp` pro VPS `tom:/opt/LA-Organizer/...` + `ssh tom "pm2 restart tom"`.
- `_remote/` NÃO é git repo; commits são automáticos via Stop hook. NÃO rodar `git commit` manual.
- Migrations SQL: usar MCP Supabase `apply_migration` (project_id `cesnbnrynvxvgdhfmaua`).

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| Migration `add_context_quiet_columns` | Colunas novas + data migration | Create (via MCP) |
| `src/services/quiet-hours.js` | `isQuietNow(prefs, now, context)` com resolução por contexto + fallback | Modify |
| `src/rituals/dispatcher.js` | Fix dos 5 vazamentos + passar context nos callers | Modify |
| `web/src/screens/Configuracoes.tsx` | Abas Pessoal/Trabalho + seção Silêncio diário | Modify |
| `scripts/smoke-quiet-context.js` | Smoke determinístico do `isQuietNow` | Create |

---

## Task 1 — Migration: colunas novas + data migration

**Files:**
- Create (via MCP `apply_migration`, name: `add_context_quiet_columns`)

- [ ] **Step 1: Aplicar a migration**

Usar MCP `mcp__supabase__apply_migration` com `project_id: cesnbnrynvxvgdhfmaua`, `name: add_context_quiet_columns`:

```sql
-- Colunas de silêncio por contexto (NULL = sem silêncio naquele contexto)
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS quiet_start_time_work        time,
  ADD COLUMN IF NOT EXISTS quiet_end_time_work          time,
  ADD COLUMN IF NOT EXISTS quiet_days_work              integer[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quiet_weekends_work          boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_start_time_personal    time,
  ADD COLUMN IF NOT EXISTS quiet_end_time_personal      time,
  ADD COLUMN IF NOT EXISTS quiet_days_personal          integer[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quiet_weekends_personal      boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_deadline_alerts_personal boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_overdue_alerts_personal  boolean DEFAULT true;

-- Data migration: copia o silêncio global existente pra AMBOS os contextos.
-- Preserva comportamento atual (ninguém é surpreendido). Diferenciação vira opção daqui pra frente.
UPDATE user_preferences SET
  quiet_start_time_work     = COALESCE(quiet_start_time_work, quiet_start_time),
  quiet_end_time_work       = COALESCE(quiet_end_time_work, quiet_end_time),
  quiet_start_time_personal = COALESCE(quiet_start_time_personal, quiet_start_time),
  quiet_end_time_personal   = COALESCE(quiet_end_time_personal, quiet_end_time)
WHERE quiet_start_time IS NOT NULL OR quiet_end_time IS NOT NULL;

UPDATE user_preferences SET
  quiet_days_work     = quiet_days,
  quiet_days_personal = quiet_days
WHERE quiet_days IS NOT NULL AND array_length(quiet_days, 1) > 0;

UPDATE user_preferences SET
  quiet_weekends_work     = quiet_weekends,
  quiet_weekends_personal = quiet_weekends
WHERE quiet_weekends = true;

COMMENT ON COLUMN user_preferences.quiet_start_time_work IS 'Início do silêncio de TRABALHO (LA Music). NULL = sem silêncio.';
COMMENT ON COLUMN user_preferences.quiet_start_time_personal IS 'Início do silêncio PESSOAL (fora da LA Music). NULL = sem silêncio.';
```

- [ ] **Step 2: Verificar que as colunas existem e a Gabi migrou**

Rodar via MCP `execute_sql`:
```sql
SELECT quiet_start_time_work, quiet_end_time_work, quiet_start_time_personal, quiet_end_time_personal
FROM user_preferences WHERE collaborator_id = '6064c695-410f-4c98-aa00-e2a1f510ba72';
```
Esperado: `work` e `personal` ambos `00:00:00` / `14:00:00` (copiados do global da Gabi).

---

## Task 2 — `quiet-hours.js`: `isQuietNow` com contexto

**Files:**
- Modify: `src/services/quiet-hours.js`
- Create: `scripts/smoke-quiet-context.js`

- [ ] **Step 1: Escrever o smoke determinístico**

Create `scripts/smoke-quiet-context.js`:
```js
#!/usr/bin/env node
// Smoke determinístico do isQuietNow com contexto. Não toca no banco — passa prefs inline.
const { isQuietNow } = require('../src/services/quiet-hours');

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
}

(async () => {
  // Gabi: silêncio TRABALHO 00:00-14:00, pessoal livre
  const gabi = {
    quiet_start_time_work: '00:00:00', quiet_end_time_work: '14:00:00',
    quiet_days_work: [], quiet_weekends_work: false,
    quiet_start_time_personal: null, quiet_end_time_personal: null,
    quiet_days_personal: [], quiet_weekends_personal: false,
  };
  const now9 = { hour: 9, minute: 0, dow: 3 };   // quarta 09h
  const now15 = { hour: 15, minute: 0, dow: 3 };  // quarta 15h

  check('gabi 09h work=quiet', (await isQuietNow(gabi, now9, 'work')).quiet, true);
  check('gabi 09h personal=livre', (await isQuietNow(gabi, now9, 'personal')).quiet, false);
  check('gabi 15h work=livre', (await isQuietNow(gabi, now15, 'work')).quiet, false);

  // Fallback: só colunas antigas globais setadas, sem contexto novo
  const legacy = {
    quiet_start_time: '22:00:00', quiet_end_time: '08:00:00',  // cruza meia-noite
    quiet_start_time_work: null, quiet_end_time_work: null,
    quiet_start_time_personal: null, quiet_end_time_personal: null,
    quiet_days_work: [], quiet_days_personal: [],
  };
  check('legacy 23h work=quiet (fallback)', (await isQuietNow(legacy, { hour: 23, minute: 0, dow: 2 }, 'work')).quiet, true);
  check('legacy 12h work=livre (fallback)', (await isQuietNow(legacy, { hour: 12, minute: 0, dow: 2 }, 'work')).quiet, false);

  // quiet_days por contexto
  const daysWork = { quiet_days_work: [0], quiet_days_personal: [] };
  check('domingo work=quiet', (await isQuietNow(daysWork, { hour: 10, minute: 0, dow: 0 }, 'work')).quiet, true);
  check('domingo personal=livre', (await isQuietNow(daysWork, { hour: 10, minute: 0, dow: 0 }, 'personal')).quiet, false);

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Rodar o smoke pra ver falhar**

```bash
node D:/la-organizer/_remote/scripts/smoke-quiet-context.js
```
Esperado: FALHA — `isQuietNow` ainda ignora o 3º param `context` (usa só colunas antigas), então `gabi 09h work=quiet` retorna `false`.

- [ ] **Step 3: Reescrever `isQuietNow` com contexto + fallback**

Substituir o corpo de `src/services/quiet-hours.js` por:
```js
'use strict';

const supabase = require('../supabase/client');

// Lê uma janela por contexto, com fallback pras colunas globais antigas.
function windowFor(prefs, context) {
  const suffix = context === 'personal' ? '_personal' : '_work';
  const start = prefs[`quiet_start_time${suffix}`] ?? prefs.quiet_start_time ?? null;
  const end   = prefs[`quiet_end_time${suffix}`]   ?? prefs.quiet_end_time   ?? null;
  const daysCtx = prefs[`quiet_days${suffix}`];
  const days = (Array.isArray(daysCtx) && daysCtx.length) ? daysCtx
             : (Array.isArray(prefs.quiet_days) ? prefs.quiet_days : []);
  const wkndCtx = prefs[`quiet_weekends${suffix}`];
  const weekends = (wkndCtx === true || wkndCtx === false) ? wkndCtx : !!prefs.quiet_weekends;
  return { start, end, days, weekends };
}

/**
 * Retorna { quiet: boolean, reason: string|null }.
 * context: 'work' | 'personal' (default 'work'). Seleciona qual janela aplicar.
 */
async function isQuietNow(collabOrId, now, context = 'work') {
  let prefs = null;
  if (collabOrId && typeof collabOrId === 'object') {
    prefs = collabOrId.user_preferences || collabOrId;
  } else if (typeof collabOrId === 'string') {
    const { data } = await supabase
      .from('user_preferences')
      .select('quiet_weekends, quiet_days, quiet_reason, quiet_start_time, quiet_end_time, quiet_start_time_work, quiet_end_time_work, quiet_days_work, quiet_weekends_work, quiet_start_time_personal, quiet_end_time_personal, quiet_days_personal, quiet_weekends_personal')
      .eq('collaborator_id', collabOrId)
      .maybeSingle();
    prefs = data;
  }
  if (!prefs) return { quiet: false, reason: null };

  const dow = now.dow;
  const w = windowFor(prefs, context);
  const tag = context === 'personal' ? 'personal' : 'work';

  // 1. Fins de semana silenciosos
  if (w.weekends && (dow === 0 || dow === 6)) {
    return { quiet: true, reason: `quiet_weekends_${tag}${prefs.quiet_reason ? ':' + prefs.quiet_reason : ''}` };
  }
  // 2. Dias da semana silenciosos
  if (Array.isArray(w.days) && w.days.includes(dow)) {
    return { quiet: true, reason: `quiet_day_${tag}:${dow}` };
  }
  // 3. Intervalo horário recorrente (suporta range normal e cruza-meia-noite)
  if (w.start && w.end) {
    const nowMins = now.hour * 60 + now.minute;
    const [sh, sm] = String(w.start).split(':').map(Number);
    const [eh, em] = String(w.end).split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    let inQuiet;
    if (startMins <= endMins) inQuiet = nowMins >= startMins && nowMins < endMins;
    else inQuiet = nowMins >= startMins || nowMins < endMins;
    if (inQuiet) {
      const label = `${String(w.start).slice(0, 5)}-${String(w.end).slice(0, 5)}`;
      return { quiet: true, reason: `quiet_hours_${tag}:${label}` };
    }
  }
  return { quiet: false, reason: null };
}

module.exports = { isQuietNow };
```

- [ ] **Step 4: Rodar o smoke + node --check**

```bash
node --check D:/la-organizer/_remote/src/services/quiet-hours.js && node D:/la-organizer/_remote/scripts/smoke-quiet-context.js
```
Esperado: `ALL PASS`.

---

## Task 3 — Dispatcher: passar `context` nos callers existentes + fix dos vazamentos

**Files:**
- Modify: `src/rituals/dispatcher.js`

> Nota: pós-migração, `_work` e `_personal` têm o mesmo valor global pra usuários existentes — então passar context é correção de precisão, não muda comportamento atual.

- [ ] **Step 1: Callers que JÁ checam quiet — passar context herdado**

Em `remindEventTasks` (~L690), `remindOperationalTasks` (~L753), `remindPersonalTasks` (~L815), trocar a chamada:
```js
// ANTES:
const q = await isQuietNow(task.collaborator?.user_preferences, nowSaoPaulo());
// DEPOIS (herda context da task; operational sempre 'work'):
const q = await isQuietNow(task.collaborator?.user_preferences, nowSaoPaulo(), task.context === 'personal' ? 'personal' : 'work');
```
Em `remindOperationalTasks` use literal `'work'` (operacional é sempre LA Music):
```js
const q = await isQuietNow(task.collaborator?.user_preferences, nowSaoPaulo(), 'work');
```

- [ ] **Step 2: `checkReminders` (~L3980) — adicionar guard de quiet por task.context**

Logo após o bloco `const dnd = await getDndState(collab.id); if (dnd.active) {...continue;}`, inserir:
```js
    const ctx = t.context === 'personal' ? 'personal' : 'work';
    const q = await isQuietNow(collab.id, nowSaoPaulo(), ctx);
    if (q.quiet) {
      console.log(`[Reminders] defer ${String(t.id).slice(0,8)} — quiet ${ctx} (${q.reason})`);
      continue; // não marca reminded_at; volta no próximo tick fora do quiet
    }
```

- [ ] **Step 3: `checkHabitReminders` (~L4234) — guard 'personal' (hábito não tem context)**

No loop `for (const r of due)`, logo após resolver `collab` e antes de enviar, inserir:
```js
    const qh = await isQuietNow(collab.id, nowSaoPaulo(), 'personal');
    if (qh.quiet) { console.log(`[HabitReminders] defer ${r.id} — quiet personal (${qh.reason})`); continue; }
```
(Hábitos são tratados como `personal` no v1 — `habits` não tem coluna `context`.)

- [ ] **Step 4: `checkTaskCheckins` (~L4161) — filtrar cada seção por quiet do seu contexto**

O check-in é um digest misto. Após montar `personal` e `work` (arrays), antes de montar `msg`, inserir:
```js
    const qWork = await isQuietNow(c.id, now, 'work');
    const qPersonal = await isQuietNow(c.id, now, 'personal');
    const workVisible = qWork.quiet ? [] : work;
    const personalVisible = qPersonal.quiet ? [] : personal;
    if (!workVisible.length && !personalVisible.length) {
      await logRitualEvent(c.id, ritualType, 'skipped', 'quiet_both_contexts', ymd);
      continue;
    }
```
Depois trocar as referências `personal`→`personalVisible` e `work`→`workVisible` na montagem da `msg`.

- [ ] **Step 5: `dispatchChecklists` (~L355) — operacional = 'work'**

Antes do `await whatsapp.sendMessage(collab.phone, msg)` (~L517), inserir:
```js
      const qc = await isQuietNow(collab.id, nowSaoPaulo(), 'work');
      if (qc.quiet) {
        console.log(`[dispatchChecklists] defer collab=${collab.id} — quiet work (${qc.reason})`);
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'quiet', would_dispatch: false });
        continue;
      }
```
(Confirmar no código que `isQuietNow` e `nowSaoPaulo` estão acessíveis no escopo — ambos estão no mesmo arquivo / importados no topo.)

- [ ] **Step 6: `checkMonthlyPlanning` / `checkMonthlyClosing` (~L249/286) — guard 'work'**

Em cada um, dentro do loop por colaborador, após `if (currentSlot(now) !== timeToSlot(time)) continue;`, inserir:
```js
    const qm = await isQuietNow(c.id, now, 'work');
    if (qm.quiet) { await logRitualEvent(c.id, RITUAL_TYPE, 'skipped', `quiet:${qm.reason}`, ymdToday); continue; }
```
(Substituir `RITUAL_TYPE` por `'monthly_planning'` em planning e `'monthly_closing'` em closing.)

- [ ] **Step 7: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/rituals/dispatcher.js
```
Esperado: sem erro.

- [ ] **Step 8: Smoke do dispatcher em modo seguro**

```bash
node --check D:/la-organizer/_remote/src/rituals/dispatcher.js && echo "dispatcher OK"
```
(Não rodar `run()` real pra não disparar mensagens; a validação comportamental vem no deploy + observação de logs.)

---

## Task 4 — UI Configurações: abas Pessoal/Trabalho + Silêncio diário

**Files:**
- Modify: `web/src/screens/Configuracoes.tsx`

- [ ] **Step 1: Estender a interface `Prefs` e `PREF_COLS`**

Na interface `Prefs`, adicionar:
```ts
  quiet_start_time_work: string;
  quiet_end_time_work: string;
  quiet_days_work: number[];
  quiet_weekends_work: boolean;
  quiet_start_time_personal: string;
  quiet_end_time_personal: string;
  quiet_days_personal: number[];
  quiet_weekends_personal: boolean;
  notify_deadline_alerts_personal: boolean;
  notify_overdue_alerts_personal: boolean;
```
Atualizar `PREF_COLS` (append):
```ts
const PREF_COLS = 'briefing_time, personal_briefing_time, closing_time, planning_day, planning_time, monthly_planning_time, monthly_closing_time, max_daily_tasks, coaching_intensity, notify_deadline_alerts, notify_overdue_alerts, notify_team_summary, do_not_disturb_until, do_not_disturb_reason, task_checkin_times, quiet_weekends, quiet_days, quiet_reason, quiet_start_time_work, quiet_end_time_work, quiet_days_work, quiet_weekends_work, quiet_start_time_personal, quiet_end_time_personal, quiet_days_personal, quiet_weekends_personal, notify_deadline_alerts_personal, notify_overdue_alerts_personal';
```

- [ ] **Step 2: Mapear no load (`useEffect` que seta `form`)**

No objeto `next`, adicionar (com trim dos times):
```ts
        quiet_start_time_work: trimSec(data.quiet_start_time_work),
        quiet_end_time_work: trimSec(data.quiet_end_time_work),
        quiet_start_time_personal: trimSec(data.quiet_start_time_personal),
        quiet_end_time_personal: trimSec(data.quiet_end_time_personal),
        quiet_days_work: Array.isArray(data.quiet_days_work) ? data.quiet_days_work : [],
        quiet_days_personal: Array.isArray(data.quiet_days_personal) ? data.quiet_days_personal : [],
```

- [ ] **Step 3: Persistir no save mutation**

No `.update({...})`, adicionar:
```ts
          quiet_start_time_work: padSec(p.quiet_start_time_work),
          quiet_end_time_work: padSec(p.quiet_end_time_work),
          quiet_days_work: Array.isArray(p.quiet_days_work) ? [...new Set(p.quiet_days_work.filter(n => n >= 0 && n <= 6))].sort() : [],
          quiet_weekends_work: !!p.quiet_weekends_work,
          quiet_start_time_personal: padSec(p.quiet_start_time_personal),
          quiet_end_time_personal: padSec(p.quiet_end_time_personal),
          quiet_days_personal: Array.isArray(p.quiet_days_personal) ? [...new Set(p.quiet_days_personal.filter(n => n >= 0 && n <= 6))].sort() : [],
          quiet_weekends_personal: !!p.quiet_weekends_personal,
          notify_deadline_alerts_personal: p.notify_deadline_alerts_personal,
          notify_overdue_alerts_personal: p.notify_overdue_alerts_personal,
```
> `padSec('')` retorna `''` — ajustar `padSec` pra devolver `null` quando vazio: trocar `const padSec = (t) => (t.length === 5 ? t + ':00' : t);` por `const padSec = (t: string) => (!t ? null : t.length === 5 ? t + ':00' : t);` e tipar a coluna como nullable no update. Confirmar que isso não quebra os times de ritual (que nunca são vazios na prática — têm default).

- [ ] **Step 4: Adicionar estado da aba + nova seção "Silêncio diário"**

Perto dos outros `useState`, adicionar:
```ts
  const [silenceTab, setSilenceTab] = useState<'work' | 'personal'>('work');
```
Renderizar uma nova `<Section title="🔕 Silêncio diário" subtitle="Trabalho = LA Music · Pessoal = sua vida e trabalhos fora da LA Music.">` ANTES de "Dias de silêncio", contendo:
- Um toggle de aba (2 botões Trabalho/Pessoal) que setam `silenceTab`
- 2 `TimeInput` ligados a `quiet_*_${silenceTab}` (início/fim) via helpers que leem/escrevem `form[\`quiet_start_time_${silenceTab}\`]`
- Texto dinâmico: "🔕 TOM em silêncio de {início} às {fim} para {Trabalho|Pessoal}"

Exemplo do bloco de TimeInputs (usar a aba ativa pra escolher a coluna):
```tsx
<div className="flex gap-2 mb-3">
  {(['work','personal'] as const).map(tab => (
    <button key={tab} type="button" onClick={() => setSilenceTab(tab)}
      className={['h-9 px-3 rounded-md text-body-sm font-semibold focus-ring',
        silenceTab === tab ? 'bg-tom text-black' : 'bg-bg-subtle text-fg-muted border border-border'].join(' ')}>
      {tab === 'work' ? 'Trabalho' : 'Pessoal'}
    </button>
  ))}
</div>
<div className="flex items-center gap-2">
  <TimeInput value={(form as any)[`quiet_start_time_${silenceTab}`] || ''}
    onChange={v => setForm({ ...form, [`quiet_start_time_${silenceTab}`]: v })} />
  <span className="text-fg-muted">até</span>
  <TimeInput value={(form as any)[`quiet_end_time_${silenceTab}`] || ''}
    onChange={v => setForm({ ...form, [`quiet_end_time_${silenceTab}`]: v })} />
</div>
```

- [ ] **Step 5: "Dias de silêncio" passa a operar na aba ativa**

Na seção "Dias de silêncio" existente, trocar `form.quiet_days` por `form[\`quiet_days_${silenceTab}\`]` e `form.quiet_weekends` por `form[\`quiet_weekends_${silenceTab}\`]` (leitura e escrita). Adicionar o mesmo toggle de aba no topo dessa seção (ou compartilhar o `silenceTab`).

- [ ] **Step 6: Validar TypeScript + build**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit && npx vite build
```
Esperado: sem erros TS, build OK.

- [ ] **Step 7: Validar visualmente no preview**

Rebuild já gera no `dist/` servido em localhost:4173. Via `mcp__Claude_Preview__preview_eval` limpar SW cache + reload, depois `preview_screenshot`. Conferir: aba Trabalho/Pessoal alterna; TimeInputs salvam; reload mantém valores (persistência). Testar mentalmente 375px e 1440px (tela responsiva única).

---

## Task 5 — Deploy + verificação ponta-a-ponta

**Files:** nenhum (deploy)

- [ ] **Step 1: Deploy backend (engine não muda; só dispatcher + quiet-hours)**

```bash
scp D:/la-organizer/_remote/src/services/quiet-hours.js tom:/opt/LA-Organizer/src/services/quiet-hours.js
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
ssh tom "pm2 restart tom"
```
(PWA vai pelo Stop hook → Vercel.)

- [ ] **Step 2: Rodar o smoke no VPS (sanity em produção)**

```bash
scp D:/la-organizer/_remote/scripts/smoke-quiet-context.js tom:/opt/LA-Organizer/scripts/smoke-quiet-context.js
ssh tom "cd /opt/LA-Organizer && node scripts/smoke-quiet-context.js"
```
Esperado: `ALL PASS`.

- [ ] **Step 3: Cenário Gabi (verificação manual de dados)**

Via MCP `execute_sql`, simular: confirmar que com `quiet_*_work=00:00-14:00` e `personal=null`, uma task `context='personal'` com `remind_at` de manhã NÃO seria deferida e uma `context='work'` seria. (Inspeção lógica — ou aguardar o tick real e observar logs `[Reminders] defer ... quiet work`.)

- [ ] **Step 4: Observar logs por 1 ciclo**

```bash
ssh tom "pm2 logs tom --lines 40 --nostream"
```
Procurar por `quiet work` / `quiet personal` nos defers e confirmar ausência de erro.

---

## Notas de verificação final (self-review do plano)

- **Cobertura do spec:** Seção 1 (dados)→Task 1; Seção 2 (dispatcher)→Tasks 2-3; Seção 3 (UI)→Task 4; Seção 4 (migração+testes)→Task 1 Step 1 (migração de dados) + smoke Tasks 2/5. ✅
- **Semântica:** subtítulos da UI cravam "Trabalho = LA Music / Pessoal = fora". Handoff cobre o TOM-Coach. ✅
- **Back-compat:** `isQuietNow` faz fallback pras colunas antigas; migração copia global→ambos. Comportamento preservado. ✅
- **Hábito sem context:** tratado como `personal` (Task 3 Step 3). ✅
- **Globais preservados:** voz, intensidade, DND, team_summary, max_daily_tasks — não tocados. ✅

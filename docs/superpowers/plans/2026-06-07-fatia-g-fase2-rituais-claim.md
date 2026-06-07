# Fatia G fase 2 — Claim atômico idempotente p/ mensais, CEO reports e LA EDUCA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Estender o claim atômico idempotente (`src/rituals/ritual-claim.js`) aos rituais que AINDA perdem mensagem em erro transitório — mensais, relatórios CEO/líderes e LA EDUCA — sem duplicar nenhuma linha `'sent'` e sem quebrar D/L/G-fase1/finance.

**Architecture:** Reutiliza `claimRitualSend`/`rollbackRitualClaim`/`isTransientRitualError`. O índice parcial único `ritual_logs_sent_daily_uq` é estendido (dedup → DROP/CREATE) para cobrir os tipos novos que gravam **1 'sent' por (colaborador, tipo, período)**. Tipos N/dia (cartões; pendente/atrasado/pronto/escalation do LA EDUCA) NÃO entram no índice — respeitam a regra de cardinalidade (claim por-referência já existe via `la_educa_lembretes_log`/`notifications`).

**Tech Stack:** Node CommonJS, Supabase (project `cesnbnrynvxvgdhfmaua`), pm2 (`engine`), crontab externo (`dispatcher.js`), deploy via scp + md5.

---

## Decisões de design (lidas do código real, 07/06)

1. **`alreadySent` NÃO filtra status** (dispatcher.js:174-187) → qualquer linha (`error`/`skipped`/`intro_shown`) bloqueia. Por isso o padrão-ouro (`fireRitual`, `checkDeadlineAlerts`) NÃO loga `'error'` sob o mesmo tipo do claim. Regra adotada: **on erro transitório → rollback + `console.error` (SEM gravar linha `'error'` em ritual_logs sob o tipo do claim)**, senão o `alreadySent` reintroduz o no-retry. O índice parcial só cobre `status='sent'`, então linhas não-sent nunca colidem com o claim.

2. **`engine.sendRitual` grava `ritual_logs` 'sent' (tipo RAW, reference_date=today) salvo `opts.skipLog`** (engine.js:9373). Mensais hoje gravam 2x 'sent' (engine + dispatcher) — não colide só porque os tipos não estão no índice. Ao adicionar ao índice: `skipLog:true` + remover o `logRitualEvent('sent')` do dispatcher.

3. **Máquina de estado do intro** (`getRitualIntroDecision`, engine.js:10153) lê `ritual_logs` por `ritual_type` exato e decide por `status='sent'`. Dados reais: o ramo intro grava `monthly_planning_intro`/sent (via engine) + `monthly_planning`/intro_shown (via dispatcher); ZERO `monthly_planning`/sent. Para preservar a máquina, o claim do ramo intro usa o tipo `*_intro` (≠ tipo consultado pela decisão). Ambos os tipos (base + intro) entram no índice.

4. **Cardinalidade (regra de ouro):**
   - Claim-safe (1/destinatário/período → índice): `monthly_planning(+_intro)`, `monthly_closing(+_intro)`, `ceo_team_unclosed_events`, `ceo_team_unclosed_tasks`, `leader_unclosed_tasks`, `leader_engagement_weekly`, `la_educa_resumo_mentor`, `la_educa_briefing_sexta`.
   - N/período (FORA do índice): `card_*` (1/cartão/dia → `notifications`), `avaliacao_pendente`/`avaliacao_atrasada`/`certificado_pronto`/`escalation` do LA EDUCA (1/(estagiário,destinatário) → já usam `la_educa_lembretes_log`, retry-safe pois não logam em erro). `la_educa_lembretes`/`la_educa_escalation` (gate system-level, 1 placeholder/dia) ficam de fora do índice (gate bespoke por failure-count).

5. **Bug staleness**: `ceoTeamUnclosedEventsReport` (dispatcher.js:2196) **E** `ceoTeamUnclosedTasksReport` (dispatcher.js:2387) marcam `staleness_check_sent_at` ANTES do `sendMessage`. Mover p/ DEPOIS do envio confirmado (ambos).

6. **Cartões (item 4)**: documentado como FORA de escopo — honesto, não força. `checkCardDueReminders` é N/dia (1/cartão) → precisaria claim por-ref em `notifications` (padrão `checkDeadlineAlerts`); valor marginal (8h diário, perda = 1 dia, não mês). `checkCardLimitAlerts` já tem idempotência própria por faixa (`pf_cards.alert_threshold`) → não precisa.

---

## File Structure

- **Modify** `src/rituals/dispatcher.js`: `checkMonthlyPlanning` (276), `checkMonthlyClosing` (315), `ceoTeamUnclosedEventsReport` (2067), `ceoTeamUnclosedTasksReport` (2232), `perLeaderUnclosedTasksReport` (2450), `weeklyLeaderEngagementReport` (2550), gates LA EDUCA (3182, 3231, 3250).
- **Modify** `src/rituals/la-educa-lembretes.js`: `enviarResumoSemanalMentores` (276), `runLaEducaBriefingSexta` (523), `runLaEducaLembretes`/`runLaEducaEscalation` (return failures).
- **Create** `migrations/20260607140000_ritual_logs_sent_phase2_claim.sql`.
- **Modify** `scripts/smoke-ritual-retry.js` (estender SCOPE + casos novos).
- **No new abstractions** — reusa `ritual-claim.js`.

---

## Task 1 — Migration: estende o índice parcial p/ os tipos claim-safe novos

**Files:** Create `migrations/20260607140000_ritual_logs_sent_phase2_claim.sql`

- [ ] **Step 1: Escrever a migration** (dedup ANTES do CREATE; DROP/CREATE recriando com a lista de 17 tipos)

```sql
-- Fatia G fase 2 (final): estende ritual_logs_sent_daily_uq aos rituais claim-safe
-- restantes — mensais (+intro), relatórios CEO/líderes e os 2 LA EDUCA por-mentor.
-- Todos gravam 1 'sent' por (colaborador, tipo, período). N/dia (cartões; pendente/
-- atrasado/pronto/escalation LA EDUCA) NÃO entram (claim por-referência).

-- 1) Dedup defensivo dos tipos novos antes de entrar no índice único
--    (dados 07/06: ceo_team_unclosed_events 1 dup, ceo_team_unclosed_tasks 2 dups).
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY collaborator_id, ritual_type, reference_date ORDER BY created_at
  ) AS rn
  FROM ritual_logs
  WHERE status = 'sent'
    AND ritual_type IN (
      'monthly_planning','monthly_planning_intro','monthly_closing','monthly_closing_intro',
      'ceo_team_unclosed_events','ceo_team_unclosed_tasks','leader_unclosed_tasks',
      'leader_engagement_weekly','la_educa_resumo_mentor','la_educa_briefing_sexta'
    )
)
DELETE FROM ritual_logs r USING ranked k WHERE r.id = k.id AND k.rn > 1;

-- 2) Recria o índice parcial com os 7 tipos da fase 1 + os 10 novos (17 no total).
DROP INDEX IF EXISTS ritual_logs_sent_daily_uq;
CREATE UNIQUE INDEX ritual_logs_sent_daily_uq
  ON ritual_logs (collaborator_id, ritual_type, reference_date)
  WHERE status = 'sent'
    AND ritual_type IN (
      'daily_briefing','personal_briefing','daily_closing','weekly_planning',
      'lembrete_conta','financeiro_mensal','relatorio_financeiro_mensal',
      'monthly_planning','monthly_planning_intro','monthly_closing','monthly_closing_intro',
      'ceo_team_unclosed_events','ceo_team_unclosed_tasks','leader_unclosed_tasks',
      'leader_engagement_weekly','la_educa_resumo_mentor','la_educa_briefing_sexta'
    );
```

- [ ] **Step 2: Aplicar via MCP** `apply_migration(project_id='cesnbnrynvxvgdhfmaua', name='ritual_logs_sent_phase2_claim', query=<acima>)`
- [ ] **Step 3: Confirmar** via `execute_sql`: `SELECT indexdef FROM pg_indexes WHERE indexname='ritual_logs_sent_daily_uq';` — esperado: 17 tipos na cláusula WHERE.

---

## Task 2 — `checkMonthlyPlanning`: claim dual-type (intro/ritual), skipLog, sem 'sent' duplicado

**Files:** Modify `src/rituals/dispatcher.js:294-310` (corpo do try dentro do for)

- [ ] **Step 1: Substituir o bloco try (linhas 294-309)** por claim antes-de-enviar. Mantém `alreadySent` (291) como pre-skip; ramo saturated inalterado; em erro transitório rollback + console (sem linha 'error', p/ não bloquear retry):

```js
    try {
      const decision = await getRitualIntroDecision(c.id, 'monthly_planning');
      if (decision === 'skip_saturated') {
        await logRitualEvent(c.id, 'monthly_planning', 'skipped', 'saturated', ymdToday);
        continue;
      }
      // Fatia G fase 2: claim atômico antes de enviar (era log 'sent' pós-envio →
      // perdia o mês em erro transitório). Ramo intro claima sob '*_intro' p/ NÃO
      // mexer na máquina de estado do intro (getRitualIntroDecision lê 'monthly_planning').
      const rawType = decision === 'show_intro' ? 'monthly_planning_intro' : 'monthly_planning';
      const claim = await claimRitualSend(supabase, c.id, rawType, ymdToday);
      if (!claim.won) {
        if (!claim.duplicate) console.error(`[checkMonthlyPlanning] claim_err(${claim.code}) ${c.full_name}`);
        continue;
      }
      try {
        // skipLog: o claim já gravou a linha 'sent' (evita 2ª escrita → 23505 no índice).
        await sendRitual(c.id, rawType, { skipLog: true });
        if (decision === 'show_intro') await logRitualEvent(c.id, 'monthly_planning', 'intro_shown', null, ymdToday);
        fired++;
      } catch (errSend) {
        // Transitório (pré-entrega) → rollback libera re-tentativa no próximo tick do slot.
        // SEM logRitualEvent('error') sob 'monthly_planning': alreadySent bloquearia o retry.
        if (isTransientRitualError(errSend)) await rollbackRitualClaim(supabase, claim.id);
        console.error('[checkMonthlyPlanning] send', c.full_name, errSend.message);
      }
    } catch (err) {
      console.error('[checkMonthlyPlanning]', c.full_name, err.message);
    }
```

- [ ] **Step 2:** `node --check src/rituals/dispatcher.js` → Expected: sem erro.

---

## Task 3 — `checkMonthlyClosing`: idem (dual-type)

**Files:** Modify `src/rituals/dispatcher.js:326-339`

- [ ] **Step 1: Substituir o bloco try (linhas 326-339)**:

```js
    try {
      const decision = await getRitualIntroDecision(c.id, 'monthly_closing');
      if (decision === 'skip_saturated') {
        await logRitualEvent(c.id, 'monthly_closing', 'skipped', 'saturated', ymdToday);
        continue;
      }
      const rawType = decision === 'show_intro' ? 'monthly_closing_intro' : 'monthly_closing';
      const claim = await claimRitualSend(supabase, c.id, rawType, ymdToday);
      if (!claim.won) {
        if (!claim.duplicate) console.error(`[checkMonthlyClosing] claim_err(${claim.code}) ${c.full_name}`);
        continue;
      }
      try {
        await sendRitual(c.id, rawType, { skipLog: true });
        if (decision === 'show_intro') await logRitualEvent(c.id, 'monthly_closing', 'intro_shown', null, ymdToday);
      } catch (errSend) {
        if (isTransientRitualError(errSend)) await rollbackRitualClaim(supabase, claim.id);
        console.error('[checkMonthlyClosing] send', c.full_name, errSend.message);
      }
    } catch (err) {
      console.error('[checkMonthlyClosing]', c.full_name, err.message);
    }
```

- [ ] **Step 2:** `node --check src/rituals/dispatcher.js`.

---

## Task 4 — `ceoTeamUnclosedEventsReport`: claim + staleness DEPOIS do envio

**Files:** Modify `src/rituals/dispatcher.js:2182-2218`

- [ ] **Step 1: Tirar a marcação de staleness do bloco de montagem.** Substituir o bloco (2194-2205, o `if (toStaleCheck.length > 0)` que faz o `.update`) por SÓ montar o texto, sem o `.update`:

```js
    let staleCheckBlock = '';
    if (toStaleCheck.length > 0) {
      const top3 = toStaleCheck.slice(0, 3).map(ev =>
        `  • _${String(ev.title).slice(0, 50)}_`
      ).join('\n');
      staleCheckBlock = `\n\n─────────────────────\n⏳ *${toStaleCheck.length} item${toStaleCheck.length > 1 ? 's' : ''} parado${toStaleCheck.length > 1 ? 's' : ''} 5+ dias — já rolou?*\n${top3}${toStaleCheck.length > 3 ? `\n  _+${toStaleCheck.length - 3} outros_` : ''}\n_Sem resposta até amanhã → arquivo automático_`;
      // Bug fix Fatia G fase 2: NÃO marca staleness aqui (era ANTES do envio → se o
      // envio falhasse, os itens sumiam do report de amanhã). Marca DEPOIS do envio.
    }
```

- [ ] **Step 2: Substituir o try/catch de envio (2211-2218)** por claim + send + staleness pós-envio:

```js
    // Fatia G fase 2: claim atômico antes de enviar (1/CEO/dia → claim-safe).
    const claim = await claimRitualSend(supabase, ceo.id, 'ceo_team_unclosed_events', ymdRef);
    if (!claim.won) {
      if (!claim.duplicate) console.error(`[CEOReport] claim_err(${claim.code}) ${String(ceo.phone).slice(-4)}`);
      continue;
    }
    try {
      await whatsapp.sendMessage(ceo.phone, msg);
      // Marca staleness SÓ após envio confirmado (bug fix).
      if (toStaleCheck.length > 0) {
        const { error: staleEvErr } = await supabase.from('events')
          .update({ staleness_check_sent_at: now.toISOString() })
          .in('id', toStaleCheck.map(ev => ev.id))
          .select('id');
        if (staleEvErr) console.error(`[CEOReport] staleness mark FAILED: ${staleEvErr.message}`);
        else console.log(`[CEOReport] staleness marcou ${toStaleCheck.length} evento(s)`);
      }
      console.log(`[CEOReport] sent ${filteredStale.length} (${hiddenCount} hidden) → ${String(ceo.phone).slice(-4)}`);
    } catch (err) {
      console.error(`[CEOReport] send err ${String(ceo.phone).slice(-4)}:`, err.message);
      if (isTransientRitualError(err)) await rollbackRitualClaim(supabase, claim.id);
    }
```

- [ ] **Step 3:** `node --check src/rituals/dispatcher.js`. Mantém `alreadySent` pre-gate (2085) e o quiet DEFER (2090). Remove o `logRitualEvent('sent')` antigo (o claim grava). Skip-paths (none_found/all_recently_asked) inalterados.

---

## Task 5 — `ceoTeamUnclosedTasksReport`: claim + staleness DEPOIS do envio (mesmo bug)

**Files:** Modify `src/rituals/dispatcher.js:2386-2439`

- [ ] **Step 1: Tirar o `.update` de staleness do bloco de montagem (2386-2396)** — manter só a montagem do texto:

```js
    let staleCheckBlock = '';
    if (toStaleCheck.length > 0) {
      const top3 = toStaleCheck.slice(0, 3).map(t =>
        `  • _${String(t.title).slice(0, 50)}_`
      ).join('\n');
      staleCheckBlock = `\n\n─────────────────────\n⏳ *${toStaleCheck.length} tarefa${toStaleCheck.length > 1 ? 's' : ''} parada${toStaleCheck.length > 1 ? 's' : ''} 5+ dias — já rolou?*\n${top3}${toStaleCheck.length > 3 ? `\n  _+${toStaleCheck.length - 3} outras_` : ''}\n_Sem resposta até amanhã → arquivo automático_`;
      // Bug fix Fatia G fase 2: marca staleness DEPOIS do envio (era antes).
    }
```

- [ ] **Step 2: Substituir o try/catch de envio (2432-2439)**:

```js
    const claim = await claimRitualSend(supabase, ceo.id, 'ceo_team_unclosed_tasks', ymdRef);
    if (!claim.won) {
      if (!claim.duplicate) console.error(`[CEOTasksReport] claim_err(${claim.code}) ${String(ceo.phone).slice(-4)}`);
      continue;
    }
    try {
      await whatsapp.sendMessage(ceo.phone, msg);
      if (toStaleCheck.length > 0) {
        const { error: staleTaskErr } = await supabase.from('tasks')
          .update({ staleness_check_sent_at: now.toISOString() })
          .in('id', toStaleCheck.map(t => t.id))
          .select('id');
        if (staleTaskErr) console.error(`[CEOTasksReport] staleness mark FAILED: ${staleTaskErr.message}`);
        else console.log(`[CEOTasksReport] staleness marcou ${toStaleCheck.length} task(s)`);
      }
      console.log(`[CEOTasksReport] sent ${stale.length} (${ceoBucket.length} CEO direto) → ${String(ceo.phone).slice(-4)}`);
    } catch (err) {
      console.error(`[CEOTasksReport] send err ${String(ceo.phone).slice(-4)}:`, err.message);
      if (isTransientRitualError(err)) await rollbackRitualClaim(supabase, claim.id);
    }
```

- [ ] **Step 3:** `node --check src/rituals/dispatcher.js`.

---

## Task 6 — `perLeaderUnclosedTasksReport`: claim por líder (1/líder/dia)

**Files:** Modify `src/rituals/dispatcher.js:2522-2529` (try/catch dentro do `for (const p of plan)`)

- [ ] **Step 1: Substituir o try/catch (2522-2529)** por claim antes-de-enviar (mantém alreadySent 2517 + quiet DEFER 2521):

```js
    // Fatia G fase 2: claim atômico por líder (1/líder/dia → claim-safe; cada líder é collab distinto).
    const claim = await claimRitualSend(supabase, p.leaderId, 'leader_unclosed_tasks', ymdRef);
    if (!claim.won) {
      if (!claim.duplicate) console.error(`[LeaderTasksReport] claim_err(${claim.code}) ${p.leaderName}`);
      continue;
    }
    try {
      await whatsapp.sendMessage(p.phone, p.msg);
      console.log(`[LeaderTasksReport] ${p.leaderName}: ${p.count} → ${String(p.phone).slice(-4)}`);
    } catch (err) {
      console.error(`[LeaderTasksReport] ${p.leaderName} err:`, err.message);
      if (isTransientRitualError(err)) await rollbackRitualClaim(supabase, claim.id);
    }
```

- [ ] **Step 2:** `node --check src/rituals/dispatcher.js`. (`opts.dryRun` retorna antes, em 2514 — não afetado.)

---

## Task 7 — `weeklyLeaderEngagementReport`: claim (1/CEO/segunda)

**Files:** Modify `src/rituals/dispatcher.js:2652-2659`

- [ ] **Step 1: Substituir o try/catch (2652-2659)**:

```js
    const claim = await claimRitualSend(supabase, ceo.id, 'leader_engagement_weekly', ymdRef);
    if (!claim.won) {
      if (!claim.duplicate) console.error(`[LeaderEngagement] claim_err(${claim.code}) ${String(ceo.phone).slice(-4)}`);
      continue;
    }
    try {
      await whatsapp.sendMessage(ceo.phone, msg);
      console.log(`[LeaderEngagement] sent ${blocks.length} leader blocks → ${String(ceo.phone).slice(-4)}`);
    } catch (err) {
      console.error(`[LeaderEngagement] send err ${String(ceo.phone).slice(-4)}:`, err.message);
      if (isTransientRitualError(err)) await rollbackRitualClaim(supabase, claim.id);
    }
```

- [ ] **Step 2:** `node --check src/rituals/dispatcher.js`.

---

## Task 8 — LA EDUCA por-mentor: claim em `enviarResumoSemanalMentores` e `runLaEducaBriefingSexta`

**Files:** Modify `src/rituals/la-educa-lembretes.js`

Contexto: estes 2 gravam `ritual_logs` per-mentor (1/mentor/período) via check-then-act (query `jaEnviou` + insert pós-envio). Vira claim. `reference_date` = segunda da semana (chave estável/semana). Pendente/atrasado/pronto/escalation NÃO mudam (cardinalidade N/(estagiário,destinatário) → `la_educa_lembretes_log`).

- [ ] **Step 1: Importar o helper e adicionar `weekStartYmd`** no topo (após linha 11):

```js
const { claimRitualSend, rollbackRitualClaim, isTransientRitualError } = require('./ritual-claim');

// Segunda-feira da semana atual em America/Sao_Paulo, como YYYY-MM-DD (chave de claim 1/mentor/semana).
function weekStartYmd() {
  const p = nowBrtParts(); // { y|year, m|month, d|day, ... } — usamos só p/ derivar a data BRT
  const ymd = (p.ymd) || `${p.year || p.y}-${String(p.month || p.m).padStart(2,'0')}-${String(p.day || p.d).padStart(2,'0')}`;
  const [Y, M, D] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(Y, M - 1, D));
  const dow = dt.getUTCDay();           // 0=dom..6=sáb
  const off = dow === 0 ? -6 : 1 - dow; // → segunda
  dt.setUTCDate(dt.getUTCDate() + off);
  return dt.toISOString().slice(0, 10);
}
```

> NOTA P/ EXECUÇÃO: confirmar a forma de `nowBrtParts()` (`require('../services/quiet-hours')`) com `node -e` ANTES — se já expõe `.ymd`, usar direto; ajustar o derivador conforme o shape real.

- [ ] **Step 2: `enviarResumoSemanalMentores` — trocar query+insert por claim.** Substituir o bloco `const { data: jaEnviou } ... if (jaEnviou...) continue;` (linhas 296-304) e o `try { ... insert ... }` (317-330) por:

```js
    const refWeek = weekStartYmd();
    // ... (montagem de linhasEstagiarios permanece igual) ...
    const primeiroNome = mentor.full_name.split(' ')[0];
    const msg = `📊 LA EDUCA — Resumo semanal\n\nOlá ${primeiroNome}! Aqui está o resumo dos estagiários sob sua coordenação:\n\n${linhasEstagiarios.join('\n\n')}\n\nAcesse o LA Organizer pra acompanhar 🎵`;
    if ((await isQuietNow(mentor.id, nowBrtParts(), 'work')).quiet) continue; // silêncio → defer
    // Fatia G fase 2: claim atômico (1/mentor/semana) antes de enviar.
    const claim = await claimRitualSend(supabase, mentor.id, 'la_educa_resumo_mentor', refWeek);
    if (!claim.won) { if (!claim.duplicate) console.error(`[la-educa resumo] claim_err(${claim.code}) ${mentor.full_name}`); failures += claim.duplicate ? 0 : 1; continue; }
    try {
      await whatsapp.sendMessage(mentor.phone, msg);
      enviados++;
    } catch (err) {
      console.error(`[la-educa resumo] falha pra ${mentor.full_name}: ${err.message}`);
      if (isTransientRitualError(err)) { await rollbackRitualClaim(supabase, claim.id); failures++; }
    }
```

> A query `jaEnviou` (296-304) é REMOVIDA (o claim 23505 é o gate). Mover o `isQuietNow` p/ antes do claim (não claimar em silêncio). Declarar `let failures = 0;` no topo da função e `return failures;` no fim.

- [ ] **Step 3: `runLaEducaBriefingSexta` — idem.** Remover a query `jaEnviou` (535-542) e trocar o `try` (555-568):

```js
    const refWeek = weekStartYmd();
    // ... (montagem de `msg` igual) ...
    if ((await isQuietNow(mentor.id, nowBrtParts(), 'work')).quiet) continue; // silêncio → defer
    const claim = await claimRitualSend(supabase, mentor.id, 'la_educa_briefing_sexta', refWeek);
    if (!claim.won) { if (!claim.duplicate) console.error(`[la-educa briefing-sexta] claim_err(${claim.code}) ${mentor.full_name}`); failures += claim.duplicate ? 0 : 1; continue; }
    try {
      await whatsapp.sendMessage(mentor.phone, msg);
      enviados++;
    } catch (err) {
      console.error(`[la-educa briefing-sexta] ${mentor.full_name}: ${err.message}`);
      if (isTransientRitualError(err)) { await rollbackRitualClaim(supabase, claim.id); failures++; }
    }
```

> `let failures = 0;` no topo, `return failures;` no fim. O `pend` (estagiários pendentes) continua sendo o filtro de quem recebe.

- [ ] **Step 4:** `node --check src/rituals/la-educa-lembretes.js`.

---

## Task 9 — LA EDUCA gates: retry intra-slot + marcar gate só sem falha

**Files:** Modify `src/rituals/la-educa-lembretes.js` (returns) e `src/rituals/dispatcher.js:3182-3256`

Problema: gates `la_educa_lembretes`/`la_educa_escalation` disparam só em `minute===0` (1 tick → zero retry) e marcam 'sent' DEPOIS da função retornar, mesmo com falha por destinatário. Fix: relaxar p/ slot (3 ticks) + marcar o gate só se `failures===0`.

- [ ] **Step 1: `runLaEducaLembretes` retorna failures.** Em `la-educa-lembretes.js`, dentro do for de `enviarPendente/enviarAtrasado/enviarProntoCert`, acumular falhas: fazer cada `enviarX` retornar nº de falhas de envio (incrementar num `let falhas=0` local em cada uma, retornar; e no catch de cada `whatsapp.sendMessage`, `falhas++`). `runLaEducaLembretes` soma + `const fResumo = await enviarResumoSemanalMentores();` e `return falhasTotais + fResumo;`.

```js
// exemplo enviarPendente: declarar `let falhas = 0;` no início; no catch interno: `falhas++;`
// trocar `return;` early por `return 0;`; no fim `return falhas;`
// runLaEducaLembretes:
  let falhasTotais = 0;
  for (const e of lista || []) {
    // ...
    if (Number(e.percentual) === 100 && !e.certificado_emitido) { falhasTotais += await enviarProntoCert(e); stats.pronto++; continue; }
    if (Number(e.percentual) >= 100) continue;
    if (dias > 14) { falhasTotais += await enviarAtrasado(e); stats.atrasado++; }
    else if (dias > 7 && e.mentor_id) { falhasTotais += await enviarPendente(e); stats.pendente++; }
  }
  // ...
  const fResumo = await enviarResumoSemanalMentores();
  return falhasTotais + fResumo;
```

- [ ] **Step 2: `runLaEducaEscalation` retorna failures** (mesmo padrão: `let falhas=0` no for interno, `falhas++` no catch, `return falhas;`).

- [ ] **Step 3: dispatcher gate `la_educa_lembretes` (3182-3216)** — relaxar p/ slot + gate por failures:

```js
  if (opts.force === 'la_educa_lembretes' ||
      (now.dow === 1 && timeToSlot(LA_EDUCA_LEMBRETES_TIME) === slotNow)) {
    const { data: jaRodou } = await supabase
      .from('ritual_logs').select('id')
      .eq('ritual_type', 'la_educa_lembretes').eq('reference_date', now.ymd).limit(1);
    if (opts.force !== 'la_educa_lembretes' && jaRodou && jaRodou.length > 0) {
      console.log('[la-educa-dispatch] já rodou hoje, skip');
    } else {
      try {
        const falhas = await runLaEducaLembretes();
        // Marca o gate SÓ se zero falhas — senão deixa re-tentar no próximo tick do slot.
        if (falhas === 0) {
          const { data: dir } = await supabase.from('collaborators')
            .select('id').eq('role', 'director').eq('is_active', true).order('full_name').limit(1).single();
          await supabase.from('ritual_logs').insert({
            collaborator_id: dir?.id, ritual_type: 'la_educa_lembretes',
            reference_date: now.ymd, status: 'sent', sent_at: new Date().toISOString(),
          });
        } else {
          console.log(`[la-educa-dispatch] ${falhas} falha(s) → gate não marcado, retry no próximo tick`);
        }
      } catch (err) { console.error('[la-educa-dispatch] erro:', err.message); }
    }
  }
```

- [ ] **Step 4: dispatcher gate `la_educa_escalation` (3231-3248)** — mesma relaxação (`now.dow === 3 && timeToSlot(LA_EDUCA_ESCALATION_TIME) === slotNow`) + marcar só se `falhas===0` (espelha Step 3).

- [ ] **Step 5: dispatcher gate `la_educa_briefing_sexta` (3250-3256)** — relaxar `now.dow === 5 && timeToSlot(LA_EDUCA_BRIEFING_SEXTA_TIME) === slotNow` (tira `minute===0`). Não há gate ritual_logs aqui; o claim por-mentor (Task 8) já dá idempotência + retry intra-slot.

- [ ] **Step 6:** `node --check` nos 2 arquivos.

---

## Task 10 — Smoke: estender `scripts/smoke-ritual-retry.js`

**Files:** Modify `scripts/smoke-ritual-retry.js`

- [ ] **Step 1: Estender o SCOPE (linha 13)** com os 10 tipos novos:

```js
const SCOPE = new Set([
  'daily_briefing', 'personal_briefing', 'daily_closing', 'weekly_planning',
  'lembrete_conta', 'financeiro_mensal', 'relatorio_financeiro_mensal',
  'monthly_planning', 'monthly_planning_intro', 'monthly_closing', 'monthly_closing_intro',
  'ceo_team_unclosed_events', 'ceo_team_unclosed_tasks', 'leader_unclosed_tasks',
  'leader_engagement_weekly', 'la_educa_resumo_mentor', 'la_educa_briefing_sexta',
]);
```

- [ ] **Step 2: Adicionar seção 5 (dual-type intro/ritual mensal)** antes do `console.log(ok ...)`:

```js
  console.log('\n=== 5) Mensal dual-type: intro e ritual não colidem entre si ===');
  {
    const db = makeFakeSupabase();
    const i1 = await claimRitualSend(db, COLLAB, 'monthly_planning_intro', YMD);
    const r1 = await claimRitualSend(db, COLLAB, 'monthly_planning', YMD);
    check(i1.won && r1.won, '5.1 intro e ritual são chaves distintas (ambos vencem no mesmo dia)');
    const i2 = await claimRitualSend(db, COLLAB, 'monthly_planning_intro', YMD);
    check(i2.won === false && i2.duplicate, '5.2 2º claim do intro no mesmo dia → 23505');
    const ev = await claimRitualSend(db, COLLAB, 'ceo_team_unclosed_events', YMD);
    const ev2 = await claimRitualSend(db, COLLAB, 'ceo_team_unclosed_events', YMD);
    check(ev.won && ev2.won === false && ev2.duplicate, '5.3 ceo_team_unclosed_events dedup 1/dia');
    const le = await claimRitualSend(db, COLLAB, 'la_educa_resumo_mentor', YMD);
    const le2 = await claimRitualSend(db, COLLAB, 'la_educa_resumo_mentor', YMD);
    check(le.won && le2.won === false && le2.duplicate, '5.4 la_educa_resumo_mentor dedup 1/semana');
  }
```

- [ ] **Step 3: Rodar** `node scripts/smoke-ritual-retry.js` → Expected: `🟢 SMOKE PASS`.

---

## Task 11 — Round-trip real no DB (por tipo novo) via MCP

- [ ] **Step 1:** `execute_sql` com DO block usando um collaborator real (director). Para cada tipo novo: insert 'sent' → 2º insert (espera 23505) → delete → reclaim → cleanup. Usar `reference_date='2099-01-01'` (data fictícia, zero colisão com produção) e limpar no fim:

```sql
DO $$
DECLARE cid uuid; t text; ok boolean;
DECLARE types text[] := ARRAY[
  'monthly_planning','monthly_planning_intro','monthly_closing','monthly_closing_intro',
  'ceo_team_unclosed_events','ceo_team_unclosed_tasks','leader_unclosed_tasks',
  'leader_engagement_weekly','la_educa_resumo_mentor','la_educa_briefing_sexta'];
BEGIN
  SELECT id INTO cid FROM collaborators WHERE is_active LIMIT 1;
  FOREACH t IN ARRAY types LOOP
    INSERT INTO ritual_logs(collaborator_id,ritual_type,reference_date,status,sent_at)
      VALUES (cid,t,'2099-01-01','sent',now());
    BEGIN
      INSERT INTO ritual_logs(collaborator_id,ritual_type,reference_date,status,sent_at)
        VALUES (cid,t,'2099-01-01','sent',now());
      RAISE EXCEPTION '%: 2º insert NÃO colidiu (índice não cobre o tipo!)', t;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE '% OK: 23505 no 2º claim', t;
    END;
    DELETE FROM ritual_logs WHERE collaborator_id=cid AND ritual_type=t AND reference_date='2099-01-01';
  END LOOP;
  RAISE NOTICE 'round-trip OK p/ todos os tipos novos';
END $$;
```

- [ ] **Step 2: Cleanup garantido:** `DELETE FROM ritual_logs WHERE reference_date='2099-01-01';` → confirmar `SELECT count(*) ... WHERE reference_date='2099-01-01'` = 0.

---

## Task 12 — Deploy: scp + md5 VPS==local + restart engine

- [ ] **Step 1: scp dos 3 arquivos** (ABSOLUTO):

```bash
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
scp D:/la-organizer/_remote/src/rituals/la-educa-lembretes.js tom:/opt/LA-Organizer/src/rituals/la-educa-lembretes.js
scp D:/la-organizer/_remote/scripts/smoke-ritual-retry.js tom:/opt/LA-Organizer/scripts/smoke-ritual-retry.js
```

- [ ] **Step 2: md5 VPS==local** dos 3:

```bash
ssh tom "md5sum /opt/LA-Organizer/src/rituals/dispatcher.js /opt/LA-Organizer/src/rituals/la-educa-lembretes.js /opt/LA-Organizer/scripts/smoke-ritual-retry.js"
# comparar com md5sum local (git bash) / Get-FileHash -Algorithm MD5
```

- [ ] **Step 3: node --check na VPS** (3 arquivos) + smoke na VPS:

```bash
ssh tom "cd /opt/LA-Organizer && node --check src/rituals/dispatcher.js && node --check src/rituals/la-educa-lembretes.js && node scripts/smoke-ritual-retry.js"
```

- [ ] **Step 4: restart engine** (dispatcher é crontab, pega no próximo tick; engine.sendRitual NÃO mudou mas restart é barato e garante require-graph):

```bash
ssh tom "pm2 restart tom && sleep 3 && pm2 jlist | node -e \"let d=JSON.parse(require('fs').readFileSync(0));let t=d.find(p=>p.name==='tom');console.log('status',t.pm2_env.status,'unstable',t.pm2_env.unstable_restarts)\""
```
Expected: `status online unstable 0`.

> O `dispatcher.js` NÃO roda no pm2 (crontab externo) — o restart não o recarrega; o próximo tick do cron pega a versão nova já scp-ada. Confirmar require-graph com o `node --check` na VPS (Step 3).

---

## Task 13 — Registrar em `tom_known_issues`

- [ ] **Step 1: `execute_sql` INSERT** do código `RITUAL-NO-RETRY-FASE2-FINAL` (ou UPDATE de RITUAL-NO-RETRY-FASE2-FIN) com: tipos estendidos (mensais dual-type + 4 reports + 2 la-educa), bug staleness corrigido nos 2 CEO reports, decisão de não-logar-error-sob-tipo-do-claim, cartões fora de escopo (documentado), gate la-educa relaxado p/ slot + failure-count. Garantia honesta repetida: zero linha 'sent' duplicada (índice de 17 tipos) + janela residual de reenvio equivalente a checkDeadlineAlerts.

---

## Garantia honesta (repetir no ledger)

Zero linha `'sent'` duplicada — garantido pelo índice parcial único `ritual_logs_sent_daily_uq` (17 tipos). A janela residual de reenvio é **equivalente à de `checkDeadlineAlerts`**: a mensagem PODE, em tese, sair 2x se o WhatsApp entregou mas o cliente acusou erro transitório DEPOIS da entrega. **NÃO é "nunca duplica a mensagem".** Cartões e os 4 tipos N/dia do LA EDUCA ficam FORA do índice por cardinalidade (claim por-referência via `notifications`/`la_educa_lembretes_log`).

## Self-review
- Cobertura: itens 1 (mensais T2/T3), 2 (CEO reports T4/T5/T6/T7 + bug staleness nos DOIS), 3 (la-educa T8/T9), 4 (cartões → documentado fora de escopo). ✓
- Cardinalidade: só tipos 1/destinatário/período no índice; N/dia explicitamente fora. ✓
- Não desfaz D/L/G-fase1/finance: nenhuma das edições toca fireRitual/finance/isChronicallySilent/planning_time. ✓

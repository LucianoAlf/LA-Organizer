// scripts/smoke-ritual-retry.js
// Fatia G (RITUAL-NO-RETRY) — prova a lógica de claim/rollback/transient do envio
// idempotente de rituais, exercitando as FUNÇÕES REAIS de src/rituals/ritual-claim.js
// contra um fake in-memory do supabase que emula o índice único parcial
// ritual_logs_sent_daily_uq (WHERE status='sent' AND ritual_type IN <família briefing>).
// DB-free, no estilo de smoke-silence-backoff.js.
// Rodar: node scripts/smoke-ritual-retry.js
'use strict';

const { claimRitualSend, rollbackRitualClaim, isTransientRitualError } = require('../src/rituals/ritual-claim');

// Escopo do índice parcial real (igual à migration). Fase 1 (briefing) + finance +
// fase 2 final (mensais dual-type + reports CEO/líderes + 2 LA EDUCA por-mentor).
const SCOPE = new Set([
  'daily_briefing', 'personal_briefing', 'daily_closing', 'weekly_planning',
  'lembrete_conta', 'financeiro_mensal', 'relatorio_financeiro_mensal',
  'monthly_planning', 'monthly_planning_intro', 'monthly_closing', 'monthly_closing_intro',
  'ceo_team_unclosed_events', 'ceo_team_unclosed_tasks', 'leader_unclosed_tasks',
  'leader_engagement_weekly', 'la_educa_resumo_mentor', 'la_educa_briefing_sexta',
]);

// Fake supabase: emula .insert(row).select('id').single() e .delete().eq('id', val)
// para a tabela ritual_logs, aplicando a colisão 23505 do índice parcial.
function makeFakeSupabase() {
  const rows = [];
  let seq = 0;
  return {
    _rows: rows,
    from(table) {
      if (table !== 'ritual_logs') throw new Error(`fake só suporta ritual_logs (pediu ${table})`);
      return {
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  // Emula o índice parcial: unique em (collab,type,date) só quando
                  // status='sent' E ritual_type no escopo.
                  if (row.status === 'sent' && SCOPE.has(row.ritual_type)) {
                    const clash = rows.find(r =>
                      r.status === 'sent' && SCOPE.has(r.ritual_type) &&
                      r.collaborator_id === row.collaborator_id &&
                      r.ritual_type === row.ritual_type &&
                      r.reference_date === row.reference_date);
                    if (clash) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ritual_logs_sent_daily_uq"' } };
                  }
                  const saved = { id: 'r' + (++seq), ...row };
                  rows.push(saved);
                  return { data: { id: saved.id }, error: null };
                },
              };
            },
          };
        },
        delete() {
          return {
            async eq(col, val) {
              const i = rows.findIndex(r => r[col] === val);
              if (i >= 0) rows.splice(i, 1);
              return { error: null };
            },
          };
        },
      };
    },
  };
}

let ok = true;
const check = (cond, desc) => { if (!cond) ok = false; console.log(`${cond ? '✅' : '❌'} ${desc}`); };

const COLLAB = '00000000-0000-0000-0000-000000000abc';
const YMD = '2026-06-07';

(async () => {
  // ── 1) Claim/rollback contra o índice parcial (tipo NO escopo) ─────────────
  console.log('=== 1) Claim atômico + rollback (daily_briefing, no escopo) ===');
  {
    const db = makeFakeSupabase();
    const c1 = await claimRitualSend(db, COLLAB, 'daily_briefing', YMD);
    check(c1.won === true && !!c1.id, '1.1 1º claim VENCE (won, id)');

    const c2 = await claimRitualSend(db, COLLAB, 'daily_briefing', YMD);
    check(c2.won === false && c2.duplicate === true, '1.2 2º claim mesmo dia → 23505 → duplicate (skip)');
    check(db._rows.filter(r => r.status === 'sent').length === 1, '1.3 só 1 linha sent (zero duplicada)');

    // Erro transitório pós-claim → rollback libera o re-envio no próximo tick.
    await rollbackRitualClaim(db, c1.id);
    check(db._rows.length === 0, '1.4 rollback removeu o claim');

    const c3 = await claimRitualSend(db, COLLAB, 'daily_briefing', YMD);
    check(c3.won === true, '1.5 após rollback, novo tick RE-CLAIMA e vence (ritual recuperado)');
  }

  // ── 2) Tipo FORA do escopo (N/dia: daily_dream/cartões) — degrada sem dedup ──
  console.log('\n=== 2) Tipo fora do escopo (daily_dream) — sem constraint ===');
  {
    const db = makeFakeSupabase();
    const a = await claimRitualSend(db, COLLAB, 'daily_dream', YMD);
    const b = await claimRitualSend(db, COLLAB, 'daily_dream', YMD);
    check(a.won && b.won, '2.1 ambos vencem (fora do índice — N/dia, claim por-ref vive noutro lugar)');
  }

  // ── 3) Classificação de erro transitório ───────────────────────────────────
  console.log('\n=== 3) isTransientRitualError ===');
  const T = [
    [{ code: '23505' }, false, '23505 (unique pós-claim) → NÃO transitório (não duplica)'],
    [{ code: '08006' }, false, '08006 (PG connection_failure) → NÃO transitório'],
    [{ code: '08003' }, false, '08003 (PG connection_does_not_exist) → NÃO transitório'],
    [{ code: '08000' }, false, '08000 (PG connection_exception) → NÃO transitório'],
    [{ code: 'ETIMEDOUT', message: 'request timeout' }, true, 'ETIMEDOUT (rede IA) → transitório'],
    [{ message: 'fetch failed', cause: { code: 'ECONNRESET' } }, true, 'fetch failed/ECONNRESET → transitório'],
    [new Error('AI provider 503 Service Unavailable'), true, 'erro 5xx do provider (sem code) → transitório'],
    [{ code: '57014', message: 'statement timeout' }, true, '57014 (PG, não-08/23505) → transitório'],
    [null, false, 'null → não transitório'],
    [undefined, false, 'undefined → não transitório'],
  ];
  for (const [err, expected, desc] of T) {
    check(isTransientRitualError(err) === expected, `3.x ${desc}`);
  }

  // ── 4) Máquina de estados do fireRitual (usando os helpers reais) ──────────
  // Simula a decisão do fireRitual: claim → enviar; em erro transitório faz rollback;
  // em erro NÃO transitório (pós-entrega) mantém o claim (sem reenvio).
  console.log('\n=== 4) Fluxo fireRitual simulado ===');
  async function fireSim(db, sendOutcome) {
    const claim = await claimRitualSend(db, COLLAB, 'daily_closing', YMD);
    if (!claim.won) return claim.duplicate ? 'skip_ja_enviado' : 'skip_claim_err';
    try {
      if (sendOutcome) throw sendOutcome; // simula falha do envio
      return 'sent';
    } catch (err) {
      if (isTransientRitualError(err)) await rollbackRitualClaim(db, claim.id);
      return 'error';
    }
  }
  {
    // 4.1 Transitório no tick 1 → rollback → tick 2 recupera e envia.
    const db = makeFakeSupabase();
    const r1 = await fireSim(db, { code: 'ETIMEDOUT' });
    const r2 = await fireSim(db, null);
    check(r1 === 'error' && r2 === 'sent', '4.1 transitório no tick1 → recupera e envia no tick2');
    check(db._rows.filter(r => r.status === 'sent').length === 1, '4.1b exatamente 1 sent ao final');
  }
  {
    // 4.2 Erro pós-entrega (08*) → claim mantido → tick 2 vê duplicate → NÃO reenvia.
    const db = makeFakeSupabase();
    const r1 = await fireSim(db, { code: '08006' });
    const r2 = await fireSim(db, null);
    check(r1 === 'error' && r2 === 'skip_ja_enviado', '4.2 erro 08* mantém claim → tick2 NÃO reenvia (zero duplicata)');
    check(db._rows.filter(r => r.status === 'sent').length === 1, '4.2b exatamente 1 sent (a mensagem pôde ter saído 1x)');
  }
  {
    // 4.3 Sucesso direto.
    const db = makeFakeSupabase();
    const r = await fireSim(db, null);
    check(r === 'sent' && db._rows.length === 1, '4.3 sucesso direto → 1 sent');
  }

  // ── 5) Fase 2: mensal dual-type + dedup dos tipos novos ─────────────────────
  console.log('\n=== 5) Fase 2: dual-type mensal e dedup dos tipos claim-safe novos ===');
  {
    const db = makeFakeSupabase();
    // intro e ritual do mesmo mês são CHAVES DISTINTAS (tipos diferentes) → ambos vencem.
    const i1 = await claimRitualSend(db, COLLAB, 'monthly_planning_intro', YMD);
    const r1 = await claimRitualSend(db, COLLAB, 'monthly_planning', YMD);
    check(i1.won && r1.won, '5.1 intro e ritual mensal coexistem (chaves distintas no mesmo dia)');
    const i2 = await claimRitualSend(db, COLLAB, 'monthly_planning_intro', YMD);
    check(i2.won === false && i2.duplicate, '5.2 2º claim do intro mensal no mesmo dia → 23505 (dedup)');
    // Reports CEO/líderes: 1/destinatário/período.
    const ev1 = await claimRitualSend(db, COLLAB, 'ceo_team_unclosed_events', YMD);
    const ev2 = await claimRitualSend(db, COLLAB, 'ceo_team_unclosed_events', YMD);
    check(ev1.won && ev2.won === false && ev2.duplicate, '5.3 ceo_team_unclosed_events dedup 1/dia');
    const lt1 = await claimRitualSend(db, COLLAB, 'leader_unclosed_tasks', YMD);
    const lt2 = await claimRitualSend(db, COLLAB, 'leader_unclosed_tasks', YMD);
    check(lt1.won && lt2.won === false && lt2.duplicate, '5.4 leader_unclosed_tasks dedup 1/líder/dia');
    // LA EDUCA por-mentor: 1/mentor/semana.
    const le1 = await claimRitualSend(db, COLLAB, 'la_educa_resumo_mentor', YMD);
    const le2 = await claimRitualSend(db, COLLAB, 'la_educa_resumo_mentor', YMD);
    check(le1.won && le2.won === false && le2.duplicate, '5.5 la_educa_resumo_mentor dedup 1/mentor/semana');
    check(db._rows.filter(r => r.status === 'sent').length === 5, '5.6 exatamente 5 linhas sent (zero duplicada)');
  }

  console.log(ok ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
  process.exit(ok ? 0 : 1);
})().catch(err => { console.error('THROW:', err); process.exit(1); });

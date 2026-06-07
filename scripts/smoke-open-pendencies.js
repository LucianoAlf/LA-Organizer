// scripts/smoke-open-pendencies.js
// Achado #79 — prova a FONTE ÚNICA getStaleWorkEvents (src/services/open-pendencies.js)
// exercitando a função REAL contra um fake in-memory do supabase que aplica os filtros
// de verdade (eq/not-in/lt/gte/or/limit). DB-free, no estilo de smoke-ritual-retry.js.
// Valida: janela BRT, status, context, escopo por dono (planejador) e cooldown (escalação).
// Rodar: node scripts/smoke-open-pendencies.js
'use strict';

const { getStaleWorkEvents } = require('../src/services/open-pendencies');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); } }

// Fake supabase: builder encadeável thenable que aplica os filtros sobre o dataset.
function makeFake(dataset, { forceError = false } = {}) {
  const calls = { from: null, select: null, eq: [], not: [], lt: null, gte: null, or: null, limit: null };
  const builder = {
    select(s) { calls.select = s; return builder; },
    eq(c, v) { calls.eq.push([c, v]); return builder; },
    not(c, op, v) { calls.not.push([c, op, v]); return builder; },
    lt(c, v) { calls.lt = [c, v]; return builder; },
    gte(c, v) { calls.gte = [c, v]; return builder; },
    or(s) { calls.or = s; return builder; },
    limit(n) { calls.limit = n; return builder; },
    then(resolve) { resolve(compute()); },
  };
  function compute() {
    if (forceError) return { data: null, error: { message: 'boom-db-error' } };
    let rows = dataset.slice();
    for (const [c, v] of calls.eq) rows = rows.filter(r => r[c] === v);
    for (const [c, op, v] of calls.not) {
      if (op === 'in') {
        const set = String(v).replace(/[()"']/g, '').split(',').map(s => s.trim());
        rows = rows.filter(r => !set.includes(r[c]));
      }
    }
    if (calls.lt) rows = rows.filter(r => r[calls.lt[0]] < calls.lt[1]);
    if (calls.gte) rows = rows.filter(r => r[calls.gte[0]] >= calls.gte[1]);
    if (calls.or) {
      const m = calls.or.match(/followup_sent_at\.lt\.(.+)$/);
      const iso = m ? m[1] : null;
      rows = rows.filter(r => r.followup_sent_at == null || (iso && r.followup_sent_at < iso));
    }
    if (calls.limit != null) rows = rows.slice(0, calls.limit);
    return { data: rows, error: null };
  }
  const client = { from(t) { calls.from = t; return builder; } };
  return { client, calls };
}

const iso = (s) => new Date(s).toISOString();
// "Agora" fixo: 2026-06-07 12:00 BRT → janela [2026-06-02 00h BRT, 2026-06-07 00h BRT)
const NOW = new Date('2026-06-07T12:00:00-03:00');

const A = 'collab-A', B = 'collab-B';
const DATASET = [
  { id: 'E1', title: 'Reunião Pedro', context: 'work', status: 'pending',   end_at: iso('2026-06-05T18:00:00-03:00'), collaborator_id: A, followup_sent_at: null },
  { id: 'E2', title: 'Já fechada',     context: 'work', status: 'done',      end_at: iso('2026-06-05T18:00:00-03:00'), collaborator_id: A, followup_sent_at: null },
  { id: 'E3', title: 'Visita escola',  context: 'work', status: 'in_progress', end_at: iso('2026-06-04T10:00:00-03:00'), collaborator_id: B, followup_sent_at: null },
  { id: 'E4', title: 'Dentista',       context: 'personal', status: 'pending', end_at: iso('2026-06-05T09:00:00-03:00'), collaborator_id: A, followup_sent_at: null },
  { id: 'E5', title: 'Hoje cedo',      context: 'work', status: 'pending',   end_at: iso('2026-06-07T08:00:00-03:00'), collaborator_id: A, followup_sent_at: null }, // >= ontem 00h → fora
  { id: 'E6', title: 'Velho demais',   context: 'work', status: 'pending',   end_at: iso('2026-05-30T18:00:00-03:00'), collaborator_id: A, followup_sent_at: null }, // < 5d atrás → fora
  { id: 'E7', title: 'Já cobrada hoje',context: 'work', status: 'pending',   end_at: iso('2026-06-03T15:00:00-03:00'), collaborator_id: B, followup_sent_at: iso('2026-06-07T09:00:00-03:00') },
  { id: 'E8', title: 'Cancelada',      context: 'work', status: 'cancelled', end_at: iso('2026-06-04T15:00:00-03:00'), collaborator_id: A, followup_sent_at: null },
];

(async () => {
  // ── Caso 1: PLANEJADOR (scope do próprio dono A, sem cooldown) ──
  {
    const { client, calls } = makeFake(DATASET);
    const rows = await getStaleWorkEvents(client, { collabId: A, now: NOW });
    const ids = rows.map(r => r.id).sort();
    ok(JSON.stringify(ids) === JSON.stringify(['E1']), `planejador A → só [E1] (got ${JSON.stringify(ids)})`);
    ok(calls.eq.some(([c, v]) => c === 'collaborator_id' && v === A), 'planejador escopa por collaborator_id=A');
    ok(calls.eq.some(([c, v]) => c === 'context' && v === 'work'), 'planejador filtra context=work');
    ok(calls.or === null, 'planejador NÃO aplica cooldown (sem .or)');
    ok(calls.select === 'id, title, end_at, collaborator_id', 'planejador usa SELECT_BASIC (sem join)');
    ok(calls.from === 'events', 'planejador consulta tabela events');
  }

  // ── Caso 2: ESCALAÇÃO (todos os donos + cooldown 24h + join) ──
  {
    const cooldownIso = new Date(NOW.getTime() - 24 * 3600_000).toISOString();
    const { client, calls } = makeFake(DATASET);
    const rows = await getStaleWorkEvents(client, { sinceCooldownIso: cooldownIso, withCollaborator: true, now: NOW });
    const ids = rows.map(r => r.id).sort();
    // E1 (A, null) + E3 (B, null). E7 tem followup recente (> cooldown) → excluído.
    ok(JSON.stringify(ids) === JSON.stringify(['E1', 'E3']), `escalação → [E1,E3] todos os donos, cooldown corta E7 (got ${JSON.stringify(ids)})`);
    ok(!calls.eq.some(([c]) => c === 'collaborator_id'), 'escalação NÃO escopa por dono (varre todos)');
    ok(calls.or && calls.or.includes('followup_sent_at'), 'escalação aplica cooldown via .or(followup_sent_at)');
    ok(calls.select.includes('collaborators!events_collaborator_id_fkey'), 'escalação usa SELECT_FULL (join collaborators)');
    ok(calls.limit === 100, 'escalação limita a 100');
  }

  // ── Caso 3: janela BRT correta (lt ontem 00h, gte 5 dias atrás 00h) ──
  {
    const { client, calls } = makeFake(DATASET);
    await getStaleWorkEvents(client, { collabId: A, now: NOW });
    ok(calls.lt && calls.lt[0] === 'end_at' && calls.lt[1] === iso('2026-06-07T00:00:00-03:00'), `janela lt = ontem 00h BRT (got ${calls.lt && calls.lt[1]})`);
    ok(calls.gte && calls.gte[0] === 'end_at' && calls.gte[1] === iso('2026-06-02T00:00:00-03:00'), `janela gte = 5d atrás 00h BRT (got ${calls.gte && calls.gte[1]})`);
    ok(calls.not.some(([c, op]) => c === 'status' && op === 'in'), 'exclui status done/cancelled via .not(in)');
  }

  // ── Caso 4: erro do DB → [] (escalação não envia nada; planejador omite bloco) ──
  {
    const { client } = makeFake(DATASET, { forceError: true });
    const rows = await getStaleWorkEvents(client, { collabId: A, now: NOW });
    ok(Array.isArray(rows) && rows.length === 0, 'erro do DB retorna [] (sem throw)');
  }

  // ── Caso 5: cooldown deixa passar followup ANTIGO (< cooldown) ──
  {
    const ds = [
      { id: 'X', title: 'Antiga cobrança', context: 'work', status: 'pending', end_at: iso('2026-06-04T15:00:00-03:00'), collaborator_id: A, followup_sent_at: iso('2026-06-05T10:00:00-03:00') },
    ];
    const cooldownIso = new Date(NOW.getTime() - 24 * 3600_000).toISOString();
    const { client } = makeFake(ds);
    const rows = await getStaleWorkEvents(client, { sinceCooldownIso: cooldownIso, withCollaborator: true, now: NOW });
    ok(rows.length === 1 && rows[0].id === 'X', 'cooldown reabre cobrança com followup_sent_at antigo');
  }

  console.log(`\n[smoke-open-pendencies] ${pass} passaram, ${fail} falharam.`);
  process.exit(fail === 0 ? 0 : 1);
})();

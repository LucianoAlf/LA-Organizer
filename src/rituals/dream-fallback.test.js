'use strict';
// DREAM-FALLBACK-INVISIVEL (05/10). O marker DREAM_MEMORY de 05/10 dizia `executed ... erros=0`, mas
// o rituals.log da mesma noite tem 3× "[AI] Claude falhou kind=timeout ... tentando Codex" →
// "Codex respondeu via fallback" (2 dentro do laço do Dream — a auditoria da Rose e a do Luciano
// Alf — e 1 no laço de grupos). E o achado da Rose com categoria errada (c6b853b6) foi escrito pelo
// Codex sem que nada no banco dissesse isso: quem triava não tinha como pesar o modelo.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// provider.js com claude/openai trocados por dublês (require.cache), carregado do zero.
function providerCom({ claudeFalha }) {
  const dir = path.join(__dirname, '..', 'ai');
  const ids = ['claude', 'openai', 'provider'].map((n) => require.resolve(path.join(dir, n)));
  for (const id of ids) delete require.cache[id];
  require.cache[ids[0]] = { id: ids[0], filename: ids[0], loaded: true, exports: { chat: async () => {
    if (claudeFalha) { const e = new Error('Claude timeout após 90000ms'); e.kind = 'timeout'; throw e; }
    return { text: '{}', provider: 'claude', meta: {} };
  } } };
  require.cache[ids[1]] = { id: ids[1], filename: ids[1], loaded: true, exports: { chat: async () => ({ text: '{}', provider: 'openai' }) } };
  const p = require(ids[2]);
  for (const id of ids) delete require.cache[id];
  return p;
}

test('provider conta os fallbacks Claude→Codex do processo (o dispatcher lê o delta da noite)', async () => {
  const p = providerCom({ claudeFalha: true });
  const antes = p.contarFallbacks();
  const r = await p.chat('s', [], 10);
  await p.chat('s', [], 10);
  assert.strictEqual(r.fallbackFrom, 'claude');
  assert.strictEqual(p.contarFallbacks() - antes, 2);
});

test('provider: chamada que o Claude responde não conta', async () => {
  const p = providerCom({ claudeFalha: false });
  const antes = p.contarFallbacks();
  await p.chat('s', [], 10);
  assert.strictEqual(p.contarFallbacks() - antes, 0);
});

test('DREAM_MEMORY: noite com fallback NÃO sai "executed erros=0" (caso 05/10)', () => {
  const { sensorDoDream } = require('./dream-sensor');
  const m = sensorDoDream({ ymd: '2026-10-05', colabs: 38, cand: 9, salvas: 3, dedup: 6, magros: 4, erros: [], fallbacks: 2 });
  assert.strictEqual(m.result, 'fallback');
  assert.match(m.reason, / fallback=2/);
  assert.match(m.reason, /^dm:2026-10-05 colabs=38 cand=9 salvas=3 dedup=6 magros=4 erros=0/);
});

test('DREAM_MEMORY: noite limpa segue "executed" com fallback=0 explícito', () => {
  const { sensorDoDream } = require('./dream-sensor');
  const m = sensorDoDream({ ymd: '2026-10-05', colabs: 38, cand: 0, salvas: 0, dedup: 0, magros: 0, erros: [], fallbacks: 0 });
  assert.strictEqual(m.result, 'executed');
  assert.match(m.reason, / fallback=0$/);
});

test('DREAM_MEMORY: erro de extrator continua virando fallback com os nomes (comportamento antigo)', () => {
  const { sensorDoDream } = require('./dream-sensor');
  const m = sensorDoDream({ ymd: '2026-10-05', colabs: 2, cand: 0, salvas: 0, dedup: 0, magros: 0, erros: ['Rose:timeout', 'Ana:x', 'Leo:y'], fallbacks: 0 });
  assert.strictEqual(m.result, 'fallback');
  assert.match(m.reason, /erros=3 fallback=0 \[Rose:timeout; Ana:x\]$/);
});

test('o laço do Dream no dispatcher grava o sensor pelo sensorDoDream com o delta de fallbacks', () => {
  const src = require('fs').readFileSync(path.join(__dirname, 'dispatcher.js'), 'utf8');
  const ini = src.indexOf("marker_type: 'DREAM_MEMORY'");
  const trecho = src.slice(ini - 800, ini + 400);
  assert.match(trecho, /sensorDoDream\(/);
  assert.match(src, /contarFallbacks\(\) - _fallbacksAntesDoDream/);
});

// ── o MODELO que escreveu o achado fica gravado no achado ──────────────────────────────────
const A = require('../services/conversation-audit');

function sbAuditoria({ conversa }) {
  const inseridos = [];
  const sb = { _ins: inseridos, from(t) {
    const q = {
      select() { return q; }, eq() { return q; }, gte() { return q; }, lt() { return q; }, or() { return q; },
      order() { return q; }, limit() { return q; }, in() { return q; }, lte() { return q; },
      insert(o) { inseridos.push({ t, ...o }); return Promise.resolve({ error: null }); },
      update() { return q; },
      then(ok) { return Promise.resolve({ data: t === 'conversation_history' ? conversa : [], error: null }).then(ok); },
    };
    return q;
  } };
  return sb;
}

const CONVERSA = [
  { content: 'Tom, lança o boleto da Light no financeiro', direction: 'inbound', created_at: '2026-10-04T14:00:00Z' },
  { content: 'Lançado! ✅ Boleto da Light registrado no financeiro.', direction: 'outbound', created_at: '2026-10-04T14:00:20Z' },
];
const SAIDA = JSON.stringify({ findings: [{ category: 'confabulation', severity: 'alto', summary: 'TOM disse que lançou o boleto sem lançar', evidence: 'TOM: Lançado! ✅ Boleto da Light registrado no financeiro.', occurred_at: null }] });

test('achado escrito pelo Codex (fallback) leva auditor.provider=openai e o motivo do fallback', async () => {
  const sb = sbAuditoria({ conversa: CONVERSA });
  const chat = async () => ({ text: SAIDA, provider: 'openai', fallbackFrom: 'claude', primaryError: { kind: 'timeout', message: 'Claude timeout' } });
  const [f] = await A.auditConversation(sb, chat, { id: 'rose', full_name: 'Rose' }, 24);
  assert.deepStrictEqual(f.auditor, { provider: 'openai', fallback_de: 'claude', motivo: 'timeout' });
  await A.upsertFinding(sb, { id: 'rose', full_name: 'Rose' }, f);
  const ins = sb._ins.find((i) => i.t === 'tom_audit_findings');
  assert.deepStrictEqual(ins.auto_triage, { auditor: { provider: 'openai', fallback_de: 'claude', motivo: 'timeout' } });
});

test('achado do Claude também registra o modelo (ausência = achado anterior a 05/10)', async () => {
  const sb = sbAuditoria({ conversa: CONVERSA });
  const chat = async () => ({ text: SAIDA, provider: 'claude' });
  const [f] = await A.auditConversation(sb, chat, { id: 'rose', full_name: 'Rose' }, 24);
  assert.deepStrictEqual(f.auditor, { provider: 'claude' });
});

test('achado de GRUPO também registra o modelo', async () => {
  const sb = { from(t) {
    const q = { select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; }, limit() { return q; },
      then(ok) { return Promise.resolve({ data: t === 'group_chat_messages' ? [
        { id: 'm1', role: 'member', sender: { full_name: 'Arthur' }, content: 'tom, alunos de hoje sem anamnese', created_at: '2026-10-03T17:02:14Z' },
        { id: 'm2', role: 'tom', content: 'Pauta de hoje já tá no painel — são 14 alunos com aula hoje. Deixa eu confirmar quem ainda falta:', created_at: '2026-10-03T17:02:29Z' },
      ] : [], error: null }).then(ok); } };
    return q;
  } };
  const saida = JSON.stringify({ findings: [{ category: 'dropped_request', severity: 'medio', summary: 's', evidence: 'Arthur: tom, alunos de hoje sem anamnese', occurred_at: null }] });
  const [f] = await A.auditGroupConversation(sb, async () => ({ text: saida, provider: 'openai', fallbackFrom: 'claude', primaryError: { kind: 'timeout' } }), { id: 'g', name: 'Barra' }, 24);
  assert.strictEqual(f.auditor.provider, 'openai');
});

test('a triagem das 05h PRESERVA auto_triage.auditor (antes ela sobrescrevia o jsonb inteiro)', async () => {
  const { triageOpenFindings } = require('../services/finding-triage');
  const updates = [];
  const tabelas = {
    tom_audit_findings: [{ id: 'f1', category: 'confabulation', summary: 's', evidence: 'e', incident_at: '2026-10-04T14:00:20Z',
      incident_confidence: 'high', last_seen: '2026-10-05T06:00:00Z', auto_triage: { auditor: { provider: 'openai', fallback_de: 'claude', motivo: 'timeout' } } }],
    tom_known_issues: [{ codigo: 'K', titulo: 't', status: 'corrigido', corrigido_em: '2026-10-01T00:00:00Z' }],
  };
  let tbl = null;
  const sb = { from(t) { tbl = t; return sb; }, select() { return sb; }, in() { return sb; }, gte() { return sb; }, eq() { return sb; }, order() { return sb; },
    update(p) { updates.push(p); return sb; }, limit() { return Promise.resolve({ data: tabelas[tbl] || [], error: null }); },
    then(ok) { ok({ data: tabelas[tbl] || [], error: null }); } };
  await triageOpenFindings(sb, async () => ({ text: '{"matches":[]}' }), { nowIso: '2026-10-05T08:00:00Z' });
  assert.strictEqual(updates.length, 1);
  assert.deepStrictEqual(updates[0].auto_triage.auditor, { provider: 'openai', fallback_de: 'claude', motivo: 'timeout' });
  assert.strictEqual(updates[0].auto_triage.decision, 'keep');
});

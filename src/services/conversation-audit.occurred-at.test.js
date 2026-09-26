'use strict';
// AUDIT-OCCURRED-AT-CARIMBO-DERRUBA-INSERT (26/09). O prompt pede `"occurred_at":null`, mas o
// transcript chega carimbado ("[25/09 (qui) 13:05] USUÁRIO: ...") e o modelo passou a copiar o
// carimbo pro campo. `parseFindings` aceitava qualquer string, o Postgres recusou o insert inteiro
// (`invalid input syntax for type timestamp with time zone: "25/09 13:05"`) e os DOIS achados do
// Clayton da noite de 26/09 sumiram. Pior: a falha de insert só ia pro console, então o sensor de
// cegueira (marker AUDIT/fallback) ficou limpo e o acervo zerado pareceu saúde.
// Regra: occurred_at que não é timestamp ISO cai no fallback da janela; insert que falha vira
// cegueira registrada, não só log.
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('./conversation-audit');

const JANELA = '2026-09-26T02:59:10.000Z';
const bruto = (occ) => JSON.stringify({ findings: [{
  category: 'dropped_request', severity: 'medio', summary: 'TOM não registrou o pedido',
  evidence: 'USUÁRIO: anota aí', occurred_at: occ,
}] });

test('occurred_at copiado do carimbo do transcript cai no fallback da janela (caso Clayton 26/09)', () => {
  const [f] = A.parseFindings(bruto('25/09 13:05'), JANELA);
  assert.strictEqual(f.occurred_at, JANELA);
});

test('outras formas não-ISO também caem no fallback; sem fallback, null', () => {
  for (const ruim of ['25/09 (qui) 13:05', '13:05', 'ontem à tarde', '09/05 13:05', '']) {
    assert.strictEqual(A.parseFindings(bruto(ruim), JANELA)[0].occurred_at, JANELA, ruim);
  }
  assert.strictEqual(A.parseFindings(bruto('25/09 13:05'), null)[0].occurred_at, null);
});

test('controle: ISO válido do modelo é preservado', () => {
  for (const ok of ['2026-09-25T16:05:00Z', '2026-09-25T16:05:00.123+00:00', '2026-09-25T13:05:00-03:00']) {
    assert.strictEqual(A.parseFindings(bruto(ok), JANELA)[0].occurred_at, ok, ok);
  }
});

test('insert que falha vira cegueira registrada (marker AUDIT/fallback), não só console', async () => {
  const inseridos = [];
  const sb = { from: (tabela) => {
    const q = {
      select() { return q; }, in: async () => ({ data: [], error: null }),
      insert: async (o) => {
        if (tabela === 'tom_audit_findings') return { error: { message: 'invalid input syntax for type timestamp with time zone: "25/09 13:05"' } };
        inseridos.push({ tabela, ...o }); return { error: null };
      },
    };
    return q;
  } };
  const r = await A.upsertFinding(sb, { id: 'b41c4b5b-90e8-4f84-97cb-7d706c073454', full_name: 'Clayton' },
    { category: 'dropped_request', severity: 'medio', summary: 's', evidence: 'e', occurred_at: '25/09 13:05' });
  assert.strictEqual(r, 'erro_insert');
  const cego = inseridos.filter((i) => i.tabela === 'marker_logs' && i.marker_type === 'AUDIT' && i.result === 'fallback');
  assert.strictEqual(cego.length, 1);
  assert.match(cego[0].reason, /audit_blind/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyOutboundRecord, recordOutboundV1, OUTBOUND_OK } = require('./outbound-record');

// ---------------------------------------------------------------------------------
// classifyOutboundRecord — o RECIBO. "Não deu erro" não é recibo: se a RPC não
// devolveu outcome, isso é ausência de prova, não prova de sucesso.
// ---------------------------------------------------------------------------------
test('sem wa_message_id: não é sucesso, e é o caso mais comum hoje (86% dos outbounds)', () => {
  const r = classifyOutboundRecord({ waMessageId: null, outcome: null, error: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_wa_id');
});

test('erro do banco não vira sucesso', () => {
  const r = classifyOutboundRecord({ waMessageId: 'WA1', outcome: null, error: { message: 'timeout' } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'db_error');
  assert.match(r.detail, /timeout/);
});

test('RPC sem outcome = ausência de recibo, NÃO sucesso', () => {
  const r = classifyOutboundRecord({ waMessageId: 'WA1', outcome: null, error: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_outcome');
});

test('inserted = registrado', () => {
  const r = classifyOutboundRecord({ waMessageId: 'WA1', outcome: 'inserted' });
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, false);
});

test('already_recorded_same = idempotente, conta como sucesso e marca duplicata', () => {
  const r = classifyOutboundRecord({ waMessageId: 'WA1', outcome: 'already_recorded_same' });
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, true);
});

for (const ruim of ['ownership_conflict', 'missing_message_id', 'stale_lease', 'coisa_nova']) {
  test(`outcome '${ruim}' não passa por sucesso`, () => {
    const r = classifyOutboundRecord({ waMessageId: 'WA1', outcome: ruim });
    assert.equal(r.ok, false);
    assert.equal(r.code, ruim);
  });
}

test('OUTBOUND_OK não inclui nada além dos dois recibos de sucesso', () => {
  assert.deepEqual([...OUTBOUND_OK].sort(), ['already_recorded_same', 'inserted']);
});

// ---------------------------------------------------------------------------------
// recordOutboundV1 — roda DEPOIS da mensagem entregue. Não pode lançar nunca.
// ---------------------------------------------------------------------------------
function fakeSupabase(resposta) {
  const chamadas = [];
  return {
    chamadas,
    rpc: async (fn, params) => { chamadas.push({ fn, params }); return resposta; },
  };
}

test('registra com owner v1 e os campos do envio', async () => {
  const sb = fakeSupabase({ data: [{ outcome: 'inserted', id: 'uuid-1' }], error: null });
  const r = await recordOutboundV1({
    supabase: sb, waMessageId: 'WA9', phone: '5511999', collaboratorId: 'collab-1',
  });
  assert.equal(r.ok, true);
  assert.equal(sb.chamadas.length, 1);
  assert.equal(sb.chamadas[0].fn, 'tom_record_outbound');
  assert.equal(sb.chamadas[0].params.p_wa_message_id, 'WA9');
  assert.equal(sb.chamadas[0].params.p_owner, 'v1');
  assert.equal(sb.chamadas[0].params.p_collaborator, 'collab-1');
  // sem chave de conversa explícita, o telefone é a conversa no v1
  assert.equal(sb.chamadas[0].params.p_conversation, '5511999');
});

test('sem wa_message_id não gasta round-trip no banco', async () => {
  const sb = fakeSupabase({ data: null, error: null });
  const r = await recordOutboundV1({ supabase: sb, waMessageId: null, phone: '5511999' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_wa_id');
  assert.equal(sb.chamadas.length, 0);
});

test('supabase que EXPLODE não derruba o pós-entrega', async () => {
  const sb = { rpc: async () => { throw new Error('conexão morreu'); } };
  const r = await recordOutboundV1({ supabase: sb, waMessageId: 'WA1', phone: '5511999' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'db_error');
});

test('supabase ausente não derruba o pós-entrega', async () => {
  const r = await recordOutboundV1({ supabase: null, waMessageId: 'WA1' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'db_error');
});

test('aceita data como objeto (não só array) — a forma varia com o driver', async () => {
  const sb = fakeSupabase({ data: { outcome: 'inserted', id: 'u' }, error: null });
  const r = await recordOutboundV1({ supabase: sb, waMessageId: 'WA1' });
  assert.equal(r.ok, true);
});

test('data vazio = sem recibo, não sucesso', async () => {
  const sb = fakeSupabase({ data: [], error: null });
  const r = await recordOutboundV1({ supabase: sb, waMessageId: 'WA1' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_outcome');
});

test('chave de conversa explícita vence o telefone', async () => {
  const sb = fakeSupabase({ data: [{ outcome: 'inserted' }], error: null });
  await recordOutboundV1({ supabase: sb, waMessageId: 'WA1', phone: '5511999', conversationKey: 'grupo-42' });
  assert.equal(sb.chamadas[0].params.p_conversation, 'grupo-42');
});

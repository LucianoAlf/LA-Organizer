'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decideClaim, claimInbound, finishInbound } = require('./inbound-claim');

// =====================================================================================
// decideClaim — a decisão mais perigosa desta fatia inteira.
//
// RISCO INVERTIDO em relação à Fatia 2: lá, falhar significava registro faltando
// (invisível). Aqui, decidir "não processa" por engano significa TOM MUDO — a pessoa
// escreve e não recebe resposta. Por isso o default de TODO caminho desconhecido é
// PROCESSAR (fail-open). Só se pula quando o ledger diz, com recibo explícito, que essa
// mensagem já foi tratada ou está sendo tratada por outro.
// =====================================================================================

test('flag desligada: processa e nem consulta o ledger', () => {
  const d = decideClaim({ enabled: false, waMessageId: 'WA1', outcome: 'already_completed' });
  assert.equal(d.proceed, true);
  assert.equal(d.reason, 'flag_off');
});

test('sem id de mensagem: processa (não dá pra deduplicar o que não tem chave)', () => {
  const d = decideClaim({ enabled: true, waMessageId: null });
  assert.equal(d.proceed, true);
  assert.equal(d.reason, 'no_wa_id');
});

test('BANCO FORA DO AR: processa assim mesmo — mudo é pior que duplicado', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', error: { message: 'timeout' } });
  assert.equal(d.proceed, true);
  assert.equal(d.reason, 'db_error');
  assert.equal(d.degraded, true);
});

test('RPC sem recibo: processa (ausência de prova não autoriza calar)', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: null });
  assert.equal(d.proceed, true);
  assert.equal(d.reason, 'no_outcome');
  assert.equal(d.degraded, true);
});

test('outcome que ninguém conhece: processa', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: 'coisa_do_futuro' });
  assert.equal(d.proceed, true);
  assert.equal(d.degraded, true);
});

test('claimed: processa (caminho normal)', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: 'claimed' });
  assert.equal(d.proceed, true);
  assert.equal(d.reason, 'claimed');
  assert.equal(d.degraded, false);
});

test('resumed: processa — worker anterior morreu, este assume', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: 'resumed' });
  assert.equal(d.proceed, true);
});

test('já concluída: NÃO processa — este é o replay de restart', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: 'already_completed' });
  assert.equal(d.proceed, false);
  assert.equal(d.reason, 'already_completed');
});

test('em processamento por outro: NÃO processa', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: 'in_progress_elsewhere' });
  assert.equal(d.proceed, false);
});

test('dono é outro runtime: NÃO processa', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: 'owned_by_other' });
  assert.equal(d.proceed, false);
});

test('invalid: processa (o ledger recusou a chave, não a mensagem)', () => {
  const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: 'invalid' });
  assert.equal(d.proceed, true);
});

test('SÓ estes três recibos calam o TOM — qualquer outro processa', () => {
  const calam = ['already_completed', 'in_progress_elsewhere', 'owned_by_other'];
  const todos = [...calam, 'claimed', 'resumed', 'invalid', null, '', 'inventado'];
  for (const o of todos) {
    const d = decideClaim({ enabled: true, waMessageId: 'WA1', outcome: o });
    assert.equal(d.proceed, !calam.includes(o), `outcome '${o}' decidiu errado`);
  }
});

// =====================================================================================
// claimInbound / finishInbound — nunca lançam. Uma exceção aqui derruba a mensagem
// ANTES de ela ser processada, que é justamente o modo de falha que não pode existir.
// =====================================================================================
function fakeSupabase(resposta) {
  const chamadas = [];
  return { chamadas, rpc: async (fn, params) => { chamadas.push({ fn, params }); return resposta; } };
}

test('claim manda owner v1 e devolve token/operação para amarrar o outbound', async () => {
  const sb = fakeSupabase({ data: [{ outcome: 'claimed', operation_id: 'op-1', lease_token: 'tok-1' }], error: null });
  const d = await claimInbound({ supabase: sb, enabled: true, waMessageId: 'WA1', phone: '5511', collaboratorId: 'c1' });
  assert.equal(d.proceed, true);
  assert.equal(sb.chamadas[0].fn, 'tom_route_claim_inbound');
  assert.equal(sb.chamadas[0].params.p_owner, 'v1');
  assert.equal(sb.chamadas[0].params.p_wa_message_id, 'WA1');
  assert.equal(d.operationId, 'op-1');
  assert.equal(d.leaseToken, 'tok-1');
});

test('flag desligada não gasta round-trip', async () => {
  const sb = fakeSupabase({ data: [{ outcome: 'claimed' }], error: null });
  const d = await claimInbound({ supabase: sb, enabled: false, waMessageId: 'WA1' });
  assert.equal(d.proceed, true);
  assert.equal(sb.chamadas.length, 0);
});

test('supabase que EXPLODE no claim não impede a resposta', async () => {
  const sb = { rpc: async () => { throw new Error('conexão morreu'); } };
  const d = await claimInbound({ supabase: sb, enabled: true, waMessageId: 'WA1' });
  assert.equal(d.proceed, true);
  assert.equal(d.reason, 'db_error');
});

test('finish nunca lança, mesmo com o banco fora', async () => {
  const sb = { rpc: async () => { throw new Error('morreu'); } };
  const r = await finishInbound({ supabase: sb, enabled: true, waMessageId: 'WA1', leaseToken: 'tok' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'db_error');
});

test('finish marca completed com o token do claim', async () => {
  const sb = fakeSupabase({ data: [{ ok: true, reason: 'ok' }], error: null });
  const r = await finishInbound({ supabase: sb, enabled: true, waMessageId: 'WA1', leaseToken: 'tok-9', status: 'completed' });
  assert.equal(r.ok, true);
  assert.equal(sb.chamadas[0].fn, 'tom_route_finish_inbound');
  assert.equal(sb.chamadas[0].params.p_status, 'completed');
  assert.equal(sb.chamadas[0].params.p_lease_token, 'tok-9');
  // O nome do parâmetro é p_error. Este assert trava a digitação; o contrato de verdade
  // (a função existir com esses nomes) quem confere é scripts/verificar-rpc-params.js —
  // dublê nenhum pega isso, foi assim que 'p_reason' chegou em produção.
  assert.ok('p_error' in sb.chamadas[0].params, 'finish deve mandar p_error');
  assert.ok(!('p_reason' in sb.chamadas[0].params), 'p_reason não existe na função real');
});

test('finish sem token não chama o banco (claim não venceu, nada a fechar)', async () => {
  const sb = fakeSupabase({ data: [{ ok: true }], error: null });
  const r = await finishInbound({ supabase: sb, enabled: true, waMessageId: 'WA1', leaseToken: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_lease');
  assert.equal(sb.chamadas.length, 0);
});

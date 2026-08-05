'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decideSend, runInTurn, currentTurn, beforeSend, afterSend } = require('./turn-claim');

// =====================================================================================
// decideSend — a fronteira de SAÍDA do turno.
//
// Fecha o 4º item da régua: nenhum outbound de um turno claimado nasce fora do dono
// vencedor. Mas o fail-open do claim continua valendo, porque o modo de falha é o mesmo:
// não enviar por engano = TOM MUDO.
//
// Só UMA coisa impede o envio: o banco dizer, com recibo, que a posse não é mais deste
// worker. Banco fora, sem recibo, sem turno, sem lease → envia.
// =====================================================================================

test('fora de turno (ritual/proativo): envia — não é resposta a inbound', () => {
  const d = decideSend({ turn: null });
  assert.equal(d.send, true);
  assert.equal(d.reason, 'sem_claim');
});

test('turno sem lease (claim degradado): envia', () => {
  const d = decideSend({ turn: { waMessageId: 'WA1', leaseToken: null } });
  assert.equal(d.send, true);
  assert.equal(d.reason, 'sem_claim');
});

test('lease confirmada: envia', () => {
  const d = decideSend({ turn: { waMessageId: 'WA1', leaseToken: 'tok' }, leaseOk: true });
  assert.equal(d.send, true);
  assert.equal(d.reason, 'lease_ok');
});

test('LEASE PERDIDA: não envia — outro worker assumiu este turno', () => {
  const d = decideSend({ turn: { waMessageId: 'WA1', leaseToken: 'tok' }, leaseOk: false });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'lease_perdida');
});

test('banco fora do ar: envia (mudo é pior que duplicado)', () => {
  const d = decideSend({ turn: { waMessageId: 'WA1', leaseToken: 'tok' }, error: { message: 'timeout' } });
  assert.equal(d.send, true);
  assert.equal(d.degraded, true);
});

test('assert sem recibo: envia', () => {
  const d = decideSend({ turn: { waMessageId: 'WA1', leaseToken: 'tok' }, leaseOk: null });
  assert.equal(d.send, true);
  assert.equal(d.reason, 'sem_recibo');
  assert.equal(d.degraded, true);
});

test('SÓ o recibo explícito de perda impede o envio', () => {
  const turn = { waMessageId: 'WA1', leaseToken: 'tok' };
  const casos = [
    [{ turn, leaseOk: true }, true], [{ turn, leaseOk: false }, false],
    [{ turn, leaseOk: null }, true], [{ turn, leaseOk: undefined }, true],
    [{ turn, error: new Error('x') }, true], [{ turn: null }, true],
  ];
  for (const [args, esperado] of casos) {
    assert.equal(decideSend(args).send, esperado, JSON.stringify(args.leaseOk ?? args.error ?? 'sem turno'));
  }
});

// =====================================================================================
// Contexto de turno — é o que cobre os 82 call sites de whatsapp.sendMessage sem tocar
// em nenhum deles. Migrar 82 lugares à mão garantiria esquecer algum, em silêncio.
// =====================================================================================

test('fora do turno não há contexto', () => {
  assert.equal(currentTurn(), null);
});

test('contexto atravessa await e callback aninhado', async () => {
  const ctx = { waMessageId: 'WA1', leaseToken: 'tok', operationId: 'op' };
  await runInTurn(ctx, async () => {
    assert.equal(currentTurn().waMessageId, 'WA1');
    await new Promise(r => setTimeout(r, 1));
    assert.equal(currentTurn().leaseToken, 'tok');       // sobrevive ao await
    await (async () => {
      await Promise.resolve();
      assert.equal(currentTurn().operationId, 'op');     // sobrevive ao aninhamento
    })();
  });
  assert.equal(currentTurn(), null);                     // e não vaza pra fora
});

test('turnos simultâneos não se misturam (a fila é por telefone, mas há N telefones)', async () => {
  const vistos = [];
  await Promise.all([
    runInTurn({ waMessageId: 'A' }, async () => {
      await new Promise(r => setTimeout(r, 5));
      vistos.push(currentTurn().waMessageId);
    }),
    runInTurn({ waMessageId: 'B' }, async () => {
      vistos.push(currentTurn().waMessageId);
    }),
  ]);
  assert.deepEqual(vistos.sort(), ['A', 'B']);
});

// =====================================================================================
// beforeSend / afterSend
// =====================================================================================
function fakeSupabase(porFn) {
  const chamadas = [];
  return { chamadas, rpc: async (fn, params) => { chamadas.push({ fn, params }); return porFn[fn] || { data: null, error: null }; } };
}

test('EARLY-RETURN: um ramo que responde no meio do turno também valida a lease', async () => {
  const sb = fakeSupabase({ tom_route_assert_lease: { data: true, error: null } });
  await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok', operationId: 'op' }, async () => {
    const d = await beforeSend({ supabase: sb });
    assert.equal(d.send, true);
  });
  assert.equal(sb.chamadas[0].fn, 'tom_route_assert_lease');
  assert.equal(sb.chamadas[0].params.p_lease_token, 'tok');
});

test('early-return com lease perdida NÃO envia', async () => {
  const sb = fakeSupabase({ tom_route_assert_lease: { data: false, error: null } });
  await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok' }, async () => {
    const d = await beforeSend({ supabase: sb });
    assert.equal(d.send, false);
    assert.equal(d.reason, 'lease_perdida');
  });
});

test('fora de turno não consulta o banco (ritual não paga round-trip)', async () => {
  const sb = fakeSupabase({});
  const d = await beforeSend({ supabase: sb });
  assert.equal(d.send, true);
  assert.equal(sb.chamadas.length, 0);
});

test('afterSend amarra o outbound à operação e à lease do turno', async () => {
  const sb = fakeSupabase({ tom_record_outbound: { data: [{ outcome: 'inserted' }], error: null } });
  await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok', operationId: 'op-7' }, async () => {
    await afterSend({ supabase: sb, sentId: 'OUT9', phone: '5511', collaboratorId: 'c1' });
  });
  const p = sb.chamadas[0].params;
  assert.equal(sb.chamadas[0].fn, 'tom_record_outbound');
  assert.equal(p.p_wa_message_id, 'OUT9');
  assert.equal(p.p_operation_id, 'op-7');
  assert.equal(p.p_lease_token, 'tok');
});

test('afterSend fora de turno registra sem operação (proativo/ritual)', async () => {
  const sb = fakeSupabase({ tom_record_outbound: { data: [{ outcome: 'inserted' }], error: null } });
  await afterSend({ supabase: sb, sentId: 'OUT9', phone: '5511' });
  const p = sb.chamadas[0].params;
  assert.equal(p.p_operation_id, null);
  assert.equal(p.p_lease_token, null);
});

test('afterSend sem id não chama o banco', async () => {
  const sb = fakeSupabase({});
  await afterSend({ supabase: sb, sentId: null, phone: '5511' });
  assert.equal(sb.chamadas.length, 0);
});

test('beforeSend e afterSend nunca lançam', async () => {
  const sb = { rpc: async () => { throw new Error('morreu'); } };
  await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok' }, async () => {
    const d = await beforeSend({ supabase: sb });
    assert.equal(d.send, true);           // fail-open
    await afterSend({ supabase: sb, sentId: 'X1', phone: '55' });  // não lança
  });
});

// =====================================================================================
// TRAVA DE SAÍDA DO REPLAY LAB (spec 05/08, passo 2 — o portão)
//
// A v1 da spec suprimia quando o DESTINO já era QA. O Alfredo achou o furo: num replay o
// TOM decide avisar um TERCEIRO (delegação, "avisa a Gabi") — destino fora da lista, a
// trava não age, e a mensagem chega numa pessoa REAL. E "recado a terceiro" é um dos
// padrões que o laboratório existe para testar: vazaria por construção.
//
// A trava é sobre o MODO, não sobre o destino:
//   fora de replay        → envia (produção intocada)
//   replay + destino QA   → suprime
//   replay + destino fora → FALHA FECHADA, nunca envia
// =====================================================================================
const { decideDestinoQA } = require('./turn-claim');
const LISTA = ['5500000000001', '5500000000002'];

test('fora de replay: envia normal — produção não muda', () => {
  const d = decideDestinoQA({ turn: null, phone: '5521999998888', listaQA: LISTA });
  assert.equal(d.permitido, true);
  assert.equal(d.motivo, 'sem_replay');
});

test('turno normal (sem qa) não ativa a trava', () => {
  const d = decideDestinoQA({ turn: { waMessageId: 'W', qa: false }, phone: '5521999998888', listaQA: LISTA });
  assert.equal(d.permitido, true);
});

test('replay + destino QA: suprime e não envia', () => {
  const d = decideDestinoQA({ turn: { qa: true, runId: 'r1' }, phone: '5500000000001', listaQA: LISTA });
  assert.equal(d.permitido, false);
  assert.equal(d.suprimir, true);
  assert.equal(d.abortar, false);
});

test('replay + TERCEIRO real: FALHA FECHADA — o furo que o Alfredo achou', () => {
  const d = decideDestinoQA({ turn: { qa: true, runId: 'r1' }, phone: '5521999998888', listaQA: LISTA });
  assert.equal(d.permitido, false);
  assert.equal(d.suprimir, false);
  assert.equal(d.abortar, true, 'destino real durante replay TEM que abortar');
  assert.equal(d.motivo, 'destino_proibido');
});

test('GUARDA DUPLA: telefone real na lista QA ainda é barrado pela faixa', () => {
  // se alguém puser um número de gente em TOM_QA_PHONES, a faixa reservada segura
  const d = decideDestinoQA({ turn: { qa: true }, phone: '5521999998888', listaQA: ['5521999998888'] });
  assert.equal(d.abortar, true, 'lista sozinha não pode liberar número fora da faixa');
});

test('faixa reservada sem estar na lista também aborta (as duas condições, não uma)', () => {
  const d = decideDestinoQA({ turn: { qa: true }, phone: '5500000000009', listaQA: LISTA });
  assert.equal(d.abortar, true);
});

test('formato do telefone não burla a trava (máscara, +, sufixo do WhatsApp)', () => {
  for (const p of ['+55 (21) 99999-8888', '5521999998888@s.whatsapp.net', ' 5521999998888 ']) {
    assert.equal(decideDestinoQA({ turn: { qa: true }, phone: p, listaQA: LISTA }).abortar, true, p);
  }
  for (const p of ['+55 00 00000-0001', '5500000000001@s.whatsapp.net']) {
    assert.equal(decideDestinoQA({ turn: { qa: true }, phone: p, listaQA: LISTA }).suprimir, true, p);
  }
});

test('destino vazio/nulo em replay aborta (não vira "sem destino, tudo bem")', () => {
  assert.equal(decideDestinoQA({ turn: { qa: true }, phone: null, listaQA: LISTA }).abortar, true);
  assert.equal(decideDestinoQA({ turn: { qa: true }, phone: '', listaQA: LISTA }).abortar, true);
});

test('lista QA vazia em replay: aborta tudo — nada sai por engano', () => {
  assert.equal(decideDestinoQA({ turn: { qa: true }, phone: '5500000000001', listaQA: [] }).abortar, true);
});

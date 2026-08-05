'use strict';
// Teste do TRANSPORTE, não do helper isolado.
//
// O Alfredo cobrou exatamente isto: "o teste prova o helper isolado; não há teste do
// transporte real garantindo que esses caminhos bloqueiam antes do POST". Um teste que
// só exercita decideSend não impede que uma rota de envio simplesmente não chame o gate
// — foi assim que voz, sticker, menu e reação ficaram de fora da primeira versão.
//
// Aqui o cliente HTTP é injetado e a asserção é sobre o POST: com lease perdida, ele NÃO
// pode acontecer. Se alguém adicionar uma rota nova sem passar pelo ponto único, o teste
// dessa rota falha na hora.
//
// whatsapp.js carrega config, que exige env. Setamos valores de fachada ANTES do require:
// nada aqui toca rede — o transporte é o dublê.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fachada.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fachada';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://fachada.local';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'fachada';

const test = require('node:test');
const assert = require('node:assert');
const { _postEnviar } = require('./whatsapp');
const { runInTurn } = require('./turn-claim');

function transporteFake(resposta = { data: { id: '3EB0SENTID12345' } }) {
  const posts = [];
  return { posts, post: async (rota, payload, config) => { posts.push({ rota, payload, config }); return resposta; } };
}

// supabase de fachada: decide o que assert_lease devolve.
function sbLease(valor) {
  const chamadas = [];
  return {
    chamadas,
    rpc: async (fn, params) => {
      chamadas.push({ fn, params });
      if (fn === 'tom_route_assert_lease') return { data: valor, error: null };
      return { data: [{ outcome: 'inserted' }], error: null };
    },
  };
}

// As rotas que o TOM usa para FALAR. presence fica fora de propósito (não é mensagem).
const ROTAS = [
  { nome: 'texto', rota: '/send/text', payload: { number: '55', text: 'oi' } },
  { nome: 'voz (ptt)', rota: '/send/media', payload: { number: '55', type: 'ptt', file: 'b64' } },
  { nome: 'sticker/mídia', rota: '/send/media', payload: { number: '55', type: 'sticker', file: 'u' } },
  { nome: 'reação', rota: '/message/react', payload: { number: '55', text: '👍', id: 'MID1' } },
  { nome: 'menu/botões', rota: '/send/menu', payload: { number: '55', type: 'button' } },
  { nome: 'menu/lista', rota: '/send/menu', payload: { number: '55', type: 'list' } },
];

for (const r of ROTAS) {
  test(`LEASE PERDIDA não posta ${r.nome}`, async () => {
    const t = transporteFake();
    const sb = sbLease(false);          // recibo explícito: a posse não é mais deste worker
    await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok', operationId: 'op' }, async () => {
      const out = await _postEnviar(r.rota, r.payload, { phone: '5511', api: t, supabase: sb });
      assert.equal(out.bloqueado, true, `${r.nome} deveria ter sido bloqueado`);
      assert.equal(out.data, null);
    });
    assert.equal(t.posts.length, 0, `${r.nome}: houve POST com a lease perdida`);
  });

  test(`lease válida posta ${r.nome} e registra o id`, async () => {
    const t = transporteFake();
    const sb = sbLease(true);
    await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok', operationId: 'op-7' }, async () => {
      const out = await _postEnviar(r.rota, r.payload, { phone: '5511', api: t, supabase: sb });
      assert.equal(out.bloqueado, false);
    });
    assert.equal(t.posts.length, 1, `${r.nome}: não postou`);
    assert.equal(t.posts[0].rota, r.rota);
    const registro = sb.chamadas.find(c => c.fn === 'tom_record_outbound');
    assert.ok(registro, `${r.nome}: não registrou no ledger`);
    assert.equal(registro.params.p_operation_id, 'op-7', `${r.nome}: outbound sem a operação do turno`);
    assert.equal(registro.params.p_lease_token, 'tok', `${r.nome}: outbound sem a lease do turno`);
  });
}

test('FORA de turno (ritual/proativo) posta sem consultar lease — comportamento atual', async () => {
  const t = transporteFake();
  const sb = sbLease(true);
  const out = await _postEnviar('/send/text', { number: '55', text: 'lembrete' }, { phone: '5511', api: t, supabase: sb });
  assert.equal(out.bloqueado, false);
  assert.equal(t.posts.length, 1);
  assert.equal(sb.chamadas.filter(c => c.fn === 'tom_route_assert_lease').length, 0, 'ritual não deve pagar round-trip de lease');
});

test('resposta sem id ainda posta — só não há o que registrar', async () => {
  const t = transporteFake({ data: { semId: true } });
  const sb = sbLease(true);
  await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok' }, async () => {
    const out = await _postEnviar('/send/text', { number: '55' }, { phone: '5511', api: t, supabase: sb });
    assert.equal(out.bloqueado, false);
  });
  assert.equal(t.posts.length, 1);
  assert.equal(sb.chamadas.filter(c => c.fn === 'tom_record_outbound').length, 0);
});

test('banco fora do ar posta assim mesmo (mudo é pior que duplicado)', async () => {
  const t = transporteFake();
  const sb = { rpc: async () => { throw new Error('conexão morreu'); } };
  await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok' }, async () => {
    const out = await _postEnviar('/send/text', { number: '55' }, { phone: '5511', api: t, supabase: sb });
    assert.equal(out.bloqueado, false);
  });
  assert.equal(t.posts.length, 1);
});

// =====================================================================================
// TRAVA DE SAÍDA DO REPLAY LAB — cobertura por ROTA (spec 05/08, item 3 da auditoria)
//
// "Ponto único" só vale se a prova cobrir as portas. Na Fatia 3 eu afirmei que o gate
// cobria todo outbound e cobria UMA das sete rotas. Aqui cada rota é verificada nos dois
// lados: destino QA suprime; destino real ABORTA sem postar.
// =====================================================================================
const QA_PHONE = '5500000000001';
const PESSOA_REAL = '5521999998888';

function comQA(fn) {
  const antes = process.env.TOM_QA_PHONES;
  process.env.TOM_QA_PHONES = QA_PHONE;
  return Promise.resolve(fn()).finally(() => {
    if (antes === undefined) delete process.env.TOM_QA_PHONES; else process.env.TOM_QA_PHONES = antes;
  });
}

for (const r of ROTAS) {
  test(`[replay] ${r.nome}: destino QA é suprimido, 0 POST, recibo com run_id`, async () => {
    const t = transporteFake();
    const sb = sbLease(true);
    await comQA(async () => {
      await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok', qa: true, runId: 'run-42' }, async () => {
        const out = await _postEnviar(r.rota, r.payload, { phone: QA_PHONE, api: t, supabase: sb });
        assert.equal(out.suprimido, true, `${r.nome} não foi suprimido`);
        // o recibo prova que o contexto de replay chegou até o transporte
        assert.equal(out.qaEvidencia.evento, 'outbound_suppressed');
        assert.equal(out.qaEvidencia.runId, 'run-42', 'recibo sem run_id: a trava não estava no contexto');
      });
    });
    assert.equal(t.posts.length, 0, `${r.nome}: POSTOU em replay`);
  });

  test(`[replay] ${r.nome}: destino de PESSOA REAL falha fechada, 0 POST`, async () => {
    const t = transporteFake();
    const sb = sbLease(true);
    await comQA(async () => {
      await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok', qa: true, runId: 'run-42' }, async () => {
        await assert.rejects(
          () => _postEnviar(r.rota, r.payload, { phone: PESSOA_REAL, api: t, supabase: sb }),
          (e) => e.code === 'QA_DESTINO_PROIBIDO' && e.qaEvidencia.evento === 'destino_proibido',
          `${r.nome}: deixou passar destino real`,
        );
      });
    });
    assert.equal(t.posts.length, 0, `${r.nome}: VAZOU POST para pessoa real`);
  });
}

// A trava tem que REGISTRAR sozinha, não confiar em quem der catch. O engine tem 51
// catch vazios: um vazamento evitado sem registro é um quase-acidente que ninguém fica
// sabendo. Estes dois testes chamam _postEnviar e NÃO leem o objeto da exceção.
const { evidenciasQA, limparEvidenciasQA } = require('./turn-claim');

test('evidência de destino proibido é PERSISTIDA, mesmo se ninguém olhar a exceção', async () => {
  const t = transporteFake();
  limparEvidenciasQA();
  await comQA(async () => {
    await runInTurn({ waMessageId: 'W', qa: true, runId: 'run-ev1' }, async () => {
      try { await _postEnviar('/send/text', {}, { phone: PESSOA_REAL, api: t, supabase: sbLease(true) }); }
      catch (_) { /* engolido de propósito: simula os catch vazios do engine */ }
    });
  });
  const evs = evidenciasQA('run-ev1');
  assert.equal(evs.length, 1, 'quase-vazamento não deixou rastro');
  assert.equal(evs[0].evento, 'destino_proibido');
  assert.equal(evs[0].numero, PESSOA_REAL);
  assert.ok(evs[0].ts, 'evidência sem timestamp');
});

test('evidência vai para o JSONL em disco quando TOM_QA_EVIDENCE_FILE está setado', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const arq = path.join(os.tmpdir(), `qa-ev-${process.pid}.jsonl`);
  try { fs.unlinkSync(arq); } catch (_) {}
  const antes = process.env.TOM_QA_EVIDENCE_FILE;
  process.env.TOM_QA_EVIDENCE_FILE = arq;
  try {
    const t = transporteFake();
    limparEvidenciasQA();
    await comQA(async () => {
      await runInTurn({ waMessageId: 'W', qa: true, runId: 'run-ev2' }, async () => {
        const ok = await _postEnviar('/send/text', {}, { phone: QA_PHONE, api: t, supabase: sbLease(true) });
        assert.equal(ok.suprimido, true);
        try { await _postEnviar('/send/text', {}, { phone: PESSOA_REAL, api: t, supabase: sbLease(true) }); }
        catch (_) {}
      });
    });
    const linhas = fs.readFileSync(arq, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(linhas.length, 2, 'JSONL não recebeu os dois eventos');
    assert.deepEqual(linhas.map(l => l.evento).sort(), ['destino_proibido', 'outbound_suppressed']);
    assert.ok(linhas.every(l => l.runId === 'run-ev2'), 'evento sem run_id no arquivo');
  } finally {
    if (antes === undefined) delete process.env.TOM_QA_EVIDENCE_FILE; else process.env.TOM_QA_EVIDENCE_FILE = antes;
    try { fs.unlinkSync(arq); } catch (_) {}
  }
});

test('[produção] fora de replay, envio para pessoa real segue normal — nada mudou', async () => {
  const t = transporteFake();
  const sb = sbLease(true);
  await comQA(async () => {
    const out = await _postEnviar('/send/text', { number: PESSOA_REAL }, { phone: PESSOA_REAL, api: t, supabase: sb });
    assert.equal(out.bloqueado, false);
  });
  assert.equal(t.posts.length, 1, 'a trava de QA não pode afetar produção');
});

test('o config extra (timeout da voz) chega no transporte', async () => {
  const t = transporteFake();
  const sb = sbLease(true);
  await runInTurn({ waMessageId: 'WA1', leaseToken: 'tok' }, async () => {
    await _postEnviar('/send/media', { type: 'ptt' }, { phone: '55', api: t, supabase: sb, config: { timeout: 30000 } });
  });
  assert.equal(t.posts[0].config.timeout, 30000);
});

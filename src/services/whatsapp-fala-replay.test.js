'use strict';
// O QUE O TOM DISSE — e não só o que ele fez.
//
// Metade dos 76 casos do diagnóstico de 04/08 é sobre a FALA: "anotado" sem ter anotado,
// "já mandei" sem ter mandado. Um laboratório que só confere o banco pega a outra metade.
//
// A trava de replay suprime o envio (destino é perfil de QA, o esperado), e a supressão
// acontece ANTES do POST — então nada do que o TOM ia dizer chegava a lugar nenhum. Dá
// para tentar ler `conversation_history`, mas o outbound é escrito por ~20 call sites
// espalhados, cada um decidindo por conta própria se grava: o que estiver faltando lá vira
// silêncio, e silêncio no laboratório lê como "o TOM não falou".
//
// `_postEnviar` é o ponto único por onde TODA fala passa — é a garantia que a Fatia 3
// construiu. Então é ali que o texto é capturado. Cobertura por construção, inclusive dos
// ramos que ninguém mapeou.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fachada.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fachada';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://fachada.local';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'fachada';

const test = require('node:test');
const assert = require('node:assert');
const { _postEnviar, textoDoOutbound, LIMITE_TEXTO_QA } = require('./whatsapp');
const { runInTurn, evidenciasQA, limparEvidenciasQA } = require('./turn-claim');

const QA_PHONE = '5500000000001';
const PESSOA_REAL = '5521999998888';

const transporteFake = () => ({ posts: [], post: async function (r, p) { this.posts.push({ r, p }); return { data: { id: 'X' } }; } });
const sbOk = { rpc: async () => ({ data: true, error: null }) };

function comQA(fn) {
  const antes = process.env.TOM_QA_PHONES;
  process.env.TOM_QA_PHONES = QA_PHONE;
  return Promise.resolve(fn()).finally(() => {
    if (antes === undefined) delete process.env.TOM_QA_PHONES; else process.env.TOM_QA_PHONES = antes;
  });
}

// ---- o extrator puro ----
test('textoDoOutbound lê o texto das rotas de fala (texto, menu, legenda de mídia, reação)', () => {
  assert.equal(textoDoOutbound({ number: '55', text: 'Feito, passei pra quinta.' }), 'Feito, passei pra quinta.');
  assert.equal(textoDoOutbound({ number: '55', type: 'button', text: 'Confirma?' }), 'Confirma?');
  assert.equal(textoDoOutbound({ number: '55', type: 'image', text: 'segue a fatura' }), 'segue a fatura');
  assert.equal(textoDoOutbound({ number: '55', text: '👍', id: 'MID' }), '👍');
});

test('rota sem fala devolve null — o laboratório não inventa texto que não houve', () => {
  assert.equal(textoDoOutbound({ number: '55', type: 'ptt', file: 'b64' }), null);
  assert.equal(textoDoOutbound({ number: '55', text: '' }), null, 'legenda vazia não é fala');
  assert.equal(textoDoOutbound({ number: '55', text: '   ' }), null);
  assert.equal(textoDoOutbound(null), null);
  assert.equal(textoDoOutbound({ text: 123 }), null, 'texto não-string não vira fala');
});

test('texto longo é truncado COM marca do tamanho real — truncar em silêncio é mentir sobre a fala', () => {
  const longo = 'a'.repeat(LIMITE_TEXTO_QA + 500);
  const t = textoDoOutbound({ text: longo });
  assert.ok(t.length < longo.length);
  assert.ok(t.includes(`+500`), `a marca não diz quanto foi cortado: ${t.slice(-30)}`);
});

// ---- o texto chegando na evidência, pelo transporte real ----
test('outbound suprimido registra o TEXTO que o TOM ia dizer', async () => {
  limparEvidenciasQA();
  await comQA(async () => {
    await runInTurn({ waMessageId: 'W', qa: true, runId: 'run-fala' }, async () => {
      await _postEnviar('/send/text', { number: QA_PHONE, text: 'Prontinho, joguei pra quinta.' },
        { phone: QA_PHONE, api: transporteFake(), supabase: sbOk });
    });
  });
  const [ev] = evidenciasQA('run-fala');
  assert.equal(ev.evento, 'outbound_suppressed');
  assert.equal(ev.texto, 'Prontinho, joguei pra quinta.',
    'a evidência não guarda a fala: o laboratório continua cego para o que o TOM disse');
});

test('quase-vazamento para pessoa real também guarda a fala — é o que quase saiu', async () => {
  limparEvidenciasQA();
  await comQA(async () => {
    await runInTurn({ waMessageId: 'W', qa: true, runId: 'run-vaz' }, async () => {
      try {
        await _postEnviar('/send/text', { number: PESSOA_REAL, text: 'Gabi, o Matheus te passou uma tarefa.' },
          { phone: PESSOA_REAL, api: transporteFake(), supabase: sbOk });
      } catch (_) { /* os 51 catch vazios do engine */ }
    });
  });
  const [ev] = evidenciasQA('run-vaz');
  assert.equal(ev.evento, 'destino_proibido');
  assert.equal(ev.texto, 'Gabi, o Matheus te passou uma tarefa.');
});

test('[produção] fora de replay nada é registrado — a captura de fala não vaza para o dia a dia', async () => {
  limparEvidenciasQA();
  await comQA(async () => {
    await _postEnviar('/send/text', { number: PESSOA_REAL, text: 'mensagem real' },
      { phone: PESSOA_REAL, api: transporteFake(), supabase: sbOk });
  });
  assert.equal(evidenciasQA().length, 0, 'a captura de fala está gravando fora de replay');
});

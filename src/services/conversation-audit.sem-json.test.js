'use strict';
// AUDIT-RESPOSTA-SEM-JSON-VIRA-NOITE-LIMPA (24/09). O sensor de cegueira (01/09) só pegava falha
// que LANÇA. Resposta do modelo que chega mas não traz o JSON `{"findings":[...]}` — recusa,
// prosa, resposta cortada, o Codex assumindo quando a cota do Claude estoura (24/09 03:00, 41
// chamadas) — caía no `parseFindings` e virava `[]` calado: zero por falha idêntico a zero por
// saúde. O acervo de governança chegou a 1 achado e o laudo saiu magro sem ninguém saber se as
// noites estavam limpas ou se o minerador estava cego.
// Regra: resposta sem o JSON da auditoria = CEGUEIRA registrada (marker AUDIT/fallback). JSON
// válido com lista vazia continua sendo noite limpa, sem marcador.
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('./conversation-audit');

function fakeSb(linhas) {
  const inseridos = [];
  const cadeia = (tabela) => {
    const q = {
      select() { return q; }, eq() { return q; }, gte() { return q; }, lt() { return q; },
      in() { return q; }, is() { return q; }, not() { return q; }, order() { return q; },
      limit: async () => ({ data: linhas[tabela] || [], error: null }),
      then: (ok) => ok({ data: linhas[tabela] || [], error: null }),
      insert: async (o) => { inseridos.push({ tabela, ...o }); return { error: null }; },
    };
    return q;
  };
  return { sb: { from: cadeia }, inseridos };
}
const agora = new Date().toISOString();
const GRUPO = { group_chat_messages: [
  { content: 'Tom, cria uma tarefa pra amanhã de ligar pro fornecedor de cordas, por favor', role: 'member', created_at: agora, wa_sender_name: 'Ana' },
  { content: 'Pode deixar, Ana! Criei a tarefa pra amanhã.', role: 'tom', created_at: agora },
] };
const cego = (ins) => ins.filter((i) => i.tabela === 'marker_logs' && i.marker_type === 'AUDIT' && i.result === 'fallback');

test('respostaDaAuditoriaValida: só o JSON com lista `findings` conta como resposta lida', () => {
  assert.strictEqual(A.respostaDaAuditoriaValida('{"findings":[]}'), true);
  assert.strictEqual(A.respostaDaAuditoriaValida('Aqui está:\n{"findings":[{"category":"x"}]}\nfim'), true);
  for (const ruim of ['', null, undefined, 'Não consigo ajudar com isso.', '{"findings": [', '{"outra":1}', '{"findings":"nada"}']) {
    assert.strictEqual(A.respostaDaAuditoriaValida(ruim), false, JSON.stringify(ruim));
  }
});

test('grupo: modelo responde em prosa -> [] E cegueira registrada (não é noite limpa)', async () => {
  const { sb, inseridos } = fakeSb(GRUPO);
  const r = await A.auditGroupConversation(sb, async () => ({ text: 'Desculpe, não consegui analisar agora.' }), { id: 'g1', name: 'ADM CG' }, 24);
  assert.deepStrictEqual(r, []);
  const m = cego(inseridos);
  assert.strictEqual(m.length, 1);
  assert.match(m[0].reason, /audit_blind: .*sem JSON/);
  assert.match(m[0].raw_excerpt, /grupo:ADM CG/);
});

test('grupo: JSON válido com lista vazia -> [] SEM marcador (noite limpa de verdade)', async () => {
  const { sb, inseridos } = fakeSb(GRUPO);
  const r = await A.auditGroupConversation(sb, async () => ({ text: '{"findings":[]}' }), { id: 'g1', name: 'ADM CG' }, 24);
  assert.deepStrictEqual(r, []);
  assert.strictEqual(cego(inseridos).length, 0);
});

test('grupo: conversa fina demais não chama o modelo nem marca cegueira', async () => {
  const { sb, inseridos } = fakeSb({ group_chat_messages: [] });
  let chamou = false;
  const r = await A.auditGroupConversation(sb, async () => { chamou = true; return { text: '' }; }, { id: 'g1', name: 'X' }, 24);
  assert.deepStrictEqual(r, []);
  assert.strictEqual(chamou, false);
  assert.strictEqual(cego(inseridos).length, 0);
});

const PESSOA = { conversation_history: [
  { content: 'Tom, me lembra amanhã às 9h de pagar o boleto da internet, por favor', direction: 'inbound', created_at: agora },
  { content: 'Combinado! Amanhã às 9h eu te lembro do boleto da internet.', direction: 'outbound', created_at: agora },
] };

test('1:1: resposta sem JSON -> cegueira registrada com o nome da pessoa', async () => {
  const { sb, inseridos } = fakeSb(PESSOA);
  const r = await A.auditConversation(sb, async () => ({ text: 'resposta cortada {"findings": [' }), { id: 'c1', full_name: 'Rose Teste' }, 24);
  assert.deepStrictEqual(r, []);
  const m = cego(inseridos);
  assert.strictEqual(m.length, 1);
  assert.match(m[0].raw_excerpt, /Rose Teste/);
});

test('1:1: modelo não devolve texto nenhum -> cegueira registrada', async () => {
  const { sb, inseridos } = fakeSb(PESSOA);
  await A.auditConversation(sb, async () => null, { id: 'c1', full_name: 'Rose Teste' }, 24);
  assert.strictEqual(cego(inseridos).length, 1);
});

test('1:1: JSON válido vazio -> sem marcador', async () => {
  const { sb, inseridos } = fakeSb(PESSOA);
  await A.auditConversation(sb, async () => ({ text: '{"findings":[]}' }), { id: 'c1', full_name: 'Rose Teste' }, 24);
  assert.strictEqual(cego(inseridos).length, 0);
});

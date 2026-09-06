'use strict';

// COORD-HONESTY-CEGO-A-DEVOLUTIVA (Rafinha 04/09 17:14:29 BRT)
//
// Irmão do COORD-HONESTY-NEGA-ENVIO-FEITO (Leo 05/08). Lá o veto nasceu porque o guard
// negava envio feito num turn anterior; a evidência escolhida foi coordination_requests.
// Mas esse ledger é de UM canal só. A devolutiva de tarefa delegada (notifyTaskReturn)
// entrega por whatsapp.sendMessage + conversation_history e NÃO escreve em
// coordination_requests — então o veto fica cego e o TOM nega entrega que aconteceu.
//
// Turno real: 17:13:04 a devolutiva chega ao Dudu; 17:13:05 "✅ Devolutiva enviada" (VERDADE);
// 17:14:30 o guard anexa "eu ainda NÃO avisei ninguém — nenhuma mensagem chegou a ser enviada"
// (MENTIRA, 85s depois da entrega). Rafinha reofereceu e o recado saiu DE NOVO às 17:17:22 —
// o Dudu recebeu a mesma instrução duas vezes.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  enforceSendHonesty,
  recentlySentFrom,
} = require('./coord-send-honesty');
const { isTaskReturnBroadcast } = require('../services/task-return');

// Original reconstruído: resíduo entregue + a linha de claim que o strip removeu.
// A reconstrução é validada byte-a-byte contra o entregue no primeiro teste.
const ORIGINAL =
  'Entendido, Rafinha. Daqui pra frente, quando o Dudu reportar tarefa operacional simples (troca, instalação, ajuste), eu já bato nele pra resolver — não subo pra você.\n\nAnota essa regra aqui.\n\n<<MEMORY_SAVE>>\n<<END>>\n\nJá repassei pro Dudu.\n\nA da corda de guitarra o recado já foi pra ele. Na próxima que vier assim, eu já resolvo direto.';

// Resíduo REALMENTE entregue, do raw_excerpt de marker_logs MEMORY_SAVE (04/09 17:14:29 BRT).
const ENTREGUE =
  'Entendido, Rafinha. Daqui pra frente, quando o Dudu reportar tarefa operacional simples (troca, instalação, ajuste), eu já bato nele pra resolver — não subo pra você.\nAnota essa regra aqui.\n<<MEMORY_SAVE>>\n<<END>>\nA da corda de guitarra o recado já foi pra ele. Na próxima que vier assim, eu já resolvo direto.\n\n_⚠️ Sendo sincero: eu ainda NÃO avisei ninguém — nenhuma mensagem chegou a ser enviada. Se quiser, me diz pra quem mandar que eu passo o recado._';

// A entrega real ao Dudu (conversation_history 04/09 17:13:04 BRT), template de buildReturnMessage.
const BROADCAST_REAL =
  '💬 Dudu, o Rafinha deixou um retorno em _"Instalar corda na guitarra vermelha — Campo Grande"_:\n_"Dudu, instala a corda de guitarra aí."_';

// Canal DIFERENTE: o recado por coordination_request das 17:17:22 — não é task-return.
const BROADCAST_COORD =
  'Oi, Dudu 👋\n\nO Rafinha me pediu pra te avisar:\n\ninstala a corda da guitarra vermelha no Campo Grande aí — isso é moleza pra você.';

test('ANCORA: sem evidência de entrega, o guard dispara e produz o entregue byte-a-byte', () => {
  const out = enforceSendHonesty(ORIGINAL, { isQuestion: false, recentlySent: false });
  assert.strictEqual(out.fired, true);
  assert.strictEqual(out.reply, ENTREGUE);
});

test('recentlySentFrom: devolutiva conta como entrega, mesmo com coordination_requests vazio', () => {
  assert.strictEqual(recentlySentFrom({ coordination_request: 0, task_return: 1 }), true);
});

test('recentlySentFrom: o canal antigo segue valendo sozinho (zero-regressão Leo 05/08)', () => {
  assert.strictEqual(recentlySentFrom({ coordination_request: 2, task_return: 0 }), true);
});

test('recentlySentFrom: sem nenhum canal, não veta (o guard tem que poder disparar)', () => {
  assert.strictEqual(recentlySentFrom({ coordination_request: 0, task_return: 0 }), false);
  assert.strictEqual(recentlySentFrom({}), false);
  assert.strictEqual(recentlySentFrom(), false);
});

test('CASO RAFINHA: com a devolutiva das 17:13:04 na janela, o TOM NÃO nega a entrega', () => {
  const recentlySent = recentlySentFrom({ coordination_request: 0, task_return: 1 });
  const out = enforceSendHonesty(ORIGINAL, { isQuestion: false, recentlySent });
  assert.strictEqual(out.fired, false);
  assert.strictEqual(out.reply, ORIGINAL);
  assert.ok(!out.reply.includes('NÃO avisei ninguém'));
});

test('isTaskReturnBroadcast: reconhece a entrega real da devolutiva ao Dudu', () => {
  assert.strictEqual(isTaskReturnBroadcast(BROADCAST_REAL, 'Rafinha'), true);
});

test('isTaskReturnBroadcast: o DESTINATÁRIO não conta como ator (senão o veto vira carimbo)', () => {
  assert.strictEqual(isTaskReturnBroadcast(BROADCAST_REAL, 'Dudu'), false);
});

test('isTaskReturnBroadcast: recado por coordination_request não é task-return', () => {
  assert.strictEqual(isTaskReturnBroadcast(BROADCAST_COORD, 'Rafinha'), false);
});

test('isTaskReturnBroadcast: ator vazio nunca casa', () => {
  assert.strictEqual(isTaskReturnBroadcast(BROADCAST_REAL, ''), false);
  assert.strictEqual(isTaskReturnBroadcast(BROADCAST_REAL, null), false);
});

test('isTaskReturnBroadcast: também reconhece o broadcast de CONCLUSÃO', () => {
  const concl = '✅ Rafinha, o Dudu concluiu a tarefa que você pediu:\n_"Instalar corda na guitarra vermelha"_';
  assert.strictEqual(isTaskReturnBroadcast(concl, 'Dudu'), true);
  assert.strictEqual(isTaskReturnBroadcast(concl, 'Rafinha'), false);
});

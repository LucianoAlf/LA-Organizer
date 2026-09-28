// Prova de reversão — deleções do WhatsApp engolidas pelo dedupe (governança 28/09).
//
// Caso real: grupo "Administrativo e Comercial Barra", 04/09 ~14:01 BRT. O time combinou uma
// surpresa pra Duda no grupo e apagou as mensagens ("apaga gente", "Tu consegue apagar todas").
// Cada deleção chega como `messages_update` SEM `body.message` — só `body.event.MessageIDs`.
// O `fallbackKey` montava hash(phone|event|minuto|texto) com phone e texto VAZIOS, então todo
// `messages_update` do mesmo minuto (recibo de entrega, leitura, deleção) tinha a MESMA chave.
// O primeiro recibo do minuto "consumia" a chave e as deleções seguintes caíam em
// "SKIP duplicate" antes de chegar no `maybeHandleGroupDelete`. Medido no log: 36 de 67
// deleções engolidas; 28 mensagens apagadas no zap seguiam vivas no espelho do grupo.
// Controle medido: as 29 deleções que NÃO colidiram estão todas com `deleted_at`.

const { test } = require('node:test');
const assert = require('node:assert');

function fresh() {
  delete require.cache[require.resolve('./dedupe')];
  return require('./dedupe');
}

// Shapes reais do log (tom-out.log, 04/09 17:01 UTC), sem o token.
const recibo = (id) => ({
  BaseUrl: 'https://lamusic.uazapi.com', EventType: 'messages_update',
  event: { Chat: '5521998832977@s.whatsapp.net', IsFromMe: false, IsGroup: false,
    MessageIDs: [id], Sender: '5521998832977@s.whatsapp.net', Type: 'Delivered' },
  instanceName: 'LA Organizer (Tom)', state: 'Delivered', type: 'ReadReceipt',
});
const delecao = (id) => ({
  BaseUrl: 'https://lamusic.uazapi.com', EventType: 'messages_update',
  event: { Chat: '120363410762036258@g.us', IsFromMe: false, IsGroup: true,
    MessageIDs: [id], Type: 'Deleted' },
  instanceName: 'LA Organizer (Tom)', state: 'Deleted',
});

test('deleção de grupo NÃO é engolida por um recibo de entrega do mesmo minuto (Barra 04/09)', () => {
  const d = fresh();
  assert.strictEqual(d.isDuplicate(recibo('3EB0FCAAA59EDA22EF4C23')), false);
  assert.strictEqual(d.isDuplicate(delecao('3AFB89796677CB3C2B12')), false);
});

test('duas deleções de mensagens DIFERENTES no mesmo minuto passam as duas', () => {
  const d = fresh();
  assert.strictEqual(d.isDuplicate(delecao('3AFB89796677CB3C2B12')), false);
  assert.strictEqual(d.isDuplicate(delecao('3A9E4B7D85C7EEE55BF6')), false);
});

test('controle: a MESMA deleção reentregue continua sendo duplicata', () => {
  const d = fresh();
  assert.strictEqual(d.isDuplicate(delecao('3AFB89796677CB3C2B12')), false);
  assert.strictEqual(d.isDuplicate(delecao('3AFB89796677CB3C2B12')), true);
});

test('controle: mensagem com id estável segue deduplicada pelo id', () => {
  const d = fresh();
  const msg = { EventType: 'messages', message: { id: 'ABCDEF123456', text: 'oi' } };
  assert.strictEqual(d.isDuplicate(msg), false);
  assert.strictEqual(d.isDuplicate({ ...msg }), true);
  assert.strictEqual(d.eventKey(msg), 'mid:ABCDEF123456');
});

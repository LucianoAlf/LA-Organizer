// src/services/group-chat-bridge-in.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractGroupJid, extractSenderPhone, isGroupMessage, matchMemberByName, normalizeName, resolveMentions, mediaKindFromBody } = require('./group-chat-bridge-in');

const { parseDeletedWaIds } = require('./group-chat-bridge-in');
test('parseDeletedWaIds extrai MessageIDs só com sinal de deleção (formato real UAZAPI)', () => {
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', type: 'DeletedMessage', event: { MessageIDs: ['AAA'], Type: 'Deleted' } }), ['AAA']);
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', state: 'Deleted', event: { MessageIDs: ['BBB', 'CCC'] } }), ['BBB', 'CCC']);
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', event: { MessageIDs: ['X'], Type: 'Read' } }), []);
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages', event: { MessageIDs: ['D'] } }), []);
});

test('mediaKindFromBody detecta image/audio/pdf/null', () => {
  const detectors = {
    isAudioMessage: (b) => b.t === 'audio',
    isImageMessage: (b) => b.t === 'image',
    isDocumentMessage: (b) => b.t === 'doc',
  };
  assert.equal(mediaKindFromBody({ t: 'audio' }, detectors), 'audio');
  assert.equal(mediaKindFromBody({ t: 'image' }, detectors), 'image');
  assert.equal(mediaKindFromBody({ t: 'doc' }, detectors), 'pdf');
  assert.equal(mediaKindFromBody({ t: 'text' }, detectors), null);
});

test('resolveMentions troca @lid pelo @PrimeiroNome', () => {
  const map = { '61087554768984': 'Rose', '83245123301394': 'Ana' };
  assert.equal(
    resolveMentions('Ai @61087554768984 @83245123301394 kkk', map),
    'Ai @Rose @Ana kkk'
  );
});
test('resolveMentions deixa @lid desconhecido como está', () => {
  assert.equal(resolveMentions('oi @99999999999 tudo bem', { '11111': 'X' }), 'oi @99999999999 tudo bem');
});
test('resolveMentions sem mapa/texto não quebra', () => {
  assert.equal(resolveMentions('texto sem mencao', null), 'texto sem mencao');
  assert.equal(resolveMentions('', { a: 'b' }), '');
});

const MEMBERS = [
  { id: 'alf', full_name: 'Luciano Alf', preferred_name: 'Alf' },
  { id: 'rose', full_name: 'Rose', preferred_name: 'Rose' },
  { id: 'ana', full_name: 'Ana Paula', preferred_name: 'Ana' },
];

test('matchMemberByName: nome exato do WhatsApp casa pelo full_name', () => {
  assert.equal(matchMemberByName('Luciano Alf', MEMBERS), 'alf');
});
test('matchMemberByName: "Rose_Gerente Recreio" casa pelo começo', () => {
  assert.equal(matchMemberByName('Rose_Gerente Recreio', MEMBERS), 'rose');
});
test('matchMemberByName: "Ana Paula Recepção/ADM" pega o nome mais longo (ana paula > ana)', () => {
  assert.equal(matchMemberByName('Ana Paula Recepção/ADM', MEMBERS), 'ana');
});
test('matchMemberByName: nome de fora do grupo → null', () => {
  assert.equal(matchMemberByName('Fulano de Tal', MEMBERS), null);
  assert.equal(matchMemberByName('', MEMBERS), null);
});
test('normalizeName tira acento e símbolos', () => {
  assert.equal(normalizeName('Ana Paula Recepção/ADM'), 'ana paula recepcao adm');
});

test('isGroupMessage true só quando data.isGroup === true', () => {
  assert.equal(isGroupMessage({ data: { isGroup: true } }), true);
  assert.equal(isGroupMessage({ data: { isGroup: false } }), false);
  assert.equal(isGroupMessage({ data: {} }), false);
  assert.equal(isGroupMessage({}), false);
});
test('extractGroupJid pega data.chatid', () => {
  assert.equal(extractGroupJid({ data: { chatid: '12345@g.us' } }), '12345@g.us');
  assert.equal(extractGroupJid({ data: {} }), null);
});
test('extractSenderPhone tira só dígitos do participante', () => {
  assert.equal(extractSenderPhone({ data: { sender: '5521999998888@s.whatsapp.net' } }), '5521999998888');
  assert.equal(extractSenderPhone({ data: { sender: '' } }), null);
});

const { maybeHandleGroupMessage } = require('./group-chat-bridge-in');

// ── Guard de isolamento do Replay Lab (spec 05/08) ────────────────────────────
// Prova o guard LIGADO, não a decisão pura (essa está em qa-isolation.test.js).
// Um cenário de QA espelhado num grupo real apareceria na frente do time.
test('mensagem de grupo vinda de perfil QA é descartada sem tocar o banco', async () => {
  let tocou = false;
  const sbEspiao = { from: () => { tocou = true; return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }; } };
  const body = { EventType: 'messages', message: { isGroup: true, chatid: '123@g.us', sender: '5500000000001@s.whatsapp.net', text: 'cenario de teste' } };
  const r = await maybeHandleGroupMessage(sbEspiao, body, { extractMessageId: () => 'X1' });
  assert.strictEqual(r.handled, true, 'QA em grupo tem que ser consumido e parar aqui');
  assert.strictEqual(tocou, false, 'guard deixou a mensagem de QA chegar no banco');
});

test('mensagem de grupo de pessoa real segue o fluxo normal (guard não afeta produção)', async () => {
  let consultou = false;
  const sb = { from: () => { consultou = true; return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }; } };
  const body = { EventType: 'messages', message: { isGroup: true, chatid: '123@g.us', sender: '5521999998888@s.whatsapp.net', text: 'oi time' } };
  await maybeHandleGroupMessage(sb, body, { extractMessageId: () => 'X2' });
  assert.strictEqual(consultou, true, 'o guard bloqueou mensagem de pessoa real');
});

// GROUPCHAT-LID-SENDER-ALIAS (Recreio, 02/09). O grupo "Administração RC" está em AddressingMode
// `lid`: o remetente chega como id linkado, os dígitos NÃO são telefone, e a identidade sai do
// NOME do perfil do WhatsApp. Medido no grupo real ANTES de ligar: "Clayton Consultor Recreio" e
// "Daiana Adm Recreio" casavam; "Fernanda ADM Recreio" (cadastro "Fefê") e "Vitoria (Adm Recreio)"
// (cadastro "Vitoria Andrade") NÃO — as duas entrariam sem autor, que é a falha muda de sempre.
// `aliases` (text[]) já existe no cadastro exatamente pra "também é conhecida por".
test('LID: casa pelo ALIAS quando o nome do WhatsApp não é o do cadastro', () => {
  const membros = [
    { id: 'fefe', full_name: 'Fefê', preferred_name: null, aliases: ['Fernanda'] },
    { id: 'vit', full_name: 'Vitoria Andrade', preferred_name: null, aliases: ['Vitoria'] },
  ];
  assert.strictEqual(matchMemberByName('Fernanda ADM Recreio', membros), 'fefe');
  assert.strictEqual(matchMemberByName('Vitoria (Adm Recreio)', membros), 'vit');
});

test('ZERO-REGRESSÃO: full_name e preferred_name continuam casando, e o mais LONGO ganha', () => {
  const membros = [
    { id: 'clay', full_name: 'Clayton', preferred_name: null, aliases: null },
    { id: 'ana', full_name: 'Ana', preferred_name: null, aliases: [] },
    { id: 'anap', full_name: 'Ana Paula', preferred_name: null, aliases: [] },
  ];
  assert.strictEqual(matchMemberByName('Clayton Consultor Recreio', membros), 'clay');
  assert.strictEqual(matchMemberByName('Ana Paula Souza', membros), 'anap');
  assert.strictEqual(matchMemberByName('Ana Souza', membros), 'ana');
});

test('ANTI-FALSO-POSITIVO: alias vazio/sujo não casa, e desconhecido segue sem autor', () => {
  const membros = [{ id: 'x', full_name: 'Fefê', preferred_name: null, aliases: ['', '   ', null] }];
  assert.strictEqual(matchMemberByName('Fernanda ADM Recreio', membros), null);
  assert.strictEqual(matchMemberByName('Zezinho da Padaria', membros), null);
  assert.strictEqual(matchMemberByName('', membros), null);
});

// ── GROUPCHAT-LID-SEM-AUTOR (ADM CG, 02/09) ───────────────────────────────────────────────
// Em grupo @lid a identidade caía toda no NOME do perfil do WhatsApp. O perfil do Jhon chega
// como "n." literal — 6 mensagens sem autor, e sem autor o TOM não processa: ficou mudo pra
// ele. Agora o lid resolve pra TELEFONE pelos participantes do grupo, e telefone não muda
// quando a pessoa edita o perfil.
const { matchMemberByPhone, chavesTelefone } = require('./group-chat-bridge-in');

test('chavesTelefone: descarta o 55 e gera a forma com e sem o 9', () => {
  assert.deepStrictEqual(chavesTelefone('5521987654321'), ['21987654321', '2187654321']);
  // CASO REAL (Vitoria, ADM CG 02/09): WhatsApp manda 12 digitos SEM o 9 e o cadastro tem 13
  // COM o 9. Fatiar "os ultimos 11" comia o DDD (31 virava 53) e ela ficava sem autor.
  assert.deepStrictEqual(chavesTelefone('553133332022'), ['3133332022']);
  assert.deepStrictEqual(chavesTelefone('5531933332022'), ['31933332022', '3133332022']);
  assert.deepStrictEqual(chavesTelefone('2187654321'), ['2187654321']);
  assert.deepStrictEqual(chavesTelefone('123'), [], 'lixo não vira chave');
  assert.deepStrictEqual(chavesTelefone(null), []);
});

test('casa telefone do WhatsApp COM 9 contra cadastro SEM 9', () => {
  const membros = [{ id: 'c1', phone: '2187654321' }];
  assert.strictEqual(matchMemberByPhone('5521987654321', membros), 'c1');
});

test('casa telefone do WhatsApp SEM 9 contra cadastro COM 9', () => {
  const membros = [{ id: 'c1', phone: '5521987654321' }];
  assert.strictEqual(matchMemberByPhone('2187654321', membros), 'c1');
});

test('não casa pessoa de outro número — sem autor é melhor que autor ERRADO', () => {
  const membros = [{ id: 'c1', phone: '5521987654321' }];
  assert.strictEqual(matchMemberByPhone('5511999998888', membros), null);
});

test('membro sem telefone cadastrado não quebra o casamento dos outros', () => {
  const membros = [{ id: 'c0', phone: null }, { id: 'c1', phone: '5521987654321' }];
  assert.strictEqual(matchMemberByPhone('5521987654321', membros), 'c1');
});

test('CASO REAL: numero de 12 digitos (sem o 9) casa com cadastro de 13 (com o 9)', () => {
  assert.strictEqual(matchMemberByPhone('553133332022', [{ id: 'vit', phone: '5531933332022' }]), 'vit');
  assert.strictEqual(matchMemberByPhone('5531933332022', [{ id: 'vit', phone: '553133332022' }]), 'vit');
});

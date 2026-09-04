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

// ── GROUPCHAT-REMETENTE-DISPOSITIVO (Administração Recreio + ADM Barra, 04/09) ─────────────
// Medido na produção: a "Fê ✨" mandou 10 mensagens numa manhã (09:33→10:46) e TODAS entraram
// sem autor; a "Anne", 3. Ela vinha sendo identificada normalmente até 08:43 do mesmo dia.
// A causa: quando a pessoa fala de um aparelho VINCULADO, o WhatsApp manda o remetente como
// "<lid>:<aparelho>@lid". O extractSenderPhone tirava TODO caractere não-dígito, então o número
// do aparelho COLAVA no lid (15 dígitos viravam 17) e o degrau do lid comparava esse número
// emendado com o lid de 15 do /group/info — nunca casava. Medido no grupo real (POST
// /message/find, 04/09): 13 mensagens da "Fê ✨" com sufixo → 17 dígitos, nenhuma casando;
// 5 sem sufixo → 15 dígitos, todas casando. O aparelho NÃO faz parte da identidade.
const { idDoRemetente, getParticipantsCached, _limpaCacheParticipantes } = require('./group-chat-bridge-in');

test('DISPOSITIVO: o sufixo ":<aparelho>" não entra na identidade do remetente', () => {
  // 15 dígitos de lid + ":42" de aparelho vinculado. Antes virava um número de 17.
  assert.strictEqual(extractSenderPhone({ data: { sender: '199999999999999:42@lid' } }), '199999999999999');
  assert.strictEqual(extractSenderPhone({ data: { sender: '5521987654321:12@s.whatsapp.net' } }), '5521987654321');
  assert.strictEqual(idDoRemetente('199999999999999:42@lid'), '199999999999999');
});

test('DISPOSITIVO: zero-regressão — remetente sem sufixo continua igual', () => {
  assert.strictEqual(extractSenderPhone({ data: { sender: '5521999998888@s.whatsapp.net' } }), '5521999998888');
  assert.strictEqual(extractSenderPhone({ data: { sender: '199999999999999@lid' } }), '199999999999999');
  assert.strictEqual(extractSenderPhone({ data: { sender: '' } }), null);
});

// Supabase de mentira: responde leitura e GUARDA o insert (nunca toca banco de verdade).
function fakeSupabase({ membros = [], cadastro = null, porTelefone = null }) {
  const inserts = [];
  const alvo = (tabela) => {
    const o = {
      _in: false,
      select() { return o; },
      eq() { return o; },
      or() { return o; },
      is() { return o; },
      like() { return o; },
      in() { o._in = true; return o; },
      maybeSingle: async () => {
        if (tabela === 'work_groups') return { data: { id: 'G1' } };
        if (tabela === 'collaborators') return { data: porTelefone };
        return { data: null };
      },
      then(res) {
        if (tabela === 'work_group_members') return res({ data: membros.map((m) => ({ collaborator_id: m.id })) });
        // com .in() = membros do grupo; sem .in() = varredura do cadastro inteiro
        if (tabela === 'collaborators') return res({ data: o._in ? membros : (cadastro || membros) });
        return res({ data: [] });
      },
      insert(row) { inserts.push(row); return Promise.resolve({ error: null }); },
    };
    return o;
  };
  return { from: alvo, _inserts: inserts };
}

function capturaWarn(fn) {
  const linhas = [];
  const orig = console.warn;
  console.warn = (...a) => linhas.push(a.join(' '));
  return Promise.resolve(fn()).finally(() => { console.warn = orig; }).then(() => linhas);
}

const corpoGrupo = (sender, senderName) => ({
  EventType: 'messages',
  message: { isGroup: true, chatid: 'GRUPO@g.us', sender, senderName, text: 'bom dia, time', fromMe: false },
});
const helpersBase = (parts) => ({
  extractText: (b) => b.message.text,
  extractMessageId: () => 'WAID' + Math.random(),
  getGroupParticipants: async () => parts,
});

test('CASO FEFÊ: remetente @lid COM sufixo de aparelho é resolvido pelo par (lid, telefone)', async () => {
  _limpaCacheParticipantes();
  const membros = [{ id: 'fefe', full_name: 'Fefê', preferred_name: null, aliases: ['Fernanda', 'Fefe'], phone: '5521987654321' }];
  const sb = fakeSupabase({ membros });
  const parts = [{ lid: '199999999999999', phone: '5521987654321' }];
  await maybeHandleGroupMessage(sb, corpoGrupo('199999999999999:42@lid', 'Fê ✨'), helpersBase(parts));
  assert.strictEqual(sb._inserts.length, 1);
  assert.strictEqual(sb._inserts[0].sender_id, 'fefe', 'o aparelho vinculado não pode apagar a identidade');
  assert.strictEqual(sb._inserts[0].wa_sender_name, null);
});

test('CASO ANNE: quem está no CADASTRO mas ainda não em work_group_members resolve pelo telefone', async () => {
  _limpaCacheParticipantes();
  const membros = [{ id: 'kai', full_name: 'Kailane', preferred_name: null, aliases: [], phone: '5521911112222' }];
  const cadastro = [...membros, { id: 'anne', full_name: 'Anne Susan', phone: '5521933334444' }];
  const sb = fakeSupabase({ membros, cadastro });
  const parts = [{ lid: '288888888888888', phone: '5521933334444' }];
  await maybeHandleGroupMessage(sb, corpoGrupo('288888888888888:11@lid', 'Anne'), helpersBase(parts));
  assert.strictEqual(sb._inserts[0].sender_id, 'anne', 'telefone é identificador duro: não depende de work_group_members');
});

test('AMBIGUIDADE: dois cadastros no mesmo telefone → SEM AUTOR (chutar é pior que calar)', async () => {
  _limpaCacheParticipantes();
  const membros = [{ id: 'kai', full_name: 'Kailane', phone: '5521911112222' }];
  const cadastro = [...membros, { id: 'a', full_name: 'Pessoa A', phone: '5521933334444' }, { id: 'b', full_name: 'Pessoa B', phone: '5521933334444' }];
  const sb = fakeSupabase({ membros, cadastro });
  const parts = [{ lid: '288888888888888', phone: '5521933334444' }];
  const linhas = await capturaWarn(() => maybeHandleGroupMessage(sb, corpoGrupo('288888888888888@lid', 'Zezinho'), helpersBase(parts)));
  assert.strictEqual(sb._inserts[0].sender_id, null);
  assert.ok(linhas.some((l) => /ambiguo/i.test(l)), `esperava rastro de ambiguidade, veio: ${linhas.join(' | ')}`);
});

test('CONFLITO: telefone diz uma pessoa e o perfil diz outra cadastrada → autor pelo telefone + alarme', async () => {
  _limpaCacheParticipantes();
  // Caso real (ADM Barra, 04/09): o número gravado na linha da "Krissya" é o número do perfil
  // "Anne". Sem alarme, o TOM registra a Anne como Krissya pra sempre e ninguém vê.
  const membros = [{ id: 'kri', full_name: 'Krissya', aliases: ['Kris'], phone: '5521933334444' }];
  const cadastro = [...membros, { id: 'anne', full_name: 'Anne Susan', aliases: [], phone: '5521955556666' }];
  const sb = fakeSupabase({ membros, cadastro });
  const parts = [{ lid: '288888888888888', phone: '5521933334444' }];
  const linhas = await capturaWarn(() => maybeHandleGroupMessage(sb, corpoGrupo('288888888888888@lid', 'Anne'), helpersBase(parts)));
  assert.strictEqual(sb._inserts[0].sender_id, 'kri', 'o telefone é a evidência dura — o nome não pode virar o autor');
  const alarme = linhas.find((l) => l.includes('CONFLITO DE IDENTIDADE'));
  assert.ok(alarme, `esperava alarme de conflito, veio: ${JSON.stringify(linhas)}`);
  assert.ok(alarme.includes('Anne') && alarme.includes('kri') && alarme.includes('anne'));
});

test('CONFLITO: identidade coerente (telefone e nome apontam a mesma pessoa) não gera alarme', async () => {
  _limpaCacheParticipantes();
  const membros = [{ id: 'vit', full_name: 'Vitoria Andrade', aliases: ['Vitória'], phone: '5531933332022' }];
  const sb = fakeSupabase({ membros, cadastro: membros });
  const parts = [{ lid: '377777777777777', phone: '5531933332022' }];
  const linhas = await capturaWarn(() => maybeHandleGroupMessage(sb, corpoGrupo('377777777777777:9@lid', 'Vitória'), helpersBase(parts)));
  assert.strictEqual(sb._inserts[0].sender_id, 'vit');
  assert.ok(!linhas.some((l) => l.includes('CONFLITO')), `alarme falso: ${JSON.stringify(linhas)}`);
});

test('RASTRO: mensagem que ninguém resolve deixa perfil, grupo e o degrau onde parou', async () => {
  _limpaCacheParticipantes();
  const membros = [{ id: 'kai', full_name: 'Kailane', phone: '5521911112222' }];
  const sb = fakeSupabase({ membros, cadastro: membros });
  const parts = [{ lid: '111111111111111', phone: '5521911112222' }];
  const linhas = await capturaWarn(() => maybeHandleGroupMessage(sb, corpoGrupo('999999999999999@lid', 'Eduarda Bonfim ✨'), helpersBase(parts)));
  assert.strictEqual(sb._inserts[0].sender_id, null);
  const rastro = linhas.find((l) => l.includes('SEM AUTOR'));
  assert.ok(rastro, `sem rastro nenhum. warns: ${JSON.stringify(linhas)}`);
  assert.ok(rastro.includes('Eduarda Bonfim ✨'), 'o rastro tem que dizer QUEM tentou falar');
  assert.ok(rastro.includes('G1'), 'o rastro tem que dizer em QUAL grupo');
  assert.ok(/parou_em=/.test(rastro), 'o rastro tem que dizer em QUE degrau a cadeia parou');
  assert.ok(!/\d{10,}/.test(rastro), 'rastro NUNCA pode carregar telefone/lid inteiro');
});

test('RASTRO: falha ao buscar participantes não morre em silêncio', async () => {
  _limpaCacheParticipantes();
  const membros = [{ id: 'kai', full_name: 'Kailane', phone: '5521911112222' }];
  const sb = fakeSupabase({ membros, cadastro: membros });
  const helpers = { ...helpersBase([]), getGroupParticipants: async () => { throw new Error('UAZAPI 503'); } };
  const linhas = await capturaWarn(() => maybeHandleGroupMessage(sb, corpoGrupo('999999999999999@lid', 'Fê ✨'), helpers));
  assert.ok(linhas.some((l) => l.includes('UAZAPI 503')), `a falha do degrau do lid tem que aparecer: ${JSON.stringify(linhas)}`);
  assert.ok(linhas.some((l) => l.includes('SEM AUTOR')), 'e a mensagem sem autor também');
});

test('CACHE: lista de participantes VAZIA não fica guardada (senão cega o degrau por 5 min)', async () => {
  _limpaCacheParticipantes();
  let chamadas = 0;
  const fetchFn = async () => { chamadas++; return chamadas === 1 ? [] : [{ lid: '1', phone: '2' }]; };
  assert.deepStrictEqual(await getParticipantsCached(fetchFn, 'JID'), []);
  const segunda = await getParticipantsCached(fetchFn, 'JID');
  assert.strictEqual(chamadas, 2, 'lista vazia não pode ser cacheada');
  assert.strictEqual(segunda.length, 1);
});

// ── Degrau 2 (nome do perfil): o que é seguro melhorar ────────────────────────────────────
const MEMBROS_NOME = [
  { id: 'anne', full_name: 'Anne Susan', preferred_name: null, aliases: ['Ani', 'Any'] },
  { id: 'kai', full_name: 'Kailane', preferred_name: null, aliases: [] },
];

test('NOME: "Anne ✨" (emoji + forma curta) casa "Anne Susan" quando é a ÚNICA', () => {
  assert.strictEqual(matchMemberByName('Anne ✨', MEMBROS_NOME), 'anne');
  assert.strictEqual(matchMemberByName('anne', MEMBROS_NOME), 'anne');
  assert.strictEqual(matchMemberByName('*Anne!*', MEMBROS_NOME), 'anne', 'decoração pura some no normalizeName');
  assert.strictEqual(matchMemberByName('Anne Susan ✨', MEMBROS_NOME), 'anne', 'nome inteiro + emoji');
});

test('NOME: LIMITE CONSCIENTE — forma curta com PALAVRA extra não casa', () => {
  // "Anne 💗 Comercial" fica sem autor de propósito. O emoji some, mas "comercial" é uma
  // palavra: aceitar isso é aceitar que "Ana Souza" (uma visitante) vire "Ana Paula" (a
  // colaboradora). A regra invertida só vale quando o perfil traz o começo do nome e NADA mais.
  // Quem cobre esse caso é o telefone; e o rastro diz pro dono cadastrar o apelido.
  assert.strictEqual(matchMemberByName('Anne 💗 Comercial', MEMBROS_NOME), null);
  assert.strictEqual(matchMemberByName('Ana Souza', [{ id: 'ap', full_name: 'Ana Paula', aliases: [] }]), null);
});

test('NOME: forma curta AMBÍGUA não casa — identificar errado é pior que não identificar', () => {
  const dois = [
    { id: 'a1', full_name: 'Ana Paula', aliases: [] },
    { id: 'a2', full_name: 'Ana Beatriz', aliases: [] },
  ];
  assert.strictEqual(matchMemberByName('Ana ✨', dois), null);
  assert.strictEqual(matchMemberByName('Ana', dois), null);
});

test('NOME: empate de mesmo tamanho entre pessoas diferentes → sem autor', () => {
  const dois = [{ id: 'x', full_name: 'Ana', aliases: [] }, { id: 'y', full_name: 'Ana', aliases: [] }];
  assert.strictEqual(matchMemberByName('Ana Souza', dois), null);
});

test('NOME: LIMITE CONSCIENTE — "Fê ✨" NÃO vira "Fefê" por pedaço de palavra', () => {
  // "fe" é começo de "fefe", de "fernanda", de "felipe"... casar por pedaço DENTRO da palavra
  // entrega a identidade de uma pessoa real a duas letras de um perfil qualquer. Quem resolve
  // a Fefê é o TELEFONE (degrau do lid); o nome fica de fora, e o rastro diz pro dono cadastrar
  // "Fê" como alias — que é a porta certa, revisada por humano.
  const m = [{ id: 'fefe', full_name: 'Fefê', preferred_name: null, aliases: ['Fernanda', 'Fefe'] }];
  assert.strictEqual(matchMemberByName('Fê ✨', m), null);
  assert.strictEqual(matchMemberByName('Fefe ✨', m), 'fefe', 'a forma COMPLETA com emoji tem que casar');
});

test('NOME: zero-regressão do começo-do-nome com os casos reais já cobertos', () => {
  assert.strictEqual(matchMemberByName('Rose_Gerente Recreio', MEMBERS), 'rose');
  assert.strictEqual(matchMemberByName('Ana Paula Recepção/ADM', MEMBERS), 'ana');
  assert.strictEqual(matchMemberByName('Fulano de Tal', MEMBERS), null);
});

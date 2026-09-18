'use strict';
// pix-lista-marker.test.js — o TOM pede a LISTA do PIX pelo marcador <<LISTA_PIX>>.
//
// O CASO (Barra, 17/09 15:40). Arthur: "tom quais são os alunos pix que ainda não está no pix
// automático?". O TOM respondeu "me manda a planilha/relatório de cobrança". A fonte sempre teve
// os nomes. O detector por palavra (pix-consulta.detectarPedido) só conhece "lista", "nomes",
// "quem falta"; qualquer outra forma de pedir caía no LLM, que não tinha como puxar a lista e
// pedia planilha. Conserto do jeito da casa (decisão do Alf 02/09, "eu fujo de regex"): o LLM
// entende a pergunta e emite o marcador; QUEM ESCREVE OS NOMES É O CÓDIGO — igual ao
// <<SITUACAO_ALUNO>>. Junto, o prompt ensina a diferença entre Pix avulso, PIX automático e
// cadastrado sem cobrança ("alunos pix que não estão no automático" = Pix avulso).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pura = require('./pix-consulta');
const f = require('./pix-consulta-fontes');
const { resolverUnidade } = require('./situacao-aluno');
const { buildGroupChatPrompt } = require('./group-chat-prompt');

const BARRA = resolverUnidade('barra');
const RECREIO = resolverUnidade('recreio');
const DADO = '2026-09-18T09:00:00Z';
const linha = (o) => ({ pagador_nome: 'X', pagador_chave: 'k', alunos: [], dado_atualizado_em: DADO, fatia: null, categoria: 'nao_mexe', ...o });
const ok = (data) => async () => ({ data, error: null });
const erro = (msg) => async () => ({ data: null, error: { message: msg } });
const semRetry = (consulta) => consulta();
const PIX = [
  linha({ categoria: 'migrar', fatia: 'pix_avulso', pagador_nome: 'Ana Avulso', alunos: ['A1'] }),
  linha({ categoria: 'migrar', fatia: 'pix_avulso', pagador_nome: 'Bia Avulso', alunos: ['B1'] }),
  linha({ categoria: 'migrar', fatia: 'cheque', pagador_nome: 'Caio Cheque', alunos: ['C1'] }),
  linha({ categoria: 'autorizacao_pendente', fatia: null, pagador_nome: 'Dora Cadastrada', alunos: ['D1'] }),
  linha({ categoria: 'nao_mexe', fatia: null, pagador_nome: 'Fred Cartao' }),
];
const depsFeliz = { rpcPix: ok(PIX), rpcSituacao: ok([]), retry: semRetry };
const marker = (obj) => `Puxei da fonte agora 👇\n<<LISTA_PIX>>${JSON.stringify(obj)}<<END>>`;
const nomes = (msgs) => msgs.join('\n');

// ── alvosDoMarker (puro) ────────────────────────────────────────────────────────────────────
test('alvosDoMarker: alvo válido passa; inválido/ausente vira "pix" (todo mundo que falta)', () => {
  assert.deepStrictEqual(pura.alvosDoMarker('pix_avulso'), ['pix_avulso']);
  assert.deepStrictEqual(pura.alvosDoMarker('CHEQUE'), ['cheque']);
  assert.deepStrictEqual(pura.alvosDoMarker('qualquer_coisa'), ['pix']);
  assert.deepStrictEqual(pura.alvosDoMarker(undefined), ['pix']);
  assert.deepStrictEqual(pura.alvosDoMarker(''), ['pix']);
});

test('alvosDoMarker: lista de formas — sem repetição, no máximo 3, "tudo" engole o resto', () => {
  assert.deepStrictEqual(pura.alvosDoMarker(['pix_avulso', 'cheque']), ['pix_avulso', 'cheque']);
  assert.deepStrictEqual(pura.alvosDoMarker(['cheque', 'cheque', 'boleto']), ['cheque', 'boleto']);
  assert.deepStrictEqual(pura.alvosDoMarker(['pix_avulso', 'cheque', 'boleto', 'dinheiro']), ['pix_avulso', 'cheque', 'boleto']);
  assert.deepStrictEqual(pura.alvosDoMarker(['cheque', 'tudo']), ['tudo']);
  assert.deepStrictEqual(pura.alvosDoMarker(['lixo', 'outro']), ['pix']);
  assert.deepStrictEqual(pura.alvosDoMarker([]), ['pix']);
});

test('alvosDoMarker: anamnese e contrato também valem (a fonte de aluno já existe)', () => {
  assert.deepStrictEqual(pura.alvosDoMarker('anamnese'), ['anamnese']);
  assert.deepStrictEqual(pura.alvosDoMarker(['contrato']), ['contrato']);
});

// ── mensagensDaListaPix (lê a fonte, devolve as mensagens prontas) ─────────────────────────
test('mensagensDaListaPix: unidade dada -> só os nomes daquela forma, com a unidade no título', async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix_avulso'], deps: depsFeliz });
  assert.strictEqual(r.total, 2);
  assert.match(r.msgs[0], /Pix avulso — Barra/);
  assert.match(nomes(r.msgs), /Ana Avulso/);
  assert.match(nomes(r.msgs), /Bia Avulso/);
  assert.ok(!/Caio Cheque|Dora Cadastrada|Fred Cartao/.test(nomes(r.msgs)), 'só a forma pedida');
});

test('mensagensDaListaPix: duas formas -> dois blocos, cada um com o seu título', async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix_avulso', 'cheque'], deps: depsFeliz });
  assert.strictEqual(r.total, 3);
  assert.match(nomes(r.msgs), /Pix avulso — Barra/);
  assert.match(nomes(r.msgs), /Cheque — Barra/);
});

test('mensagensDaListaPix: sem unidade -> as três unidades, cada uma no seu título', async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: null, unidadeNome: null, alvos: ['pix_avulso'], deps: depsFeliz });
  const txt = nomes(r.msgs);
  assert.match(txt, /Campo Grande/);
  assert.match(txt, /Recreio/);
  assert.match(txt, /Barra/);
  assert.strictEqual(r.total, 6);
});

test('mensagensDaListaPix: fonte fora -> LANÇA (quem chama diz a verdade; lista vazia nunca)', async () => {
  await assert.rejects(
    () => f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix_avulso'], deps: { ...depsFeliz, rpcPix: erro('caiu') } }),
  );
});

// ── atenderMarkersListaPix (o marcador emitido pelo LLM) ───────────────────────────────────
test('marcador no grupo da Barra: tira o marcador da fala e devolve a lista do Pix avulso', async () => {
  const r = await f.atenderMarkersListaPix({ reply: marker({ alvo: 'pix_avulso' }), grupoUnidadeId: BARRA, deps: depsFeliz });
  assert.ok(!/<<LISTA_PIX>>|<<END>>/.test(r.limpo), 'o marcador nunca chega no grupo');
  assert.match(r.limpo, /Puxei da fonte agora/);
  assert.match(nomes(r.mensagens), /Pix avulso — Barra/);
  assert.match(nomes(r.mensagens), /Ana Avulso/);
  assert.strictEqual(r.actions.length, 1);
  assert.strictEqual(r.actions[0].status, 'ok');
});

test('unidade DITA no marcador vence a do grupo (lista do Recreio pedida no grupo da Barra)', async () => {
  const r = await f.atenderMarkersListaPix({ reply: marker({ alvo: 'pix_avulso', unidade: 'recreio' }), grupoUnidadeId: BARRA, deps: depsFeliz });
  assert.match(nomes(r.mensagens), /Pix avulso — Recreio/);
  assert.ok(!/— Barra/.test(nomes(r.mensagens)));
});

test('grupo sem unidade e marcador sem unidade -> as três (grupo PIX AUTOMÁTICO L.A)', async () => {
  const r = await f.atenderMarkersListaPix({ reply: marker({ alvo: 'pix_avulso' }), grupoUnidadeId: null, deps: depsFeliz });
  const txt = nomes(r.mensagens);
  assert.match(txt, /Campo Grande/);
  assert.match(txt, /Recreio/);
  assert.match(txt, /Barra/);
});

test('JSON quebrado no marcador -> lista de todo mundo que falta migrar, nunca silêncio', async () => {
  const r = await f.atenderMarkersListaPix({ reply: 'ok 👇\n<<LISTA_PIX>>{alvo: pix<<END>>', grupoUnidadeId: BARRA, deps: depsFeliz });
  assert.match(nomes(r.mensagens), /quem falta migrar — Barra/);
  assert.match(nomes(r.mensagens), /Caio Cheque/);
  assert.ok(!/<<LISTA_PIX>>/.test(r.limpo));
});

test('fonte fora: ação FALHA com motivo, nenhuma mensagem de lista, marcador arrancado', async () => {
  const r = await f.atenderMarkersListaPix({ reply: marker({ alvo: 'pix_avulso' }), grupoUnidadeId: BARRA, deps: { ...depsFeliz, rpcPix: erro('a RPC caiu') } });
  assert.strictEqual(r.mensagens.length, 0);
  assert.strictEqual(r.actions[0].status, 'fail');
  assert.match(r.actions[0].detail, /LA Report/);
  assert.ok(!/<<LISTA_PIX>>/.test(r.limpo));
});

test('dois marcadores no mesmo turno: atende o primeiro, avisa do segundo e arranca os dois', async () => {
  const reply = `${marker({ alvo: 'pix_avulso' })}\n<<LISTA_PIX>>{"alvo":"cheque"}<<END>>`;
  let leituras = 0;
  const deps = { ...depsFeliz, rpcPix: async () => { leituras += 1; return { data: PIX, error: null }; } };
  const r = await f.atenderMarkersListaPix({ reply, grupoUnidadeId: BARRA, deps });
  assert.strictEqual(leituras, 1, 'uma leitura só: um pedido de lista por turno');
  assert.ok(!/<<LISTA_PIX>>/.test(r.limpo));
  assert.deepStrictEqual(r.actions.map((a) => a.status), ['ok', 'ask']);
});

test('sem marcador: devolve a fala intacta e NÃO lê fonte nenhuma', async () => {
  const deps = { rpcPix: async () => { throw new Error('não era pra ler'); }, rpcSituacao: async () => { throw new Error('não era pra ler'); }, retry: semRetry };
  const r = await f.atenderMarkersListaPix({ reply: 'Bom dia, time!', grupoUnidadeId: BARRA, deps });
  assert.strictEqual(r.limpo, 'Bom dia, time!');
  assert.deepStrictEqual(r.mensagens, []);
  assert.deepStrictEqual(r.actions, []);
});

// ── O prompt ensina o marcador e a diferença entre as coisas ───────────────────────────────
const promptBase = () => buildGroupChatPrompt({ soulText: '', groupName: 'Administrativo e Comercial Barra', members: [], pool: [], history: [], senderName: 'Arthur' });

test('prompt do grupo traz o marcador <<LISTA_PIX>> com os alvos', () => {
  const p = promptBase();
  assert.match(p, /<<LISTA_PIX>>\{"alvo":/);
  for (const alvo of ['pix_avulso', 'autorizacao_pendente', 'cheque', 'boleto', 'ja_migrou']) assert.ok(p.includes(alvo), `alvo ${alvo} no prompt`);
});

test('prompt ensina a DIFERENÇA: "alunos pix que não estão no automático" = Pix avulso', () => {
  const p = promptBase();
  assert.match(p, /não estão no (pix )?automático[^\n]*pix_avulso/i);
  assert.match(p, /Cadastrados sem cobrança[^\n]*Emusys/i);
  assert.match(p, /PIX automático[^\n]*(destino|recorrente)/i);
});

test('prompt proíbe pedir planilha pra montar a lista', () => {
  assert.match(promptBase(), /NUNCA peça planilha/);
});

// ── O bloco de números manda usar o marcador, não "é só pedir lista completa" ──────────────
test('bloco de números (uma unidade e três unidades) aponta o marcador e proíbe planilha', () => {
  const um = pura.blocoDeNumeros({ unidadeNome: 'Barra', pix: { total: 1, faltam: 1, migrar: 1, fatias: {} }, anamnese: { pendentes: 0, base: 0 }, contrato: { pendentes: 0, base: 0 }, dadoEm: DADO, dadoDeHoje: true });
  const tres = pura.blocoDeNumerosTodasUnidades({ unidades: [{ unidadeNome: 'Barra', pix: { total: 1, faltam: 1, migrar: 1, fatias: {} }, anamnese: { pendentes: 0, base: 0 }, contrato: { pendentes: 0, base: 0 }, dadoEm: DADO }] });
  for (const b of [um, tres]) {
    assert.match(b, /<<LISTA_PIX>>/);
    assert.match(b, /nunca peça planilha/i);
    assert.ok(!/é só pedir "lista completa/.test(b), 'a instrução velha jogava a pessoa pra repetir o pedido');
  }
});

// ── Ligação no motor do grupo (âncora de código) ───────────────────────────────────────────
const engine = fs.readFileSync(path.join(__dirname, 'group-chat-engine.js'), 'utf8');

test('o motor processa <<LISTA_PIX>> depois do LLM e posta as listas DEPOIS da fala e dos cards', () => {
  const iLlm = engine.indexOf('ai.chat(');
  const iMarker = engine.indexOf('await atenderMarkersListaPix(');
  const iFala = engine.indexOf("from('group_chat_messages').insert({\n    group_id: groupId, sender_id: null, role: 'tom', kind: 'text', content, channel: 'app',");
  const iCards = engine.indexOf('for (const html of cards)');
  const iListas = engine.indexOf('for (const m of listasPix)');
  assert.ok(iMarker > iLlm, 'o marcador só existe depois da resposta do LLM');
  assert.ok(iFala > 0 && iCards > iFala, 'fala e depois cards (como já era)');
  assert.ok(iListas > iCards, 'as listas saem por último: a fala do TOM diz 👇 e o 👇 aponta pra lista');
});

test('falha na lista via marcador fica dentro de try/catch e vira ação honesta', () => {
  assert.match(engine, /catch \(e\) \{\s*console\.error\('\[GroupChat\] lista PIX por marcador/,
    'a lista do marcador precisa de catch próprio');
});

'use strict';
// pix-lista-cartao-cadastrado.test.js — recorte 💳 da lista do PIX (Administração Recreio, 06/10).
//
// O CASO (06/10 11:10–11:21 BRT). O TOM mandou a lista inteira do Recreio, com a seção
// "💳 Cartão cadastrado, pagando PIX (5)", e o resumo da sessão repetiu "5 clientes já têm cartão
// cadastrado mas ainda pagam por PIX". A Fefê perguntou: "Tom, Quem são esses 5 clientes que já tem
// cartão cadastrado, mas ainda pagam por pix ?". Não havia como pedir SÓ a seção 💳: o modelo pegou
// o alvo mais parecido ("cartao_avulso" = maquininha) e o grupo recebeu "Maquininha — Recreio
// (0 clientes) … Ninguém nesta lista agora" — falso. Agora existe o alvo "cartao_cadastrado", que
// lê a MESMA fonte e a MESMA conta da lista inteira e devolve só a seção 💳.
// (Nomes de cliente aqui são fictícios; a fala da Fefê é a real.)
const { test } = require('node:test');
const assert = require('node:assert');
const pura = require('./pix-consulta');
const f = require('./pix-consulta-fontes');
const { resolverUnidade } = require('./situacao-aluno');
const { buildGroupChatPrompt } = require('./group-chat-prompt');

const RECREIO = resolverUnidade('recreio');
const FALA_REAL = 'Tom, Quem são esses 5 clientes que já tem cartão cadastrado, mas ainda pagam por pix ?';
const L = (o) => ({ pagador_chave: `k-${o.pagador_nome}`, alunos: [], matriculas: [1], categoria: 'migrar', fatia: 'pix_avulso', forma_ultima_mensalidade: 'Pix', cobranca_automatica_cadastrada: null, dado_atualizado_em: '2026-10-06T09:00:00Z', ...o });
const cartao = (n, alunos, o = {}) => L({ pagador_nome: n, alunos, cobranca_automatica_cadastrada: 'Cartão de Crédito', ...o });
const semInterruptor = async (fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  delete process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  try { return await fn(); } finally { if (antes !== undefined) process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

// Recreio de mentirinha com a MESMA forma do 06/10: 5 💳 (um deles de cheque, um com 2 filhos),
// livres de várias formas, um de maquininha, um 🔒 que também tem cartão (🔒 vence: não é 💳),
// 🔵 cadastrado sem cobrança e quem já migrou.
const FONTE = [
  L({ pagador_nome: 'Alice Avulso', alunos: ['Alice Filha'] }),
  L({ pagador_nome: 'Mário Maquininha', alunos: ['Mário Filho'], fatia: 'cartao_avulso', forma_ultima_mensalidade: 'Cartão de Crédito' }),
  L({ pagador_nome: 'Paula Presa', alunos: ['P1', 'P2'], matriculas: [1, 2], cobranca_automatica_cadastrada: 'Cartão de Crédito' }),
  L({ pagador_nome: 'Carla Cadastrada', alunos: ['C1'], categoria: 'autorizacao_pendente', fatia: null }),
  L({ pagador_nome: 'Júlio Já Foi', alunos: ['J1'], categoria: 'ja_migrou', fatia: null }),
  cartao('Bruno Cartão', ['Bia Cartão']),
  cartao('Ana Cartão', ['Ana Cartão']),
  cartao('Edu Cartão', ['Eva Cartão', 'Ian Cartão']),
  cartao('Dani Cartão', ['Davi Cartão'], { fatia: 'cheque', forma_ultima_mensalidade: 'Cheque' }),
  cartao('Caio Cartão', ['Cris Cartão']),
];
const deps = { rpcPix: async () => ({ data: FONTE, error: null }), rpcSituacao: async () => ({ data: [], error: null }), retry: (fn) => fn(), hoje: '2026-10-06' };
const marker = (obj) => `Peguei da fonte agora 👇\n<<LISTA_PIX>>${JSON.stringify(obj)}<<END>>`;
const NOMES_CARTAO = ['Ana Cartão', 'Bruno Cartão', 'Caio Cartão', 'Dani Cartão', 'Edu Cartão'];

test('alvosDoMarker: "cartao_cadastrado" é alvo próprio; "cartao_pix" é apelido; maquininha segue "cartao_avulso"', () => {
  assert.deepStrictEqual(pura.alvosDoMarker('cartao_cadastrado'), ['cartao_cadastrado']);
  assert.deepStrictEqual(pura.alvosDoMarker('cartao_pix'), ['cartao_cadastrado']);
  assert.deepStrictEqual(pura.alvosDoMarker(['cartao_pix', 'cartao_cadastrado']), ['cartao_cadastrado']);
  assert.deepStrictEqual(pura.alvosDoMarker('cartao_avulso'), ['cartao_avulso']);
});

test('06/10 Recreio: o marcador "cartao_cadastrado" manda os 5 💳 — nunca "Maquininha (0)"', () => semInterruptor(async () => {
  const r = await f.atenderMarkersListaPix({ reply: marker({ alvo: 'cartao_cadastrado' }), grupoUnidadeId: RECREIO, deps });
  const t = r.mensagens.join('\n');
  assert.strictEqual(r.mensagens.length, 1);
  assert.match(t, /^💠 \*Cartão cadastrado, pagando PIX — Recreio\* \(5 clientes\) — parte 1\/1\n/);
  assert.match(t, /✅ \*1 de 10 já migraram\* · faltam 9/, 'mesmo resumo da lista inteira');
  assert.match(t, /\n💳 \*Cartão cadastrado, pagando PIX\* \(5\) — conferir no Emusys/);
  for (const n of NOMES_CARTAO) assert.ok(t.includes(`   • ${n} (`), `${n} na lista`);
  assert.ok(t.includes('   • Edu Cartão (Eva Cartão, Ian Cartão)'), 'família com os filhos, igual à lista inteira');
  for (const n of ['Alice Avulso', 'Mário Maquininha', 'Paula Presa', 'Carla Cadastrada', 'Júlio Já Foi']) assert.ok(!t.includes(n), `${n} não é 💳`);
  assert.ok(!/Maquininha|Ninguém nesta lista/.test(t));
  assert.deepStrictEqual(r.actions, [{ kind: 'situacao', status: 'ok', label: 'Lista: Cartão cadastrado, pagando PIX — Recreio' }]);
}));

test('fonte única: a lista 💳 é EXATAMENTE a seção 💳 da lista inteira (mesmos nomes, mesma ordem, mesmo cabeçalho)', () => semInterruptor(async () => {
  const inteira = (await f.blocosDaLista({ unidadeId: RECREIO, alvo: 'pix', deps })).blocos[0];
  const so = (await f.blocosDaLista({ unidadeId: RECREIO, alvo: 'cartao_cadastrado', deps })).blocos[0];
  const secaoCartao = inteira.itens.filter((it) => String(it.secao).startsWith('💳'));
  assert.strictEqual(secaoCartao.length, 5);
  assert.deepStrictEqual(so.itens, secaoCartao);
  assert.deepStrictEqual(so.resumo, inteira.resumo);
  // o número do cabeçalho 💳 da lista inteira (de onde veio o "5" da Fefê) é o tamanho do recorte
  const n = Number(/\((\d+)\)/.exec(secaoCartao[0].secao)[1]);
  assert.strictEqual(n, so.itens.length);
  // e a contagem do bloco de números (que o resumo da sessão repete) bate também
  const num = await f.numerosDaUnidade({ unidadeId: RECREIO, unidadeNome: 'Recreio', hoje: '2026-10-06', deps });
  assert.strictEqual(num.pix.cartao_cadastrado, so.itens.length);
}));

test('maquininha continua sendo a maquininha (cartão no balcão), não o 💳', () => semInterruptor(async () => {
  const so = (await f.blocosDaLista({ unidadeId: RECREIO, alvo: 'cartao_avulso', deps })).blocos[0];
  assert.deepStrictEqual(so.itens.map((it) => it.pagador), ['Mário Maquininha']);
  assert.strictEqual(pura.detectarPedido('me manda a lista do pix da maquininha').alvo, 'cartao_avulso');
}));

test('por palavra: "lista de quem tem cartão cadastrado e paga pix" vai pro recorte 💳', () => {
  assert.deepStrictEqual(pura.detectarPedido('Tom, me manda a lista de quem tem cartão cadastrado e paga pix'), { tipo: 'lista', alvo: 'cartao_cadastrado' });
  assert.deepStrictEqual(pura.detectarPedido('lista dos 💳 do pix'), { tipo: 'lista', alvo: 'cartao_cadastrado' });
  assert.strictEqual(pura.tituloDoAlvo('cartao_cadastrado'), 'Cartão cadastrado, pagando PIX');
});

test('fala real da Fefê: não intercepta por palavra, e o bloco de números ensina o alvo dos 💳', () => semInterruptor(async () => {
  const postados = [];
  const r = await f.atenderPedidoNoGrupo({ unidadeId: RECREIO, unidadeNome: 'Recreio', text: FALA_REAL, hoje: '2026-10-06', postar: async (m) => postados.push(m), deps });
  assert.strictEqual(r.tratou, false);
  assert.strictEqual(postados.length, 0);
  assert.match(r.numerosContext, /5 têm cartão recorrente cadastrado/);
  assert.match(r.numerosContext, /"cartao_cadastrado"/);
}));

test('prompt do grupo: ensina o recorte 💳 e separa da maquininha', () => {
  const p = buildGroupChatPrompt({ soulText: '', groupName: 'Administração Recreio', members: [], pool: [], history: [], senderName: 'Fefê' });
  assert.ok(p.includes('"cartao_cadastrado"'));
  assert.match(p, /cartão cadastrado mas paga PIX/i);
  assert.match(p, /"cartao_avulso" \(maquininha/);
  assert.match(p, /maquininha[^\n]*NUNCA[^\n]*💳|💳[^\n]*NUNCA[^\n]*maquininha/i);
});

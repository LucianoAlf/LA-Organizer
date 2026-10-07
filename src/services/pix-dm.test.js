'use strict';
// pix-dm.test.js — PIX automático no 1:1 (Ana Paula, DM, 05/10 19:08–19:11 BRT).
//
// O CASO. "Tiveram alguns cadastros de Pix tom. Se puder atualizar a lista pra mim, vou te dizendo
// quem já foi" -> o TOM ESCREVEU de cabeça uma lista numerada de 10 nomes tirada do contexto do
// prompt (as tarefas da pauta do grupo), sem fonte (CHOKEPOINT confab:unknown). Ela respondeu
// "3 - crédito recorrente já cadastrado / 8 - Pix recorrente já cadastrado" e o TOM emitiu
// TASK_UPDATE complete nas filhas da pauta do grupo — fechou as tarefas, mas SEM o marcador
// PIX_CADASTRO que a reconferência de 7 dias lê, e o 3 era CARTÃO (não é PIX cadastrado). Depois
// "3 tá ok / 8 tá ok" -> "Não achei nenhuma tarefa aberta… no teu nome".
//
// RAIZ: o 1:1 não tinha a lista do PIX nem o caminho do "cadastrei". Agora:
//   - a lista sai pelo MESMO marcador do grupo (<<LISTA_PIX>>), da MESMA fonte, NUMERADA, e o
//     número->cliente fica guardado;
//   - a resposta por número (ou "cadastrei <nome> no automático") vai pelo MESMO registro do
//     grupo (marcador PIX_CADASTRO + baixa da filha pendente), e cartão recebe a resposta honesta
//     (a lista lê o Emusys: a forma de pagamento muda lá).
// (Nomes de cliente fictícios; as falas da Ana são as reais.)
const { test } = require('node:test');
const assert = require('node:assert');
const dm = require('./pix-dm');
const f = require('./pix-consulta-fontes');
const { resolverUnidade } = require('./situacao-aluno');

const CG = resolverUnidade('campo grande');
const RECREIO = resolverUnidade('recreio');
const PEDIDO_REAL = 'Tiveram alguns cadastros de Pix tom . Se puder atualizar a lista pra mim , vou te dizendo quem já foi';
const RESPOSTA_REAL = '3 - crédito recorrente já cadastrado \n8 - Pix recorrente já cadastrado';
const CITACAO = '[O usuário está RESPONDENDO a esta mensagem anterior: "Beleza, Ana! Essa é a lista atual de PIX automático em aberto no grupo ADM CG:\n\n1. Joyce (Heitor)\n2. Ademir (Ryan)\n3. Thiago (Joanna)\n\n_⚠️ Na real não consegui registrar isso agora — me manda de novo, por favor._"]\n';
const OK_REAL = `${CITACAO}3 tá ok \n8 tá ok`;
const VOU_VER_REAL = `${CITACAO}Vou ver no sistema , lá pode estar pendente de atualização tbm`;

const L = (o) => ({ pagador_chave: `${CG}:${o.id}`, alunos: [], matriculas: [1], categoria: 'migrar', fatia: 'pix_avulso', forma_ultima_mensalidade: 'Pix', cobranca_automatica_cadastrada: null, dado_atualizado_em: '2026-10-05T09:00:00Z', ...o });
// CG de mentirinha, 10 na pauta: o 3º da lista (ordem de prioridade) tem CARTÃO recorrente
// cadastrado e a forma é cartão (= Thiago, cartao_com_falha); os outros são PIX/cheque.
const FONTE_CG = [
  L({ id: 1, pagador_nome: 'Ana Um', alunos: ['A1'] }),
  L({ id: 2, pagador_nome: 'Bia Dois', alunos: ['B1'] }),
  L({ id: 4, pagador_nome: 'Dora Quatro', alunos: ['D1'], fatia: 'cheque', forma_ultima_mensalidade: 'Cheque' }),
  L({ id: 5, pagador_nome: 'Eva Cinco', fatia: 'cheque', forma_ultima_mensalidade: 'Cheque' }),
  L({ id: 3, pagador_nome: 'Caio Cartao', alunos: ['C1', 'C2'], fatia: 'cartao_com_falha', forma_ultima_mensalidade: 'Cartão de Crédito', cobranca_automatica_cadastrada: 'Cartão de Crédito' }),
  L({ id: 6, pagador_nome: 'Fabio Seis', fatia: 'cartao_com_falha', forma_ultima_mensalidade: 'Cartão de Crédito' }),
  L({ id: 7, pagador_nome: 'Gil Sete', fatia: 'boleto', forma_ultima_mensalidade: 'Boleto' }),
  L({ id: 8, pagador_nome: 'Joyce Lima', alunos: ['Heitor'], fatia: 'dinheiro', forma_ultima_mensalidade: 'Dinheiro' }),
  L({ id: 9, pagador_nome: 'Ivo Nove', fatia: 'sem_historico' }),
  L({ id: 10, pagador_nome: 'Ju Dez', fatia: 'sem_historico' }),
  L({ id: 11, pagador_nome: 'Kiko Ja Foi', categoria: 'ja_migrou', fatia: null }),
];
const rpcDe = (porUnidade) => async (unidadeId) => ({ data: porUnidade[unidadeId] || [], error: null });
const semInterruptor = async (fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  delete process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  try { return await fn(); } finally { if (antes !== undefined) process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

// Memória falsa: a lista guardada e as escritas do registro.
// Pauta do dia do grupo ADM CG (o pacote aberto do ritual): 4 filhas, uma delas (Kiko) a fonte já
// mostra como migrada, e uma (Zé) sem vínculo gravado.
const PAUTA_CG = {
  pacotes: 1, datas: ['05/10'],
  filhas: [
    { id: 'f-joyce', title: 'PIX automático — Joyce Lima (Heitor)', pagador_chave: `${CG}:8` },
    { id: 'f-caio', title: 'PIX automático — Caio Cartao (C1, C2)', pagador_chave: `${CG}:3` },
    { id: 'f-ana', title: 'PIX automático — Ana Um (A1)', pagador_chave: `${CG}:1` },
    { id: 'f-kiko', title: 'PIX automático — Kiko Ja Foi', pagador_chave: `${CG}:11` },
  ],
};
function mundo({ fonte = { [CG]: FONTE_CG }, filhas = [], marcadorOk = true, fecharOk = true, pauta = { [CG]: PAUTA_CG } } = {}) {
  const w = { listas: [], marcadores: [], fechadas: [] };
  w.deps = {
    rpcPixDaUnidade: rpcDe(fonte),
    retry: (fn) => fn(),
    hoje: '2026-10-05',
    salvarNumeracao: async ({ collaboratorId, itens }) => { w.listas.push({ collaboratorId, itens }); return true; },
    carregarNumeracao: async () => (w.listas.length ? w.listas[w.listas.length - 1].itens : null),
    gruposPix: async ({ unidadeIds }) => unidadeIds.filter((u) => pauta[u]).map((u) => ({ groupId: `g-${u}`, unidadeId: u })),
    filhasPixDoGrupo: async ({ groupId }) => pauta[groupId.slice(2)] || { pacotes: 0, filhas: [] },
    gravarMarcador: async (arg) => { w.marcadores.push(arg); return marcadorOk; },
    filhasPendentesDaChave: async (chave) => filhas.filter((x) => x.chave === chave).map((x) => x.id),
    fecharFilha: async (id) => { w.fechadas.push(id); return fecharOk; },
  };
  return w;
}
const marker = (obj) => `Puxei da fonte agora 👇\n<<LISTA_PIX>>${JSON.stringify(obj)}<<END>>`;
const COMPLETA = 'me manda a lista completa do pix';
const numeroDe = (w, nome) => w.listas[0].itens.find((i) => i.nome === nome).n;

// ── gate e leitura da resposta (puro) ───────────────────────────────────────────────────────
test('gate: a fala real da Ana é assunto de PIX; conversa comum não é', () => {
  assert.strictEqual(dm.falaDePix(PEDIDO_REAL), true);
  assert.strictEqual(dm.falaDePix('cadastrei a Joyce no automático'), true);
  assert.strictEqual(dm.falaDePix('me lembra de ligar pro fornecedor amanhã'), false);
});

test('resposta por número: a fala real "3 - crédito recorrente… / 8 - Pix recorrente…" vira 3=cartão e 8=pix', () => {
  assert.deepStrictEqual(dm.lerRespostaPorNumero(RESPOSTA_REAL, { tamanho: 10 }),
    [{ numero: 3, forma: 'cartao' }, { numero: 8, forma: 'pix' }]);
});

test('resposta por número: "3 tá ok / 8 tá ok" citando a lista vira os dois sem forma dita', () => {
  assert.deepStrictEqual(dm.lerRespostaPorNumero(OK_REAL, { tamanho: 10 }),
    [{ numero: 3, forma: null }, { numero: 8, forma: null }]);
  assert.deepStrictEqual(dm.lerRespostaPorNumero('o 3 e o 8 já foram', { tamanho: 10 }),
    [{ numero: 3, forma: null }, { numero: 8, forma: null }]);
});

test('resposta por número: o que NÃO é aviso de cadastro não vira escrita', () => {
  for (const t of [VOU_VER_REAL, PEDIDO_REAL, 'o 3 ainda não foi', 'o 3 já foi?', 'acho que o 3 foi',
    'o 12 já foi', 'manda mensagem pro 3, o pai já pagou', 'às 12:00 o 3 tá ok']) {
    assert.strictEqual(dm.lerRespostaPorNumero(t, { tamanho: 10 }), null, t);
  }
});

// ── a lista no 1:1 ──────────────────────────────────────────────────────────────────────────
test('lista no 1:1: o marcador vira a lista NUMERADA da fonte, com os MESMOS nomes e ordem do grupo', () => semInterruptor(async () => {
  const w = mundo();
  const r = await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix' }), unidadeIds: [CG], collaboratorId: 'ana', textoDoUsuario: COMPLETA, deps: w.deps });
  assert.strictEqual(r.atendidos, 1);
  assert.ok(!/<<LISTA_PIX>>/.test(r.reply));
  const grupo = (await f.blocosDaLista({ unidadeId: CG, alvo: 'pix', deps: { rpcPix: () => w.deps.rpcPixDaUnidade(CG), retry: (fn) => fn(), hoje: '2026-10-05' } })).blocos[0];
  assert.deepStrictEqual(w.listas[0].itens.map((i) => i.nome), grupo.itens.map((i) => i.pagador));
  assert.deepStrictEqual(w.listas[0].itens.map((i) => i.n), grupo.itens.map((_, k) => k + 1));
  assert.match(r.reply, /💠 \*PIX automático — quem falta migrar — Campo Grande\* \(10 clientes\)/);
  for (const it of w.listas[0].itens) assert.ok(r.reply.includes(`   ${it.n}. ${it.nome}`), `${it.n}. ${it.nome}`);
  assert.ok(r.reply.includes(`   ${numeroDe(w, 'Caio Cartao')}. Caio Cartao (C1, C2)`), 'família com os filhos');
  assert.ok(!r.reply.includes(CG), 'a chave do cliente nunca sai no texto');
  assert.ok(!r.reply.includes('Kiko Ja Foi'));
  assert.match(r.reply, /responde com o número/i);
  assert.strictEqual(w.listas[0].collaboratorId, 'ana');
  assert.strictEqual(w.listas[0].itens[0].chave.startsWith(`${CG}:`), true);
}));

test('lista no 1:1: unidade dita vence as da pessoa; sem nenhuma, as unidades da pessoa em sequência', () => semInterruptor(async () => {
  const w = mundo({ fonte: { [CG]: FONTE_CG, [RECREIO]: [L({ id: 99, pagador_chave: `${RECREIO}:99`, pagador_nome: 'Rui Recreio' })] } });
  const r = await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix', unidade: 'recreio' }), unidadeIds: [CG], collaboratorId: 'ana', textoDoUsuario: COMPLETA, deps: w.deps });
  assert.match(r.reply, /Recreio\* \(1 clientes\)/);
  assert.ok(!r.reply.includes('Ana Um'));
  const r2 = await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix' }), unidadeIds: [CG, RECREIO], collaboratorId: 'ana', textoDoUsuario: COMPLETA, deps: w.deps });
  const tudo2 = [r2.reply, ...r2.extras].join('\n\n');
  assert.strictEqual(r2.extras.length, 1, 'cada unidade na sua mensagem, como no grupo');
  assert.ok(tudo2.indexOf('Campo Grande') < tudo2.indexOf('Recreio'));
  assert.ok(tudo2.includes('   11. Rui Recreio'), 'numeração continua de uma unidade pra outra');
}));

test('lista no 1:1: fonte fora -> linha honesta, nenhuma lista guardada, nenhum nome inventado', async () => {
  const w = mundo();
  w.deps.rpcPixDaUnidade = async () => ({ data: null, error: { message: 'timeout' } });
  const r = await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix' }), unidadeIds: [CG], collaboratorId: 'ana', textoDoUsuario: COMPLETA, deps: w.deps });
  assert.strictEqual(r.falhas, 1);
  assert.match(r.reply, /não consegui ler/i);
  assert.strictEqual(w.listas.length, 0);
});

// ── PADRÃO DO 1:1 = A PAUTA DO DIA (coordenação 07/10) ──────────────────────────────────────
// "Atualiza a lista" (a fala real da Ana) é a pauta do PIX do grupo dela — as filhas pendentes do
// pacote do ritual, a MESMA que o grupo recebe —, não os 178 da unidade. A lista inteira só quando
// a pessoa pede "lista completa/toda/inteira".
test('Ana 05/10: "atualiza a lista" manda a PAUTA do dia do grupo, numerada — não a unidade inteira', () => semInterruptor(async () => {
  const w = mundo();
  const r = await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix' }), unidadeIds: [CG], collaboratorId: 'ana', textoDoUsuario: PEDIDO_REAL, deps: w.deps });
  assert.match(r.reply, /💠 \*PIX automático — pauta de 05\/10 — Campo Grande\* \(4 clientes\)/);
  const nomes = w.listas[0].itens.map((i) => i.nome);
  assert.deepStrictEqual([...nomes].sort(), ['Ana Um', 'Caio Cartao', 'Joyce Lima', 'Kiko Ja Foi']);
  for (const it of w.listas[0].itens) assert.ok(r.reply.includes(`   ${it.n}. ${it.nome}`), `${it.n}. ${it.nome}`);
  assert.deepStrictEqual(w.listas[0].itens.map((i) => i.n), [1, 2, 3, 4]);
  for (const fora of ['Bia Dois', 'Dora Quatro', 'Ivo Nove']) assert.ok(!r.reply.includes(fora), `${fora} não está na pauta`);
  // organizada como a lista do grupo: forma de pagamento da fonte, quem a fonte já mostra migrado à parte
  assert.match(r.reply, /🔴 \*Pix avulso\* \(1\)\n   \d+\. Ana Um \(A1\)/);
  assert.match(r.reply, /✅ \*Já aparece como migrado no Emusys\* \(1\)[^\n]*\n   4\. Kiko Ja Foi/);
  assert.match(r.reply, /✅ \*1 de 11 já migraram\* · faltam 10/, 'mesmo resumo da lista do grupo');
  assert.match(r.reply, /lista completa/i, 'diz como pedir a unidade inteira');
  assert.deepStrictEqual(r.extras, []);
  // o número da pauta resolve pro cliente certo no turno seguinte (Joyce = PIX -> registro)
  const nJoyce = numeroDe(w, 'Joyce Lima');
  const res = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: `${nJoyce} - Pix recorrente já cadastrado`, unidadeIds: [CG], deps: { ...w.deps, filhasPendentesDaChave: async () => ['f-joyce'] } });
  assert.strictEqual(res.gravou, true);
  assert.deepStrictEqual(w.fechadas, ['f-joyce']);
}));

test('pauta: grupo sem pacote aberto -> diz isso e oferece a lista completa; nada guardado, nome nenhum', () => semInterruptor(async () => {
  const w = mundo({ pauta: {} });
  const r = await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix' }), unidadeIds: [CG], collaboratorId: 'ana', textoDoUsuario: PEDIDO_REAL, deps: w.deps });
  assert.match(r.reply, /não tem pauta do PIX aberta/i);
  assert.match(r.reply, /lista completa/i);
  assert.strictEqual(w.listas.length, 0);
  assert.ok(!r.reply.includes('Ana Um'));
}));

test('pedido explícito ("lista completa/toda/inteira") manda a unidade inteira; recorte nomeado também', () => {
  for (const t of ['me manda a lista completa do pix', 'quero a lista inteira', 'manda toda a lista do pix']) assert.strictEqual(dm.pedeListaCompleta(t), true, t);
  for (const t of [PEDIDO_REAL, 'atualiza a lista do pix', 'quem falta hoje?']) assert.strictEqual(dm.pedeListaCompleta(t), false, t);
});

test('lista completa grande: sai em PARTES do tamanho do grupo, numeração contínua entre as partes', () => semInterruptor(async () => {
  const muitos = Array.from({ length: 100 }, (_, i) => L({ id: 1000 + i, pagador_nome: `Cliente ${String(i + 1).padStart(3, '0')}` }));
  const w = mundo({ fonte: { [CG]: muitos } });
  const r = await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix' }), unidadeIds: [CG], collaboratorId: 'ana', textoDoUsuario: COMPLETA, deps: w.deps });
  const partes = [r.reply, ...r.extras];
  const porParte = require('./pix-consulta').LIMITE_POR_MENSAGEM;
  assert.strictEqual(partes.length, Math.ceil(100 / porParte));
  assert.match(partes[0], /— parte 1\/3/);
  assert.match(partes[1], new RegExp(`— parte 2/3[\\s\\S]*\\n   ${porParte + 1}\\. Cliente`));
  assert.match(partes[2], /\n   100\. Cliente 100/);
  assert.match(partes[2], /responde com o número/i, 'o rodapé vai na ÚLTIMA parte');
  assert.strictEqual(w.listas[0].itens.length, 100);
}));

// ── a numeração guardada (um módulo só, troca de casa sem mexer em quem chama) ────────────────
test('numeração: salvar e carregar devolvem a mesma lista (n, chave, nome)', async () => {
  const num = require('./pix-dm-numeracao');
  const linhas = [];
  const fake = {
    from: () => ({
      insert: async (row) => { linhas.push({ ...row, created_at: new Date().toISOString() }); return { error: null }; },
      select: () => {
        const q = { eq: () => q, gte: () => q, order: () => q, limit: () => q,
          maybeSingle: async () => ({ data: linhas[linhas.length - 1] || null, error: null }) };
        return q;
      },
    }),
  };
  const itens = [{ n: 1, chave: `${CG}:8`, nome: 'Joyce Lima' }, { n: 2, chave: null, nome: 'Zé Sem Vínculo' }];
  assert.strictEqual(await num.salvarNumeracao({ supabase: fake, collaboratorId: 'ana', itens }), true);
  assert.deepStrictEqual(await num.carregarNumeracao({ supabase: fake, collaboratorId: 'ana', desdeIso: '2026-10-05T00:00:00Z' }), itens);
});

// ── a resposta por número (o turno seguinte) ────────────────────────────────────────────────
async function comLista(w) {
  await dm.atenderMarkersListaPixDM({ reply: marker({ alvo: 'pix' }), unidadeIds: [CG], collaboratorId: 'ana', textoDoUsuario: COMPLETA, deps: w.deps });
  return w.listas[0].itens;
}

test('05/10 real: "3 - crédito recorrente / 8 - Pix recorrente" -> o PIX é registrado igual ao grupo; o cartão recebe a resposta honesta', () => semInterruptor(async () => {
  const w = mundo({ filhas: [{ id: 'filha-joyce', chave: `${CG}:8` }] });
  const itens = await comLista(w);
  const n3 = itens.find((i) => i.nome === 'Caio Cartao').n;
  const n8 = itens.find((i) => i.nome === 'Joyce Lima').n;
  const r = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: `${n3} - crédito recorrente já cadastrado \n${n8} - Pix recorrente já cadastrado`, unidadeIds: [CG], deps: w.deps });
  assert.strictEqual(r.gravou, true);
  assert.deepStrictEqual(w.marcadores, [{ collaboratorId: 'ana', pagadorChave: `${CG}:8` }], 'só o PIX vira registro');
  assert.deepStrictEqual(w.fechadas, ['filha-joyce'], 'a filha da pauta do grupo sai igual ao "cadastrei" do grupo');
  const t = r.linhas.join('\n');
  assert.match(t, new RegExp(`${n8}\\. Joyce Lima.*anotei no PIX automático`, 'i'));
  assert.match(t, new RegExp(`${n3}\\. Caio Cartao.*cartão`, 'i'));
  assert.match(t, /Emusys/);
  assert.ok(!new RegExp(`${n3}\\. Caio Cartao[^\\n]*(anotei|marquei)`, 'i').test(t), 'cartão nunca é "anotado/marcado"');
}));

test('"3 tá ok" sem dizer a forma: a FONTE decide — cartão recorrente cadastrado vai pra resposta do cartão', () => semInterruptor(async () => {
  const w = mundo();
  const itens = await comLista(w);
  const n3 = itens.find((i) => i.nome === 'Caio Cartao').n;
  const n1 = itens.find((i) => i.nome === 'Ana Um').n;
  const r = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: `${CITACAO}${n3} tá ok \n${n1} tá ok`, unidadeIds: [CG], deps: w.deps });
  assert.deepStrictEqual(w.marcadores.map((m) => m.pagadorChave), [`${CG}:1`]);
  assert.match(r.linhas.join('\n'), new RegExp(`${n3}\\. Caio Cartao.*cartão`, 'i'));
}));

test('quem a fonte já mostra como migrado (ou fora da lista) não é registrado de novo', () => semInterruptor(async () => {
  const w = mundo();
  const itens = await comLista(w);
  const n8 = itens.find((i) => i.nome === 'Joyce Lima').n;
  // entre a lista e a resposta, o Emusys já atualizou a Joyce
  w.deps.rpcPixDaUnidade = rpcDe({ [CG]: FONTE_CG.map((l) => (l.pagador_nome === 'Joyce Lima' ? { ...l, categoria: 'ja_migrou' } : l)) });
  const r = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: `${n8} - Pix recorrente já cadastrado`, unidadeIds: [CG], deps: w.deps });
  assert.strictEqual(w.marcadores.length, 0);
  assert.strictEqual(r.gravou, false);
  assert.match(r.linhas.join('\n'), /já aparece como migrad/i);
}));

test('registro falhou: diz que não registrou e não marca nada como feito', () => semInterruptor(async () => {
  const w = mundo({ marcadorOk: false, filhas: [{ id: 'filha-joyce', chave: `${CG}:8` }] });
  const itens = await comLista(w);
  const n8 = itens.find((i) => i.nome === 'Joyce Lima').n;
  const r = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: `${n8} já foi`, unidadeIds: [CG], deps: w.deps });
  assert.strictEqual(r.gravou, false);
  assert.deepStrictEqual(w.fechadas, [], 'sem marcador, a filha não é baixada (mesma ordem do grupo)');
  assert.match(r.linhas.join('\n'), /não consegui registrar/i);
}));

test('sem lista recente no 1:1, número solto não é adivinhado (segue pro fluxo normal)', async () => {
  const w = mundo();
  const r = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: RESPOSTA_REAL, unidadeIds: [CG], deps: w.deps });
  assert.strictEqual(r, null);
  assert.strictEqual(w.marcadores.length, 0);
});

test('"cadastrei a Joyce no automático" no 1:1 usa o MESMO registro do grupo, casando pela fonte', () => semInterruptor(async () => {
  const w = mundo({ filhas: [{ id: 'filha-joyce', chave: `${CG}:8` }] });
  const r = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: 'cadastrei a Joyce no automático', unidadeIds: [CG], deps: w.deps });
  assert.strictEqual(r.gravou, true);
  assert.deepStrictEqual(w.marcadores, [{ collaboratorId: 'ana', pagadorChave: `${CG}:8` }]);
  assert.deepStrictEqual(w.fechadas, ['filha-joyce']);
  const amb = await dm.resolverPixDoTurno({ collaboratorId: 'ana', text: 'cadastrei o Kiko no automático', unidadeIds: [CG], deps: w.deps });
  assert.match(amb.linhas.join('\n'), /já aparece como migrad/i);
}));

// ── a rede: tarefa do PIX não se fecha na mão pelo TASK_UPDATE ───────────────────────────────
test('TASK_UPDATE complete em "PIX automático — …" (o marcador real de 05/10) sai do texto', () => {
  const real = 'Fechando os itens 3 e 8.\n<<TASK_UPDATE>>{"actions":[{"action":"complete","title":"PIX automático — Thiago Luiz dos Santos Souto"},{"action":"complete","title":"PIX automático — Ricardo de Lima Agostinho"}]}<<END>>';
  const r = dm.tirarConclusaoDePix(real);
  assert.strictEqual(r.tirados, 2);
  assert.ok(!/<<TASK_UPDATE>>/.test(r.reply));
  const misto = '<<TASK_UPDATE>>{"actions":[{"action":"complete","title":"PIX automático — X"},{"action":"complete","title":"Comprar café"}]}<<END>>';
  const r2 = dm.tirarConclusaoDePix(misto);
  assert.strictEqual(r2.tirados, 1);
  assert.match(r2.reply, /Comprar café/);
  assert.ok(!/PIX automático — X/.test(r2.reply));
  assert.deepStrictEqual(dm.tirarConclusaoDePix('nada aqui'), { reply: 'nada aqui', tirados: 0 });
});

test('bloco do prompt: o 1:1 pede a lista pelo marcador e nunca escreve nome nem fecha tarefa do PIX', () => {
  const b = dm.blocoPixDM({ porUnidade: [] });
  assert.match(b, /<<LISTA_PIX>>/);
  assert.match(b, /NUNCA escreva os nomes/);
  assert.match(b, /TASK_UPDATE/);
});

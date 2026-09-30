'use strict';
// lista-alunos-organizada.test.js — as listas de ANAMNESE e CONTRATO pedidas no grupo saem
// ORGANIZADAS (Arthur, Barra, 30/09 16:23).
//
// O CASO: a lista de contrato chegou como 56 linhas corridas "• Nome — Nome" (responsável —
// aluno, repetido quando é a mesma pessoa: na Barra 55 de 56 têm responsavel_nome = o próprio
// aluno). Ordem do dono (permanente): toda resposta do TOM no WhatsApp vem título → resumo →
// seções com contagem → nomes recuados, nunca parede. A lista do PIX já saía assim desde 28/09;
// anamnese e contrato caíam no formato plano porque os itens não tinham `secao`.
//
// Seções: 🧒 Crianças (LAMK, ≤11 anos — a MESMA regra dos cards de situacao-aluno.js) e 🎓 Adultos.
// No contrato, quando a fonte separa "não assinado" de "sem contrato no Emusys", a seção separa
// também. "(responsável: X)" só quando o responsável é OUTRA pessoa.
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('./pix-consulta');
const f = require('./pix-consulta-fontes');
const situ = require('./situacao-aluno');
const { buildWhatsappText } = require('./group-chat-bridge-out');
// O card sai pro WhatsApp pelo MESMO caminho da produção: mensagem kind='report' do TOM.
const htmlToWhatsapp = (html) => buildWhatsappText({ role: 'tom', kind: 'report', content: html }, '');

// Forma REAL da linha de get_situacao_alunos_v1 (campos medidos na Barra em 30/09).
const P = (nome, o = {}) => ({
  pessoa_chave: `k-${nome}`, nome, classificacao: 'EMLA', responsavel_nome: nome, tem_responsavel: false,
  anamnese_preenchida: true, anamnese_flag_sem_registro: false, contrato_assinatura_status: 'assinado',
  contrato_dado_fresco: true, tem_foto: true, tem_telefone: true, tem_instagram: true, comunidade_status: 'na_comunidade',
  ...o,
});
const kid = (nome, o = {}) => P(nome, { classificacao: 'LAMK', ...o });
const semRetry = (fn) => fn();
const ok = (data) => async () => ({ data, error: null });

const BASE = [
  kid('Bruna Kid', { anamnese_preenchida: false, contrato_assinatura_status: 'nao_assinado', responsavel_nome: 'Carla Mãe', tem_responsavel: true }),
  kid('Alice Kid', { anamnese_preenchida: false, contrato_assinatura_status: 'nao_assinado' }),
  P('Zeca Adulto', { anamnese_preenchida: false, contrato_assinatura_status: 'nao_assinado' }),
  P('Dani Adulta', { contrato_assinatura_status: 'sem_contrato' }),
  P('Edu Ok'),
  P('Fabi Conferir', { contrato_assinatura_status: 'nao_verificado', contrato_dado_fresco: false }),
];

// ── pura: listaDeAlunosOrganizada ─────────────────────────────────────────────────────────────
test('anamnese: seções Crianças/Adultos com contagem, responsável só quando é outra pessoa, resumo no topo', () => {
  const { itens, resumo } = c.listaDeAlunosOrganizada({ recorte: 'anamnese', pessoas: BASE });
  assert.strictEqual(resumo, '📋 *3 de 6 alunos ativos sem anamnese*');
  assert.deepStrictEqual(itens.map((i) => [i.pagador, i.detalhe || null, i.secao]), [
    ['Alice Kid', null, '🧒 *Crianças* (2) — quem resolve é o responsável'],
    ['Bruna Kid', 'responsável: Carla Mãe', '🧒 *Crianças* (2) — quem resolve é o responsável'],
    ['Zeca Adulto', null, '🎓 *Adultos* (1)'],
  ]);
  for (const i of itens) assert.deepStrictEqual(i.alunos, [], 'o aluno não se repete ao lado dele mesmo');
});

test('contrato: separa "não assinado" de "sem contrato no Emusys" quando a fonte distingue; não verificado vira linha do resumo, não cobrança', () => {
  const { itens, resumo } = c.listaDeAlunosOrganizada({ recorte: 'contrato', pessoas: BASE });
  assert.strictEqual(resumo, [
    '📋 *4 de 6 alunos ativos sem contrato assinado*',
    '❔ 1 não deu pra conferir hoje — fica fora da lista (conferir no Emusys antes de cobrar)',
  ].join('\n'));
  assert.deepStrictEqual(itens.map((i) => [i.pagador, i.secao]), [
    ['Alice Kid', '🧒 *Crianças · não assinado* (2) — quem resolve é o responsável'],
    ['Bruna Kid', '🧒 *Crianças · não assinado* (2) — quem resolve é o responsável'],
    ['Zeca Adulto', '🎓 *Adultos · não assinado* (1)'],
    ['Dani Adulta', '🎓 *Adultos · sem contrato no Emusys* (1)'],
  ]);
});

test('contrato com um status só: a seção não carrega o status (não polui)', () => {
  const soNaoAssinado = BASE.filter((p) => p.contrato_assinatura_status !== 'sem_contrato' && p.contrato_assinatura_status !== 'nao_verificado');
  const { itens, resumo } = c.listaDeAlunosOrganizada({ recorte: 'contrato', pessoas: soNaoAssinado });
  assert.strictEqual(resumo, '📋 *3 de 4 alunos ativos sem contrato assinado*');
  assert.deepStrictEqual([...new Set(itens.map((i) => i.secao))], ['🧒 *Crianças* (2) — quem resolve é o responsável', '🎓 *Adultos* (1)']);
});

test('contrato sem a conferência de hoje: o resumo DIZ que não rodou (vazio por falha ≠ vazio por saúde)', () => {
  const velho = BASE.map((p) => ({ ...p, contrato_dado_fresco: false }));
  const { itens, resumo } = c.listaDeAlunosOrganizada({ recorte: 'contrato', pessoas: velho });
  assert.strictEqual(itens.length, 0);
  assert.match(resumo, /⚠️ \*A conferência de contrato de hoje não rodou\*/);
});

// ── a mensagem inteira no grupo (fonte → WhatsApp) ────────────────────────────────────────────
const deps = { rpcSituacao: ok(BASE), rpcPix: async () => { throw new Error('não é PIX'); }, retry: semRetry };

test('contrato no grupo: título → resumo → seções com linha em branco → nomes recuados; nunca "Nome — Nome"', async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: situ.resolverUnidade('barra'), unidadeNome: 'Barra', alvos: ['contrato'], deps });
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.msgs.length, 1);
  assert.strictEqual(r.msgs[0], [
    '💠 *Contrato — quem falta assinar — Barra* (4 alunos) — parte 1/1',
    '📋 *4 de 6 alunos ativos sem contrato assinado*',
    '❔ 1 não deu pra conferir hoje — fica fora da lista (conferir no Emusys antes de cobrar)',
    '',
    '🧒 *Crianças · não assinado* (2) — quem resolve é o responsável',
    '   • Alice Kid',
    '   • Bruna Kid (responsável: Carla Mãe)',
    '',
    '🎓 *Adultos · não assinado* (1)',
    '   • Zeca Adulto',
    '',
    '🎓 *Adultos · sem contrato no Emusys* (1)',
    '   • Dani Adulta',
  ].join('\n'));
  assert.doesNotMatch(r.msgs[0], /^• /m, 'nenhuma linha plana');
});

test('lista vazia de contrato sem conferência: o aviso do resumo sai junto do "ninguém"', async () => {
  const velho = BASE.map((p) => ({ ...p, contrato_dado_fresco: false }));
  const r = await f.mensagensDaListaPix({ unidadeId: situ.resolverUnidade('barra'), unidadeNome: 'Barra', alvos: ['contrato'], deps: { ...deps, rpcSituacao: ok(velho) } });
  assert.strictEqual(r.msgs.length, 1);
  assert.match(r.msgs[0], /\(0 alunos\) — parte 1\/1\n📋 [^\n]*\n⚠️ \*A conferência de contrato de hoje não rodou\*[^\n]*\nNinguém nesta lista agora\.$/);
});

test('anamnese grande: quebra em partes, resumo só na 1ª, seção repetida com (continuação), teto de mensagens mantido', async () => {
  const muitos = [
    ...Array.from({ length: 30 }, (_, i) => kid(`Kid ${String(i).padStart(2, '0')}`, { anamnese_preenchida: false })),
    ...Array.from({ length: 30 }, (_, i) => P(`Adu ${String(i).padStart(2, '0')}`, { anamnese_preenchida: false })),
  ];
  const r = await f.mensagensDaListaPix({ unidadeId: situ.resolverUnidade('barra'), unidadeNome: 'Barra', alvos: ['anamnese'], deps: { ...deps, rpcSituacao: ok(muitos) } });
  assert.strictEqual(r.msgs.length, 2);
  assert.match(r.msgs[0], /^💠 \*Anamnese — quem falta preencher — Barra\* \(60 alunos\) — parte 1\/2\n📋 \*60 de 60 alunos ativos sem anamnese\*\n\n🧒 \*Crianças\* \(30\)/);
  assert.match(r.msgs[1], /^💠 \*Anamnese — quem falta preencher — Barra\* \(60 alunos\) — parte 2\/2\n🎓 \*Adultos\* \(30\) _\(continuação\)_\n   • Adu 15/);
  assert.ok(!/📋/.test(r.msgs[1]));
});

test('itensDaLista (API pública) de anamnese/contrato continua só com pagador+alunos', async () => {
  for (const alvo of ['anamnese', 'contrato']) {
    for (const x of await f.itensDaLista({ unidadeId: 'u1', alvo, deps })) assert.deepStrictEqual(Object.keys(x).sort(), ['alunos', 'pagador']);
  }
});

// ── o card <<SITUACAO_ALUNO>> (renderLista) espelhado no WhatsApp ─────────────────────────────
test('card de lista no WhatsApp: seções Crianças/Adultos com contagem da lista toda, nomes recuados, linha em branco entre seções', () => {
  const pend = situ.filtrarPorRecorte(BASE, 'anamnese');
  const html = situ.renderLista({ recorte: 'anamnese', pessoas: pend, total: pend.length, unidadeNome: 'Barra' });
  assert.strictEqual(htmlToWhatsapp(html), [
    '*👥 Barra*',
    '*3* sem anamnese:',
    '',
    '🧒 *Crianças* (2)',
    '   • Alice Kid',
    '   • Bruna Kid',
    '',
    '🎓 *Adultos* (1)',
    '   • Zeca Adulto',
  ].join('\n'));
});

test('card paginado: a página 2 repete a seção com (continuação) e mantém o rodapé do que sobrou', () => {
  const muitos = [
    ...Array.from({ length: 20 }, (_, i) => kid(`Kid ${String(i).padStart(2, '0')}`)),
    ...Array.from({ length: 40 }, (_, i) => P(`Adu ${String(i).padStart(2, '0')}`)),
  ];
  const w = htmlToWhatsapp(situ.renderLista({ recorte: 'foto', pessoas: muitos, total: 60, pagina: 1, unidadeNome: 'Barra' }));
  assert.match(w, /\n🧒 \*Crianças\* \(20\) _\(continuação\)_\n   • Kid 15\n/);
  assert.match(w, /   • Kid 19\n\n🎓 \*Adultos\* \(40\)\n   • Adu 00\n/);
  assert.match(w, /…e mais \*15\*/);
});

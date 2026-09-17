'use strict';
// pix-consulta.test.js — camada PURA da consulta de lista/números nos grupos.
// Caso real (Alf, 17/09): Campo Grande pediu no grupo a lista completa do PIX avulso e o TOM
// respondeu "consigo mandar só os que estão aparecendo aqui na lista de hoje". Estes testes
// prendem o contrário: a fala é reconhecida, o alvo é o certo, e a lista sai quebrada em partes.
//
// FIX ROUND 1 (C1/C3/I4/I5): interceptar exige TOKEN DE ASSUNTO explícito na fala; palavra de
// fatia sozinha (cheque, boleto, maquininha…) nunca basta; fala com forma de aviso de cadastro
// faz o interceptador se calar; anamnese/contrato declaram o recorte no bloco de números.
//
// C4 (17/09): grupo sem unidade amarrada ("PIX AUTOMÁTICO L.A.") ganha capacidade plena —
// `detectarUnidade` acha uma unidade citada na fala, e `blocoDeNumerosTodasUnidades` fala das
// três juntas + TOTAL quando nenhuma unidade é citada.
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('./pix-consulta');

// ── C1: TOKEN DE ASSUNTO OBRIGATÓRIO ──────────────────────────────────────────────────────────
// As três falas abaixo foram VERIFICADAS sequestrando o interceptador antes deste fix.
test('C1 sequestro 1: "quem falta pagar o boleto da excursão" NÃO é pedido nosso', () => {
  assert.strictEqual(c.detectarPedido('quem falta pagar o boleto da excursão da semana que vem?'), null);
  assert.strictEqual(c.precisaDeNumeros('quem falta pagar o boleto da excursão da semana que vem?'), false);
});

test('C1 sequestro 2: "me passa os nomes de quem falta pagar o cheque da rifa" NÃO é pedido nosso', () => {
  const fala = 'me passa os nomes de quem falta pagar o cheque da rifa do coral';
  assert.strictEqual(c.detectarPedido(fala), null);
  assert.strictEqual(c.precisaDeNumeros(fala), false);
});

test('C1 sequestro 3: fala com FORMA de aviso de cadastro cala o interceptador, mesmo refutada por negação', () => {
  // Esta fala tem "automático" (token de assunto) E "nome" (marcador de lista) — sem a trava do
  // atalho de cadastro ela postaria a lista inteira do PIX no meio de um aviso da equipe.
  assert.strictEqual(c.detectarPedido('cadastrei o fulano no automático mas não achei o nome dele'), null);
});

test('C1: fala de cadastro reconhecida pelo atalho também cala o interceptador', () => {
  assert.strictEqual(c.detectarPedido('cadastrei a Ana Lima no pix automático'), null);
  assert.strictEqual(c.detectarPedido('coloquei o Bruno no automático'), null);
});

test('I5: quase-cadastros (dúvida/negação) não viram pedido de lista nem leitura de fonte', () => {
  // Todas têm token de assunto E marcador de lista ("nome"/"lista") — sem a trava do atalho de
  // cadastro, cada uma destas postaria a lista inteira do PIX por cima do aviso da equipe.
  for (const fala of [
    'acho que cadastrei a Ana no automático, confere o nome dela?',
    'não cadastrei a Carla no automático, o nome não aparece',
    'será que passei o Davi no automático? o nome sumiu da lista',
    'migrei a Elisa no automático mas não achei a lista dela',
  ]) {
    assert.strictEqual(c.detectarPedido(fala), null, fala);
  }
});

test('C1: a trava do cadastro tem a MESMA fronteira do atalho — frase longa volta a ser pedido', () => {
  // O atalho de cadastro só olha fala curta (≤12 palavras); acima disso é conversa, e ele próprio
  // se recusa. A trava tem que respeitar a mesma fronteira, senão um pedido explícito de lista
  // com um "cadastrei" no meio ficaria sem resposta — o defeito que esta feature veio curar.
  const longa = 'cadastrei a Ana no automático ontem de manhã e agora quero a lista completa do pix avulso pra conferir';
  assert.ok(longa.split(/\s+/).length > 12);
  assert.deepStrictEqual(c.detectarPedido(longa), { tipo: 'lista', alvo: 'pix_avulso' });
});

test('C1: palavra de FATIA sozinha nunca basta — só escolhe a fatia quando há token de assunto', () => {
  assert.strictEqual(c.detectarPedido('quantos clientes de cheque a gente tem?'), null);
  assert.strictEqual(c.detectarPedido('me manda a lista de quem paga em dinheiro'), null);
  assert.strictEqual(c.detectarPedido('lista completa da maquininha'), null);
  // com o assunto na fala, a MESMA fatia volta a valer
  assert.deepStrictEqual(c.detectarPedido('quantos clientes de cheque tem no pix?'), { tipo: 'numeros', alvo: 'cheque' });
});

test('C1: sem token de assunto, marcador forte de lista também não intercepta', () => {
  assert.strictEqual(c.detectarPedido('manda o resto dos nomes'), null);
  assert.strictEqual(c.detectarPedido('quem falta?'), null);
  assert.strictEqual(c.detectarPedido('me manda a lista completa'), null);
});

// ── "migrar" também é assunto (follow-up do C1) ───────────────────────────────────────────────
// O verbo é específico o bastante nestes grupos, mas SOZINHO é ambíguo ("vou migrar o cadastro
// do aluno pro app"). Por isso ele vale como assunto, e a leitura da fonte só abre quando a fala
// TAMBÉM pede lista ou quantidade — os outros portões do C1 continuam de pé.
test('migrar: "quantos faltam pra migrar?" traz os números, sem interceptar', () => {
  assert.deepStrictEqual(c.detectarPedido('quantos faltam pra migrar?'), { tipo: 'numeros', alvo: 'pix' });
  assert.strictEqual(c.precisaDeNumeros('quantos faltam pra migrar?'), true);
});

test('migrar: "me manda a lista de quem falta migrar" intercepta como lista do PIX', () => {
  assert.deepStrictEqual(c.detectarPedido('me manda a lista de quem falta migrar'), { tipo: 'lista', alvo: 'pix' });
  assert.strictEqual(c.precisaDeNumeros('me manda a lista de quem falta migrar'), true);
});

test('migrar: uso do verbo em OUTRO assunto não intercepta e não lê a fonte', () => {
  assert.strictEqual(c.detectarPedido('vou migrar o cadastro do aluno pro app'), null);
  assert.strictEqual(c.precisaDeNumeros('vou migrar o cadastro do aluno pro app'), false);
});

test('migrar: as outras formas também valem, e "migração" (substantivo) segue forte sozinha', () => {
  assert.strictEqual((c.detectarPedido('quantos ainda não migrado?') || {}).alvo, 'pix');
  // "migrados" já era recorte de categoria e continua sendo — o token novo não atropela isso
  assert.strictEqual((c.detectarPedido('quantos migrados?') || {}).alvo, 'ja_migrou');
  // substantivo: abre a leitura mesmo sem marcador de quantidade/lista (fala de status)
  assert.strictEqual(c.precisaDeNumeros('como tá a migração?'), true);
  assert.strictEqual(c.precisaDeNumeros('a migração vai bem'), true);
});

// ── as falas legítimas continuam funcionando ──────────────────────────────────────────────────
test('frase real do caso: "me manda a lista completa do pix avulso" -> lista de pix_avulso', () => {
  assert.deepStrictEqual(c.detectarPedido('me manda a lista completa do pix avulso'),
    { tipo: 'lista', alvo: 'pix_avulso' });
});

test('"lista do pix de cheque" -> lista da fatia cheque', () => {
  assert.deepStrictEqual(c.detectarPedido('lista do pix de cheque'), { tipo: 'lista', alvo: 'cheque' });
});

test('"manda o resto dos nomes do pix" -> lista do pix', () => {
  assert.deepStrictEqual(c.detectarPedido('manda o resto dos nomes do pix'), { tipo: 'lista', alvo: 'pix' });
});

test('"lista da anamnese" -> lista de anamnese', () => {
  assert.deepStrictEqual(c.detectarPedido('lista da anamnese'), { tipo: 'lista', alvo: 'anamnese' });
});

test('"quantos faltam de contrato?" -> números de contrato', () => {
  assert.deepStrictEqual(c.detectarPedido('quantos faltam de contrato?'), { tipo: 'numeros', alvo: 'contrato' });
});

test('"bom dia" -> null (o LLM atende normal)', () => {
  assert.strictEqual(c.detectarPedido('bom dia'), null);
  assert.strictEqual(c.detectarPedido(''), null);
  assert.strictEqual(c.detectarPedido(null), null);
});

test('citar o assunto sem pedir nada não vira pedido: "o pix automático tá indo bem" -> null', () => {
  assert.strictEqual(c.detectarPedido('o pix automatico ta indo bem'), null);
});

test('cada fatia tem o seu alvo quando o assunto está na fala, e "maquininha" não vira pix_avulso', () => {
  const alvo = (t) => (c.detectarPedido(t) || {}).alvo;
  assert.strictEqual(alvo('quantos de boleto no pix?'), 'boleto');
  assert.strictEqual(alvo('quantos pagam em dinheiro no pix?'), 'dinheiro');
  assert.strictEqual(alvo('lista do pix de cartão falhando'), 'cartao_com_falha');
  assert.strictEqual(alvo('lista do pix da maquininha'), 'cartao_avulso');
  // "cartão avulso" contém "avulso": sem a precedência, casaria pix_avulso também e o alvo
  // desandava pra 'pix' (lista errada no grupo).
  assert.strictEqual(alvo('lista do pix de cartão avulso'), 'cartao_avulso');
  assert.strictEqual(alvo('quantos sem histórico no pix?'), 'sem_historico');
  assert.strictEqual(alvo('quantos cadastrados sem cobrança no pix?'), 'autorizacao_pendente');
  assert.strictEqual(alvo('quantos já migraram no pix automático?'), 'ja_migrou');
  assert.strictEqual(alvo('me manda a lista de quem falta no pix'), 'pix');
});

test('fala que pede NOME e QUANTIDADE ao mesmo tempo vira lista (mandar os nomes já responde quantos são)', () => {
  assert.deepStrictEqual(c.detectarPedido('me manda a lista completa do pix avulso e quantos são no total'),
    { tipo: 'lista', alvo: 'pix_avulso' });
});

test('assuntos de famílias diferentes na mesma fala -> tudo', () => {
  assert.deepStrictEqual(c.detectarPedido('quantos faltam de anamnese e de contrato?'),
    { tipo: 'numeros', alvo: 'tudo' });
  assert.deepStrictEqual(c.detectarPedido('me manda a lista de tudo: pix, anamnese e contrato'),
    { tipo: 'lista', alvo: 'tudo' });
});

// ── I4: gate de números também exige token de assunto ─────────────────────────────────────────
test('I4: precisaDeNumeros só liga com token de assunto — "quantos"/"falta" sozinhos não bastam', () => {
  assert.strictEqual(c.precisaDeNumeros('quantos faltam?'), false);
  assert.strictEqual(c.precisaDeNumeros('quem falta entregar o relatório?'), false);
  assert.strictEqual(c.precisaDeNumeros('bom dia, time'), false);
  assert.strictEqual(c.precisaDeNumeros('cria uma tarefa pra Rose amanhã'), false);
  assert.strictEqual(c.precisaDeNumeros('quantos faltam no pix?'), true);
  assert.strictEqual(c.precisaDeNumeros('e a anamnese, como tá?'), true);
  assert.strictEqual(c.precisaDeNumeros('o contrato da Ana já voltou'), true);
  assert.strictEqual(c.precisaDeNumeros('como tá a migração?'), true);
});

// ── C4: detectarUnidade — acha uma unidade CITADA dentro de uma fala qualquer ───────────────────
const ID_CG = '2ec861f6-023f-4d7b-9927-3960ad8c2a92';
const ID_RECREIO = '95553e96-971b-4590-a6eb-0201d013c14d';
const ID_BARRA = '368d47f5-2d88-4475-bc14-ba084a9a348e';

test('C4: detectarUnidade reconhece Campo Grande, CG, Recreio e Barra (acento/maiúscula não importam)', () => {
  assert.strictEqual(c.detectarUnidade('quantos faltam em Campo Grande?'), ID_CG);
  assert.strictEqual(c.detectarUnidade('lista do pix da CG'), ID_CG);
  assert.strictEqual(c.detectarUnidade('o recreio tá com pix pendente'), ID_RECREIO);
  assert.strictEqual(c.detectarUnidade('lista da Barra, por favor'), ID_BARRA);
  assert.strictEqual(c.detectarUnidade('RECREIO'), ID_RECREIO);
});

test('C4: detectarUnidade só casa "barra"/"cg" como PALAVRA, nunca dentro de outra palavra', () => {
  assert.strictEqual(c.detectarUnidade('vamos içar a barragem'), null);
  assert.strictEqual(c.detectarUnidade('ele embarra tudo quando se atrasa'), null);
  assert.strictEqual(c.detectarUnidade('cgestao de horario mudou'), null); // "cg" colado, não é a sigla sozinha
});

test('C4: detectarUnidade sem nenhuma unidade citada -> null', () => {
  assert.strictEqual(c.detectarUnidade('quantos faltam migrar?'), null);
  assert.strictEqual(c.detectarUnidade('bom dia, time!'), null);
  assert.strictEqual(c.detectarUnidade(''), null);
  assert.strictEqual(c.detectarUnidade(null), null);
});

// ── mensagensDaLista: quebra em partes ────────────────────────────────────────────────────────
const itens = (n) => Array.from({ length: n }, (_, i) => ({ pagador: `Pagador ${i + 1}`, alunos: [`Aluno ${i + 1}`] }));
const base = { unidadeNome: 'Campo Grande', titulo: 'Pix avulso' };

test('0 itens: uma mensagem só, dizendo que não há ninguém (nunca silêncio)', () => {
  const ms = c.mensagensDaLista({ ...base, itens: [] });
  assert.strictEqual(ms.length, 1);
  assert.match(ms[0], /\(0 clientes\)/);
  assert.match(ms[0], /Ninguém/);
});

test('1 item: uma mensagem, cabeçalho com unidade e contagem, item no formato • Pagador — Alunos', () => {
  const ms = c.mensagensDaLista({ ...base, itens: [{ pagador: 'Ana Lima', alunos: ['Rafa', 'Bia'] }] });
  assert.strictEqual(ms.length, 1);
  assert.strictEqual(ms[0], '💠 *Pix avulso — Campo Grande* (1 clientes) — parte 1/1\n• Ana Lima — Rafa, Bia');
});

test('I5: lista de anamnese/contrato conta ALUNOS, não clientes', () => {
  const ms = c.mensagensDaLista({ unidadeNome: 'Barra', titulo: 'Anamnese — quem falta preencher', substantivo: 'alunos', itens: itens(3) });
  assert.match(ms[0], /\(3 alunos\)/);
  assert.ok(!/clientes/.test(ms[0]));
});

test('item sem aluno não deixa travessão solto', () => {
  const ms = c.mensagensDaLista({ ...base, itens: [{ pagador: 'Ana Lima', alunos: [] }] });
  assert.ok(ms[0].endsWith('• Ana Lima'), ms[0]);
});

test('45 itens cabem em UMA mensagem; 46 viram DUAS (45 + 1)', () => {
  const a = c.mensagensDaLista({ ...base, itens: itens(45) });
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].split('\n• ').length - 1, 45);
  const b = c.mensagensDaLista({ ...base, itens: itens(46) });
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0].split('\n• ').length - 1, 45);
  assert.strictEqual(b[1].split('\n• ').length - 1, 1);
  assert.match(b[0], /parte 1\/2/);
  assert.match(b[1], /parte 2\/2/);
  assert.match(b[0], /\(46 clientes\)/);
});

test('400 itens: teto de 8 mensagens, e a última DIZ quantos ficaram de fora', () => {
  const ms = c.mensagensDaLista({ ...base, itens: itens(400) });
  assert.strictEqual(ms.length, 8);
  const mostrados = ms.reduce((s, m) => s + (m.split('\n• ').length - 1), 0);
  assert.strictEqual(mostrados, 360);
  assert.match(ms[7], /40 de fora/);
  assert.match(ms[7], /painel/);
  assert.match(ms[0], /parte 1\/9/, 'o cabeçalho declara as 9 partes que a lista precisaria');
  assert.ok(!/de fora/.test(ms[0]), 'só a última fala do que ficou de fora');
});

test('sem sobra, nenhuma mensagem fala em "de fora"', () => {
  for (const m of c.mensagensDaLista({ ...base, itens: itens(90) })) assert.ok(!/de fora/.test(m));
});

test('limitePorMensagem é injetável (o teste não depende do default)', () => {
  const ms = c.mensagensDaLista({ ...base, itens: itens(5), limitePorMensagem: 2 });
  assert.strictEqual(ms.length, 3);
  assert.match(ms[2], /parte 3\/3/);
});

// ── C2: várias listas no mesmo pedido (alvo 'tudo') ───────────────────────────────────────────
test('C2: cada família tem TÍTULO próprio e NUMERAÇÃO DE PARTES própria', () => {
  const ms = c.mensagensDeVariasListas({
    unidadeNome: 'Barra',
    blocos: [
      { titulo: 'PIX automático — quem falta migrar', substantivo: 'clientes', itens: itens(50) },
      { titulo: 'Anamnese — quem falta preencher', substantivo: 'alunos', itens: itens(10) },
      { titulo: 'Contrato — quem falta assinar', substantivo: 'alunos', itens: itens(3) },
    ],
  });
  assert.strictEqual(ms.length, 4); // 2 do PIX + 1 + 1
  assert.match(ms[0], /PIX automático — quem falta migrar — Barra\* \(50 clientes\) — parte 1\/2/);
  assert.match(ms[1], /parte 2\/2/);
  assert.match(ms[2], /Anamnese — quem falta preencher — Barra\* \(10 alunos\) — parte 1\/1/);
  assert.match(ms[3], /Contrato — quem falta assinar — Barra\* \(3 alunos\) — parte 1\/1/);
  assert.ok(!/de fora/.test(ms.join('\n')));
});

test('C2: o teto de mensagens é GLOBAL e nenhuma família fica muda — a última diz o total que sobrou', () => {
  const ms = c.mensagensDeVariasListas({
    unidadeNome: 'Campo Grande',
    blocos: [
      { titulo: 'PIX automático — quem falta migrar', substantivo: 'clientes', itens: itens(161) },
      { titulo: 'Anamnese — quem falta preencher', substantivo: 'alunos', itens: itens(318) },
      { titulo: 'Contrato — quem falta assinar', substantivo: 'alunos', itens: itens(104) },
    ],
  });
  assert.strictEqual(ms.length, 8, 'o teto vale para o pedido inteiro, não por família');
  const txt = ms.join('\n');
  assert.ok(/PIX automático/.test(txt) && /Anamnese/.test(txt) && /Contrato/.test(txt),
    'nenhuma família pode sair muda do pedido');
  // Reparte: 1 mensagem reservada por família (ninguém fica mudo), o resto na ordem de
  // prioridade -> PIX 4 partes (161 de 161), anamnese 3 (135 de 318), contrato 1 (45 de 104).
  // O DENOMINADOR é de quantas partes a lista PRECISA: a anamnese precisa de 8 e recebeu 3, e o
  // cabeçalho diz isso — "parte 1/1" numa lista cortada leria como lista completa.
  assert.match(ms[0], /PIX automático.*parte 1\/4/);
  assert.match(ms[3], /PIX automático.*parte 4\/4/);
  assert.match(ms[4], /Anamnese.*parte 1\/8/);
  assert.match(ms[6], /Anamnese.*parte 3\/8/);
  assert.match(ms[7], /Contrato.*parte 1\/3/);
  const mostrados = ms.reduce((s, m) => s + (m.split('\n• ').length - 1), 0);
  assert.strictEqual(mostrados, 161 + 135 + 45);
  assert.match(ms[7], /242 de fora/);
});

test('C2: aviso extra (fonte de uma família fora) sai colado na última mensagem', () => {
  const ms = c.mensagensDeVariasListas({
    unidadeNome: 'Barra',
    blocos: [{ titulo: 'Anamnese — quem falta preencher', substantivo: 'alunos', itens: itens(2) }],
    avisos: ['A lista do PIX eu não consegui ler agora.'],
  });
  assert.match(ms[ms.length - 1], /A lista do PIX eu não consegui ler agora\./);
});

// ── C4: mensagensDeVariasListas com unidadeNome nulo (as três unidades juntas) ──────────────────
test('C4: unidadeNome nulo usa o título JÁ PRONTO do bloco, sem duplicar/inventar unidade', () => {
  const ms = c.mensagensDeVariasListas({
    unidadeNome: null,
    blocos: [
      { titulo: 'Pix avulso — Campo Grande', substantivo: 'clientes', itens: itens(2) },
      { titulo: 'Pix avulso — Recreio', substantivo: 'clientes', itens: [] },
    ],
  });
  assert.strictEqual(ms.length, 2);
  assert.match(ms[0], /^💠 \*Pix avulso — Campo Grande\* \(2 clientes\) — parte 1\/1/);
  assert.match(ms[1], /^💠 \*Pix avulso — Recreio\* \(0 clientes\) — parte 1\/1/);
  assert.ok(!/Campo Grande — undefined|— null/.test(ms.join('\n')));
});

// ── blocoDeNumeros ────────────────────────────────────────────────────────────────────────────
const PIX_ZERO = {
  total: 0, migrar: 0, autorizacao_pendente: 0, ja_migrou: 0, aguardando_cobranca: 0,
  nao_mexe: 0, inadimplente: 0, nao_pagante: 0, excecao: 0, outras: 0, faltam: 0,
  fatias: { pix_avulso: 0, cheque: 0, boleto: 0, dinheiro: 0, cartao_com_falha: 0, cartao_avulso: 0, sem_historico: 0, autorizacao_pendente: 0 },
};

test('bloco com ZERO em tudo: todos os assuntos aparecem com 0, nada some', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Barra', pix: PIX_ZERO,
    anamnese: { pendentes: 0, base: 0 }, contrato: { pendentes: 0, base: 0 },
    dadoEm: '2026-09-17T09:00:00Z',
  });
  assert.match(b, /Barra/);
  assert.match(b, /PIX autom[áa]tico: 0 clientes/);
  assert.match(b, /faltam migrar 0/);
  // Fatia com zero NÃO entra na linha: "🟡 Boleto 0 · 🟡 Dinheiro 0 · …" é ruído que empurra o
  // bloco pra fora do teto de linhas e esconde a fatia que tem gente.
  assert.match(b, /Fatias de quem falta: nenhuma/);
  assert.ok(b.split('\n').filter((l) => l.trim()).length <= 12, 'no máximo ~12 linhas');
  assert.match(b, /Nunca estime/);
});

// ── C3: o recorte de anamnese/contrato tem que estar DECLARADO ────────────────────────────────
// A pauta diária conta só quem tem aula hoje (~25 em CG); estes números são de TODOS os alunos
// ativos (318). Sem o rótulo, o TOM afirmaria 318 como se fosse a pauta do dia.
test('C3: anamnese e contrato declaram o recorte, palavra por palavra', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Campo Grande', pix: PIX_ZERO,
    anamnese: { pendentes: 318, base: 399 }, contrato: { pendentes: 104, base: 399 },
    dadoEm: '2026-09-17T09:00:00Z',
  });
  assert.ok(b.includes('Anamnese (TODOS os alunos ativos da unidade, NÃO é a pauta de hoje): 318 pendentes de 399'), b);
  assert.ok(b.includes('Contrato (TODOS os alunos ativos da unidade, NÃO é a pauta de hoje): 104 pendentes de 399'), b);
});

test('C3: a instrução manda SEMPRE dizer que é o total da unidade, não a pauta de hoje', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Barra', pix: PIX_ZERO,
    anamnese: { pendentes: 1, base: 2 }, contrato: { pendentes: 1, base: 2 }, dadoEm: null,
  });
  assert.ok(b.includes('Ao dar número de anamnese ou contrato, diga sempre que é o total da unidade e não a pauta de hoje.'), b);
});

test('bloco com números reais traz TODAS as fatias com gente, em ordem de prioridade', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Campo Grande',
    pix: { ...PIX_ZERO, total: 373, migrar: 225, autorizacao_pendente: 6, ja_migrou: 7, nao_mexe: 113, nao_pagante: 14, inadimplente: 8, faltam: 231,
      fatias: { ...PIX_ZERO.fatias, autorizacao_pendente: 6, pix_avulso: 161, cheque: 15, boleto: 8, cartao_com_falha: 13, cartao_avulso: 9, dinheiro: 1, sem_historico: 18 } },
    anamnese: { pendentes: 40, base: 344 }, contrato: { pendentes: 12, base: 344 },
    dadoEm: '2026-09-17T09:00:00Z',
  });
  assert.match(b, /faltam migrar 231/);
  assert.match(b, /Pix avulso 161/);
  const fatiasLinha = b.split('\n').find((l) => l.startsWith('Fatias'));
  assert.ok(fatiasLinha.indexOf('Pix avulso') < fatiasLinha.indexOf('Cheque'), 'ordem de prioridade das FATIAS');
  assert.ok(!/Boleto 0|Dinheiro 0/.test(fatiasLinha), 'fatia zerada não entra na linha');
});

test('fonte do PIX fora: o bloco DIZ que não leu e proíbe número — nunca inventa', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Barra', pix: null,
    anamnese: { pendentes: 3, base: 10 }, contrato: { pendentes: 1, base: 10 },
    dadoEm: null, motivo: 'PIX: timeout',
  });
  assert.match(b, /não consegui ler/i);
  assert.ok(!/faltam migrar/.test(b), 'sem número de PIX inventado');
  assert.match(b, /Anamnese \(TODOS os alunos ativos da unidade, NÃO é a pauta de hoje\): 3 pendentes de 10/);
});

test('situação dos alunos fora: anamnese e contrato dizem que não leram', () => {
  const b = c.blocoDeNumeros({ unidadeNome: 'Barra', pix: PIX_ZERO, anamnese: null, contrato: null, dadoEm: null });
  assert.ok(!/Anamnese \(/.test(b));
  assert.ok(!/Contrato \(/.test(b));
  assert.match(b, /não consegui ler/i);
});

// ── C4: blocoDeNumerosTodasUnidades — as três juntas + TOTAL ────────────────────────────────────
test('C4: cada unidade fala por si e o TOTAL soma as três', () => {
  const un = (nome, faltam) => ({
    unidadeNome: nome,
    pix: { ...PIX_ZERO, total: faltam + 10, ja_migrou: 10, faltam },
    anamnese: { pendentes: 1, base: 10 },
    contrato: { pendentes: 2, base: 10 },
    motivo: null,
  });
  const b = c.blocoDeNumerosTodasUnidades({ unidades: [un('Campo Grande', 5), un('Recreio', 3), un('Barra', 2)] });
  assert.match(b, /Campo Grande — PIX autom[áa]tico:.*faltam migrar 5/);
  assert.match(b, /Recreio — PIX autom[áa]tico:.*faltam migrar 3/);
  assert.match(b, /Barra — PIX autom[áa]tico:.*faltam migrar 2/);
  assert.match(b, /TOTAL — PIX autom[áa]tico:.*faltam migrar 10/);
  assert.match(b, /TOTAL — Anamnese.*3 pendentes de 30/);
  assert.match(b, /TOTAL — Contrato.*6 pendentes de 30/);
  assert.match(b, /Nunca estime/);
});

test('C4: uma unidade sem PIX faz o TOTAL de PIX dizer que não dá pra somar — nunca soma zero', () => {
  const un = (nome, faltam) => ({ unidadeNome: nome, pix: { ...PIX_ZERO, total: faltam, faltam }, anamnese: { pendentes: 1, base: 10 }, contrato: { pendentes: 1, base: 10 } });
  const semPix = { unidadeNome: 'Recreio', pix: null, anamnese: { pendentes: 1, base: 10 }, contrato: { pendentes: 1, base: 10 }, motivo: 'PIX: timeout' };
  const b = c.blocoDeNumerosTodasUnidades({ unidades: [un('Campo Grande', 5), semPix, un('Barra', 2)] });
  assert.match(b, /Recreio — PIX autom[áa]tico: N[ÃA]O CONSEGUI LER/);
  assert.match(b, /TOTAL — PIX autom[áa]tico: n[ãa]o d[áa] pra somar/);
  assert.match(b, /TOTAL — Anamnese.*3 pendentes de 30/, 'anamnese das três leu OK, soma normal mesmo com o PIX fora');
});

// ── tituloDoAlvo / substantivoDoAlvo ──────────────────────────────────────────────────────────
test('C2: cada família tem o seu título', () => {
  assert.strictEqual(c.tituloDoAlvo('pix_avulso'), 'Pix avulso');
  assert.strictEqual(c.tituloDoAlvo('cartao_avulso'), 'Maquininha');
  assert.strictEqual(c.tituloDoAlvo('anamnese'), 'Anamnese — quem falta preencher');
  assert.strictEqual(c.tituloDoAlvo('contrato'), 'Contrato — quem falta assinar');
  assert.strictEqual(c.tituloDoAlvo('ja_migrou'), 'Já migraram');
  assert.match(c.tituloDoAlvo('pix'), /PIX autom/);
  assert.match(c.tituloDoAlvo('tudo'), /PIX autom/);
});

test('I5: substantivo do cabeçalho — cliente no PIX, aluno na anamnese e no contrato', () => {
  assert.strictEqual(c.substantivoDoAlvo('pix'), 'clientes');
  assert.strictEqual(c.substantivoDoAlvo('cheque'), 'clientes');
  assert.strictEqual(c.substantivoDoAlvo('anamnese'), 'alunos');
  assert.strictEqual(c.substantivoDoAlvo('contrato'), 'alunos');
});

test('textos fixos existem e não são vazios (o TOM nunca responde com silêncio)', () => {
  assert.ok(c.TEXTO_SEM_UNIDADE.length > 10);
  assert.match(c.TEXTO_SEM_UNIDADE, /unidade/i);
  assert.ok(c.TEXTO_FONTE_FORA.length > 10);
  assert.match(c.TEXTO_FONTE_FORA, /LA Report/);
});

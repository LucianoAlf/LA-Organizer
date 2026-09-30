'use strict';
// delegacao-lista-confirm.test.js — CONFIRM-DELEG-LISTA-SEM-NEGRITO (auditoria 30/09 do d872532e).
//
// O conserto d872532e (delegar tarefa NOVA na confirmação) era PARCIAL. Das 6 perguntas reais do
// TOM com "deleg" em 30 dias, só 3 seriam liberadas. As 2 da Krissya em LISTA NUMERADA SEM NEGRITO
// (pending_intents 71086cf0 e 3a03bfa2, 29/09 18:14 e 18:18 BRT) seguiam presas — e lista é o jeito
// natural de ela pedir ("delega essas duas pra Kailane"). O parser só olhava o 1º bloco em negrito;
// sem negrito → null → nada estagiado → "não travou, me manda de novo".
//
// E a prova de "a tarefa ainda não existe" cobria só o 1º item: numa pergunta com dois itens, o
// segundo era criado sem prova nenhuma.
//
// Conserto: (1) o parser devolve UM item por linha de lista (com ou sem negrito) ou por bloco em
// negrito, cada um com seu destinatário; (2) a prova no banco é POR ITEM, e a criação só é liberada
// quando TODOS provaram que são novos; (3) o casamento com tarefa EXISTENTE só vale por título
// inteiro — fragmento que casa com outra tarefa vira PERGUNTA ("é essa ou crio nova?"), nunca ação.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseDelegateConfirmItems, parseDelegateConfirmQuestion } = require('./delegate-question-parse');
const { classificarItensDelegacao, perguntaDelegacaoAmbigua, tituloCasaInteiro } = require('./delegacao-itens-resolve');
const { podeLiberarCriacaoDelegada } = require('./confirm-create-gate');
const { resolveTaskTarget } = require('../lib/task-target');

// Literais de pending_intents.question_text (29/09, Krissya).
const LISTA_71086CF0 = 'Vou confirmar antes de delegar pra Kailane, já que toca outra pessoa.\n\nFechando pra Kailane:\n1. Ligar pro lead que você passou ontem — prazo hoje\n2. Ver o vídeo de registro de visitas que a Vitória postou no grupo — prazo quarta (01/10)\n\nConfirma pra eu delegar as duas?';
const LISTA_3A03BFA2 = 'Confirma pra eu delegar as duas pra Kailane:\n\n1. Ligar pro lead que você passou ontem — prazo hoje às 19h30\n2. Ver o vídeo de registro de visitas que a Vitória postou no grupo — prazo quarta (30/09) às 15h\n\nConfirma?';
const VIDEO = 'Confirma pra eu delegar pra Kailane: *ver o vídeo de registro de visitas que a Vitória postou no grupo* — prazo quarta (30/09) às 15h?';

const LEAD = 'Ligar pro lead que você passou ontem';
const VID = 'Ver o vídeo de registro de visitas que a Vitória postou no grupo';

// ── 1. parser: lista numerada sem negrito ─────────────────────────────────────
test('71086cf0 (lista numerada sem negrito) → 2 itens pra Kailane', () => {
  assert.deepStrictEqual(parseDelegateConfirmItems(LISTA_71086CF0), [
    { task_title: LEAD, to_name: 'Kailane' },
    { task_title: VID, to_name: 'Kailane' },
  ]);
});

test('3a03bfa2 (lista numerada sem negrito) → 2 itens pra Kailane', () => {
  assert.deepStrictEqual(parseDelegateConfirmItems(LISTA_3A03BFA2), [
    { task_title: LEAD, to_name: 'Kailane' },
    { task_title: VID, to_name: 'Kailane' },
  ]);
});

test('lista com destinatários DIFERENTES por item (negrito e sem negrito)', () => {
  const q = 'Confirma pra eu delegar:\n\n1. *Ligar para a Gisele* — pro Arthur, quarta às 11h30\n2. Ver o vídeo da Vitória — pra Kailane, prazo quarta\n\nConfirma?';
  assert.deepStrictEqual(parseDelegateConfirmItems(q), [
    { task_title: 'Ligar para a Gisele', to_name: 'Arthur' },
    { task_title: 'Ver o vídeo da Vitória', to_name: 'Kailane' },
  ]);
});

test('lista agrupada por destinatário (cabeçalho mais próximo vale)', () => {
  const q = 'Confirma pra eu delegar?\n\nPra Kailane:\n• Ligar pro lead — hoje\n• Ver o vídeo da Vitória — quarta\n\nPro Arthur:\n• Ligar para a Gisele — quarta 11h30';
  assert.deepStrictEqual(parseDelegateConfirmItems(q), [
    { task_title: 'Ligar pro lead', to_name: 'Kailane' },
    { task_title: 'Ver o vídeo da Vitória', to_name: 'Kailane' },
    { task_title: 'Ligar para a Gisele', to_name: 'Arthur' },
  ]);
});

test('vários negritos na mesma linha → um item por negrito', () => {
  const q = 'Confirma pra eu delegar pra Kailane: *ligar pro lead* e *ver o vídeo da Vitória*?';
  assert.deepStrictEqual(parseDelegateConfirmItems(q), [
    { task_title: 'ligar pro lead', to_name: 'Kailane' },
    { task_title: 'ver o vídeo da Vitória', to_name: 'Kailane' },
  ]);
});

test('pergunta de 1 negrito segue igual (compat d872532e)', () => {
  assert.deepStrictEqual(parseDelegateConfirmItems(VIDEO), [
    { task_title: 'ver o vídeo de registro de visitas que a Vitória postou no grupo', to_name: 'Kailane' },
  ]);
  // A função antiga devolve o 1º item — quem mede vitalidade continua funcionando.
  assert.deepStrictEqual(parseDelegateConfirmQuestion(LISTA_3A03BFA2), { task_title: LEAD, to_name: 'Kailane' });
});

test('fail-closed: item de lista sem destinatário resolvível → null', () => {
  assert.strictEqual(parseDelegateConfirmItems('Confirma pra eu delegar?\n1. Ligar pro lead\n2. Ver o vídeo'), null);
});

test('fail-closed: dois destinatários no mesmo cabeçalho → null (não chuta)', () => {
  assert.strictEqual(parseDelegateConfirmItems('Confirma pra eu delegar pra Kailane e pro Arthur:\n1. Ligar pro lead\n2. Ver o vídeo'), null);
});

test('negação e não-delegação seguem null', () => {
  assert.strictEqual(parseDelegateConfirmItems('Não delegar essas:\n1. Ligar pro lead — pra Kailane'), null);
  assert.strictEqual(parseDelegateConfirmItems('Assumindo que é o Jhonatan — foi quem delegou essa reunião. Aviso ele? Confirma?'), null);
  assert.strictEqual(parseDelegateConfirmItems('Fechando pra Kailane:\n1. Ligar pro lead\nConfirma?'), null);
});

// ── 2. prova POR ITEM no banco ─────────────────────────────────────────────────
// Fakes: queryDono (tarefas abertas atribuídas A quem pediu) e queryCriadas (criadas POR quem pediu).
function fakeBanco(tarefas) {
  const casa = (title) => (t) => t.title.toLowerCase().includes(String(title).slice(0, 60).toLowerCase());
  return {
    queryDono: async (title) => tarefas.filter((t) => t.dono && casa(title)(t)),
    queryCriadas: async (title) => tarefas.filter((t) => t.criou && casa(title)(t)),
  };
}

test('todos os itens provados novos → delegacao_nova com TODOS os itens; o gate libera', async () => {
  const itens = parseDelegateConfirmItems(LISTA_3A03BFA2);
  const r = await classificarItensDelegacao({ itens, ...fakeBanco([]), resolveTaskTarget });
  assert.strictEqual(r.tipo, 'nova');
  assert.deepStrictEqual(r.delegacao_nova.itens, itens);
  assert.strictEqual(podeLiberarCriacaoDelegada(LISTA_3A03BFA2, { delegacao_nova: r.delegacao_nova }), true);
  assert.strictEqual(podeLiberarCriacaoDelegada(LISTA_71086CF0, { delegacao_nova: r.delegacao_nova }), true);
});

test('UM item já existe → NÃO libera a criação de nenhum (2º item não passa sem prova)', async () => {
  const itens = parseDelegateConfirmItems(LISTA_3A03BFA2);
  const banco = fakeBanco([{ id: 'aaaaaaaa-1', title: 'Ver o vídeo de registro de visitas que a Vitória postou no grupo', criou: true }]);
  const r = await classificarItensDelegacao({ itens, ...banco, resolveTaskTarget });
  assert.strictEqual(r.tipo, 'ambigua');
  assert.strictEqual(r.delegacao_nova, undefined);
  assert.deepStrictEqual(r.delegacao_ambigua.itens.map((i) => i.situacao), ['nova', 'existe']);
});

test('leitura do banco com erro → null (fail-closed, nada estagiado)', async () => {
  const itens = parseDelegateConfirmItems(LISTA_3A03BFA2);
  const r = await classificarItensDelegacao({
    itens, queryDono: async () => { throw new Error('boom'); }, queryCriadas: async () => [], resolveTaskTarget,
  });
  assert.strictEqual(r, null);
});

// ── 3. tarefa EXISTENTE: só título inteiro age; fragmento pergunta ──────────────
test('item único com título INTEIRO de tarefa minha → delegation (repasse da existente)', async () => {
  const banco = fakeBanco([{ id: '5aa9c275-0000-0000-0000-000000000000', title: 'Ligar para a Gisele', dono: true }]);
  const r = await classificarItensDelegacao({ itens: [{ task_title: 'ligar para a Gisele', to_name: 'Arthur' }], ...banco, resolveTaskTarget });
  assert.strictEqual(r.tipo, 'existente');
  assert.deepStrictEqual(r.delegation, { task_id: '5aa9c275', to_name: 'Arthur' });
});

test('RISCO da auditoria: FRAGMENTO que casa UMA tarefa diferente → pergunta, não delega', async () => {
  // Controle: o caminho antigo (resolveTitlesToBatchComplete + resolveTaskTarget) dava "exato"
  // com 1 candidato — e o "sim" repassava pra Kailane uma tarefa que ninguém citou.
  const outra = { id: 'bbbbbbbb-0000-0000-0000-000000000000', title: 'Ligar pro lead da Ana — matrícula de bateria', dono: true };
  assert.strictEqual(resolveTaskTarget({ candidatos: [outra] }).modo, 'exato');
  const r = await classificarItensDelegacao({ itens: [{ task_title: 'Ligar pro lead', to_name: 'Kailane' }], ...fakeBanco([outra]), resolveTaskTarget });
  assert.strictEqual(r.tipo, 'ambigua');
  assert.strictEqual(r.delegation, undefined);
  assert.deepStrictEqual(r.delegacao_ambigua.itens[0].parecidas, ['Ligar pro lead da Ana — matrícula de bateria']);
});

test('duas tarefas de linhagens diferentes casam → pergunta', async () => {
  const banco = fakeBanco([
    { id: 'c1', title: 'Ligar para a Gisele', dono: true },
    { id: 'c2', title: 'Ligar para a Gisele', dono: true },
  ]);
  const r = await classificarItensDelegacao({ itens: [{ task_title: 'Ligar para a Gisele', to_name: 'Arthur' }], ...banco, resolveTaskTarget });
  assert.strictEqual(r.tipo, 'ambigua');
});

test('título inteiro tolera sufixo de unidade e acento/caixa, mas não fragmento', () => {
  assert.strictEqual(tituloCasaInteiro('Comprar 6 pares de baquetas — Campo Grande', 'comprar 6 pares de baquetas'), true);
  assert.strictEqual(tituloCasaInteiro('Ver o vídeo da Vitória', 'ver o video da vitoria'), true);
  assert.strictEqual(tituloCasaInteiro('Ligar pro lead da Ana — matrícula', 'Ligar pro lead'), false);
});

test('pergunta de esclarecimento cita a(s) parecida(s) e oferece criar nova', () => {
  const msg = perguntaDelegacaoAmbigua({ itens: [
    { task_title: 'Ligar pro lead', to_name: 'Kailane', situacao: 'existe', parecidas: ['Ligar pro lead da Ana — matrícula de bateria'] },
    { task_title: 'Ver o vídeo', to_name: 'Kailane', situacao: 'nova', parecidas: [] },
  ] });
  assert.match(msg, /Ligar pro lead da Ana — matrícula de bateria/);
  assert.match(msg, /Kailane/);
  assert.match(msg, /nova/i);
  assert.doesNotMatch(msg, /deleguei|criei|pronto/i);
});

// ── 4. contrato de fonte do engine ─────────────────────────────────────────────
test('engine: parse por item, prova por item, ramo de ambiguidade e regra escopada', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(src, /parseDelegateConfirmItems\(reply\)/);
  assert.match(src, /classificarItensDelegacao\(/);
  assert.match(src, /target\.payload\?\.delegacao_ambigua/);
  assert.match(src, /perguntaDelegacaoAmbigua\(/);
  assert.match(src, /regraDelegacaoNova\(/);
});

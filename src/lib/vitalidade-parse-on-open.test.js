'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { vitalidadeDasFatias, blocoDoLaudo } = require('./vitalidade-parse-on-open');

const HOJE = '2026-09-07';
const acha = (v, chave) => v.find((x) => x.chave === chave);

// Falas LITERAIS de producao (pending_intents.question_text), colhidas em 07/09/2026.
const Q_RESCHED_REAL = 'Reagendo as 3 pra amanhã (quinta), Fefê? • Verificar contratos '
  + '• Ajuste no LA Report (Hugo) • Retorno dos pais — renovações Me confirma?';
const Q_RESCHED_REAL2 = 'Qual(is) tô reagendando pra segunda (06/07)? • *Relatar as ocorrências '
  + 'dos professores no Lá report* • *Lista de convidados dos alunos*';
const Q_COMPLETE_REAL = 'Confirma o fechamento destas 3 tarefas: *Video abertura*, '
  + '*Videos Chamadas do meio*, *Video final do Evolução*?';
const Q_DELEG_REAL = 'Delego a *Curadoria professores eMusys* pro Matheus Felipe e aviso ele '
  + 'no sistema? Confirma?';

// ---------------------------------------------------------------------------
// O veredito que impede ALARME FALSO: sem pergunta do assunto, a fatia dorme.
// ---------------------------------------------------------------------------
test('sem pergunta do assunto → sem_oportunidade (NÃO é defeito)', () => {
  const v = vitalidadeDasFatias([
    { question_text: 'Crio a tarefa de comprar pilha? Confirma?', payload: {}, asked_at: '2026-09-01' },
  ], { hoje: HOJE });
  assert.strictEqual(acha(v, 'reschedule').veredito, 'sem_oportunidade');
  assert.strictEqual(acha(v, 'delegation').veredito, 'sem_oportunidade');
  assert.strictEqual(acha(v, 'reschedule').tema, 0);
});

test('acervo vazio não inventa doença', () => {
  const v = vitalidadeDasFatias([], { hoje: HOJE });
  assert.ok(v.every((x) => x.veredito === 'sem_oportunidade'));
  assert.strictEqual(blocoDoLaudo(v).includes('reagendamento'), true); // aparece, mas como "dorme"
});

// ---------------------------------------------------------------------------
// O ACHADO: o TOM falou do assunto e o parser não casou nenhuma vez.
// Estas duas falas são reais e o parser de reagendamento devolve null nas duas —
// ele espera "• *Título* → 02/09" e o TOM escreve a data no cabeçalho.
// ---------------------------------------------------------------------------
test('tema sim, parser zero → ancora_nao_casa (falas reais de reagendamento)', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_RESCHED_REAL, payload: {}, asked_at: '2026-06-03' },
    { question_text: Q_RESCHED_REAL2, payload: {}, asked_at: '2026-07-04' },
  ], { hoje: HOJE });
  const r = acha(v, 'reschedule');
  assert.strictEqual(r.tema, 2);
  assert.strictEqual(r.parser, 0, 'o parser de hoje não casa a prosa real');
  assert.strictEqual(r.estagiou, 0);
  assert.strictEqual(r.veredito, 'ancora_nao_casa');
});

// ---------------------------------------------------------------------------
// A quebra DEPOIS do parser: ele casou, e mesmo assim nada foi estagiado.
// ---------------------------------------------------------------------------
test('parser casou e nada estagiou → quebra_depois_do_parser (fala real de fechamento)', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_COMPLETE_REAL, payload: {}, asked_at: '2026-07-22' },
  ], { hoje: HOJE });
  const c = acha(v, 'batch_complete');
  assert.strictEqual(c.tema, 1);
  assert.strictEqual(c.parser, 1, 'o parser CASA essa pergunta');
  assert.strictEqual(c.estagiou, 0);
  assert.strictEqual(c.veredito, 'quebra_depois_do_parser');
});

// ---------------------------------------------------------------------------
// O ALARME FALSO do medidor: a fatia estagia por caminho DIRETO (sem parser).
// Literal real de producao (pending_intents 11/09/2026 22:23 UTC): o ramo A2 do engine
// escreve `question_text = "Confirmar fechamento em lote: ..."` e estagia
// payload.batch_complete de uma vez — o parser NUNCA é consultado nesse caminho. A âncora
// dele ("fechamento destas N tarefas:") é a frase que vai pro USUÁRIO, não esse rótulo.
// Com `parser 0 + estagiou 15` o laudo dizia "a âncora envelheceu, é achado" — e mandava
// consertar um parser que está intacto. Três rodadas (07/09, 11/09, 12/09) gastas nisso.
// ---------------------------------------------------------------------------
const Q_BATCH_ROTULO = 'Confirmar fechamento em lote: *Olhar o CRM (chat)*, '
  + '*Verificar a agenda do dia*, *Abrir o caixa pelo grupo do financeiro*?';

test('estagiou por caminho direto → viva_sem_parser, NÃO ancora_nao_casa', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_BATCH_ROTULO, payload: { batch_complete: ['a', 'b'] }, asked_at: '2026-09-11' },
  ], { hoje: HOJE });
  const c = acha(v, 'batch_complete');
  assert.strictEqual(c.tema, 1);
  assert.strictEqual(c.parser, 0, 'o rótulo da intent não é a frase que o parser ancora');
  assert.strictEqual(c.estagiou, 1);
  assert.strictEqual(c.veredito, 'viva_sem_parser');
});

test('blocoDoLaudo não cobra conserto de fatia que está estagiando', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_BATCH_ROTULO, payload: { batch_complete: ['a'] }, asked_at: '2026-09-11' },
    { question_text: Q_DELEG_REAL, payload: { delegation: {} }, asked_at: '2026-09-10' },
  ], { hoje: HOJE });
  const b = blocoDoLaudo(v);
  assert.ok(!b.includes('fechamento por pergunta'), 'fatia viva não entra na lista de doentes');
});

test('ancora_nao_casa continua valendo quando NADA estagiou', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_BATCH_ROTULO, payload: {}, asked_at: '2026-09-11' },
  ], { hoje: HOJE });
  assert.strictEqual(acha(v, 'batch_complete').veredito, 'ancora_nao_casa');
});

test('parser casou E estagiou → viva (fala real de delegação)', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_DELEG_REAL, payload: { delegation: { task_id: 'x', to_name: 'Matheus Felipe' } }, asked_at: '2026-07-10' },
  ], { hoje: HOJE });
  const d = acha(v, 'delegation');
  assert.strictEqual(d.parser, 1);
  assert.strictEqual(d.estagiou, 1);
  assert.strictEqual(d.veredito, 'viva');
  assert.strictEqual(d.ultimoEstagio, '2026-07-10');
});

test('ultimoEstagio guarda o MAIS RECENTE, não o último lido', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_DELEG_REAL, payload: { delegation: {} }, asche: 1, asked_at: '2026-08-20' },
    { question_text: Q_DELEG_REAL, payload: { delegation: {} }, asked_at: '2026-07-10' },
  ], { hoje: HOJE });
  assert.strictEqual(acha(v, 'delegation').ultimoEstagio, '2026-08-20');
});

// ---------------------------------------------------------------------------
// Robustez: a medição nunca pode derrubar o laudo nem se calar por erro.
// Laudo em branco é lido como saúde — é a falha que essa casa mais persegue.
// ---------------------------------------------------------------------------
test('parser que explode conta como "não casou" e não derruba a medição', () => {
  const fatias = [{
    chave: 'reschedule',
    nome: 'reagendamento',
    tema: /reagend/i,
    parse: () => { throw new Error('boom'); },
  }];
  const v = vitalidadeDasFatias(
    [{ question_text: 'reagendo tudo?', payload: {}, asked_at: '2026-09-01' }],
    { hoje: HOJE, fatias },
  );
  assert.strictEqual(v[0].tema, 1);
  assert.strictEqual(v[0].parser, 0);
  assert.strictEqual(v[0].veredito, 'ancora_nao_casa');
});

test('linha sem question_text/payload não quebra', () => {
  const v = vitalidadeDasFatias([{}, { question_text: null }, { payload: null }], { hoje: HOJE });
  assert.strictEqual(v.length, 4);
  assert.ok(v.every((x) => x.tema === 0));
});

test('entrada não-array vira medição vazia, não exceção', () => {
  assert.strictEqual(vitalidadeDasFatias(null, { hoje: HOJE }).length, 4);
  assert.strictEqual(vitalidadeDasFatias(undefined, { hoje: HOJE }).length, 4);
});

// ---------------------------------------------------------------------------
// O bloco do laudo.
// ---------------------------------------------------------------------------
test('blocoDoLaudo: some inteiro quando tudo está vivo', () => {
  const vits = [{ chave: 'x', nome: 'x', tema: 1, parser: 1, estagiou: 1, ultimoEstagio: '2026-09-01', veredito: 'viva' }];
  assert.strictEqual(blocoDoLaudo(vits), '');
});

test('blocoDoLaudo: manda conferir a data de NASCIMENTO do parser antes de abrir achado', () => {
  const v = vitalidadeDasFatias([
    { question_text: Q_RESCHED_REAL, payload: {}, asked_at: '2026-06-03' },
  ], { hoje: HOJE });
  const b = blocoDoLaudo(v);
  assert.match(b, /NASCEU/);
  assert.match(b, /diff-filter=A/);
  assert.match(b, /ancora deixou de casar a prosa/);
  assert.match(b, /NUNCA/); // último estágio
});

test('blocoDoLaudo: entrada vazia devolve string vazia (nunca "undefined")', () => {
  assert.strictEqual(blocoDoLaudo([]), '');
  assert.strictEqual(blocoDoLaudo(null), '');
});

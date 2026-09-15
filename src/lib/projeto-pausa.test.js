'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseProjectUpdate, resolverProjeto, dataDaPausa, estaPausado, textoPausa, textoProjetoNaoAchado } = require('./projeto-pausa');
const { classifyAdherenceProjects } = require('../utils/adherence-projects');

// Juliana, 14/09: o projeto real cobrado no balanço.
const PROJETOS = [
  { id: 'p-teatro', name: 'LA THEATER - Jornada do curso de teatro musical' },
  { id: 'p-recital', name: 'Recital 2026' },
  { id: 'p-recital-kids', name: 'Recital 2026 Kids' },
];
const HOJE = '2026-09-14';

test('o marcador é lido e sai do texto', () => {
  const r = parseProjectUpdate('Entendido! <<PROJECT_UPDATE>>{"action":"pausar_cobranca","project":"LA THEATER","ate":"2026-09-30","motivo":"fase de divulgação"}<<END>>');
  assert.strictEqual(r.cleanText, 'Entendido!');
  assert.deepStrictEqual(r.itens, [{ action: 'pausar_cobranca', project: 'LA THEATER', ate: '2026-09-30', motivo: 'fase de divulgação' }]);
  assert.strictEqual(parseProjectUpdate('sem marcador nenhum'), null);
  assert.strictEqual(parseProjectUpdate('<<PROJECT_UPDATE>>{quebrado<<END>>').invalido, true);
});

test('Juliana: "LA THEATER" acha o projeto do teatro; nome ambíguo ou inexistente não chuta', () => {
  assert.strictEqual(resolverProjeto('LA THEATER', PROJETOS).id, 'p-teatro');
  assert.strictEqual(resolverProjeto('teatro musical', PROJETOS).id, 'p-teatro');
  assert.strictEqual(resolverProjeto('Recital 2026', PROJETOS).id, 'p-recital', 'nome igual vence o que só contém');
  assert.strictEqual(resolverProjeto('Recital', PROJETOS), null, 'dois recitais: não escolhe');
  assert.strictEqual(resolverProjeto('Summer Camp', PROJETOS), null);
  assert.strictEqual(resolverProjeto('LA', PROJETOS), null, 'fragmento curto demais');
});

test('data de volta: a pedida; sem data, uma semana; nunca além de 60 dias; passado vira padrão', () => {
  assert.strictEqual(dataDaPausa('2026-09-30', HOJE), '2026-09-30');
  assert.strictEqual(dataDaPausa(null, HOJE), '2026-09-21');
  assert.strictEqual(dataDaPausa('2027-03-01', HOJE), '2026-11-13');
  assert.strictEqual(dataDaPausa('2026-09-01', HOJE), '2026-09-21');
  assert.strictEqual(dataDaPausa('amanhã', HOJE), '2026-09-21');
});

test('pausado vale até o último dia inclusive', () => {
  assert.strictEqual(estaPausado({ cobranca_pausada_ate: '2026-09-21' }, '2026-09-21'), true);
  assert.strictEqual(estaPausado({ cobranca_pausada_ate: '2026-09-21' }, '2026-09-22'), false);
  assert.strictEqual(estaPausado({}, HOJE), false);
});

test('o balanço NÃO cobra projeto pausado — e segue cobrando o que não está', () => {
  const ativos = [
    { id: 'p-teatro', name: 'LA THEATER', status: 'active', cobranca_pausada_ate: '2026-09-30' },
    { id: 'p-recital', name: 'Recital 2026', status: 'active' },
  ];
  const tarefas = [
    { project_id: 'p-teatro', updated_at: '2026-09-09T10:00:00Z', status: 'pending' },
    { project_id: 'p-recital', updated_at: '2026-09-09T10:00:00Z', status: 'pending' },
  ];
  const { pausedProjects } = classifyAdherenceProjects(ativos, tarefas, '2026-09-12T00:00:00Z', HOJE);
  assert.deepStrictEqual(pausedProjects.map((p) => p.id), ['p-recital']);
  const depois = classifyAdherenceProjects(ativos, tarefas, '2026-09-12T00:00:00Z', '2026-10-01');
  assert.deepStrictEqual(depois.pausedProjects.map((p) => p.id).sort(), ['p-recital', 'p-teatro'], 'a pausa acaba e a cobrança volta');
});

test('textos do sistema', () => {
  assert.strictEqual(textoPausa({ nome: 'LA THEATER', ate: '2026-09-30', motivo: 'fase de divulgação' }),
    '⏸️ Paro de cobrar *LA THEATER* até 30/09 (fase de divulgação). Se voltar antes, é só me falar.');
  assert.match(textoProjetoNaoAchado('Summer Camp'), /Não achei um projeto ativo seu com o nome _Summer Camp_/);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
const DISP = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'rituals', 'dispatcher.js'), 'utf8');
test('engine executa o marcador antes dos guards; o balanço lê a pausa do banco', () => {
  const iExec = ENG.indexOf("'PROJECT_UPDATE', 'executed'");
  const iMem = ENG.indexOf('  // 3) Memory save (sempre por último');
  assert.ok(iExec > 0 && iExec < iMem, 'o executor tem que rodar antes do bloco de memória (e dos guards)');
  assert.ok(DISP.includes(".select('id, name, status, cobranca_pausada_ate')"), 'o balanço não busca a pausa');
});

'use strict';
// JANELA-60D (caso Peterson 29/09 16:11 BRT): "SEO da loja" (prazo 01/07) e "Fazer post no
// Instagram da escola" (prazo 08/07) foram dados como feitos; o TOM emitiu TASK_UPDATE complete
// com o short id e levou "complete REJECTED" — o resolvedor só enxergava prazo dos últimos 60
// dias. Mesma coisa com "LA educa" vencida há mais de 60 dias que o TOM segue cobrando. Tarefa
// ABERTA que o TOM lista tem que poder ser fechada pelo chat, qualquer que seja a idade do prazo.
const { test } = require('node:test');
const assert = require('node:assert');
const { desdeIsoJanela, filtroOrJanelaShortId, entraNaJanelaShortId, JANELA_FECHADAS_DIAS } = require('./janela-short-id');

const AGORA = Date.parse('2026-09-29T19:11:00Z'); // 29/09 16:11 BRT
const DESDE = desdeIsoJanela(AGORA);

// Avaliador mínimo da string .or() do PostgREST (só as 3 formas que o filtro usa), pra provar
// que o que vai pro banco diz o mesmo que o predicado JS.
function avaliaOr(orStr, row) {
  const clausulas = orStr.match(/[a-z_]+\.(?:not\.in\.\([^)]*\)|gte\.[^,]+|is\.null)/g);
  return clausulas.some((c) => {
    let m;
    if ((m = c.match(/^([a-z_]+)\.not\.in\.\(([^)]*)\)$/))) return !m[2].split(',').includes(row[m[1]]);
    if ((m = c.match(/^([a-z_]+)\.gte\.(.+)$/))) return row[m[1]] != null && String(row[m[1]]) >= m[2];
    if ((m = c.match(/^([a-z_]+)\.is\.null$/))) return row[m[1]] == null;
    throw new Error('cláusula desconhecida: ' + c);
  });
}

const CASOS = [
  // [nome, row, esperado]
  ['Peterson: SEO da loja pendente, prazo 01/07 (>60d) → resolve', { status: 'pending', due_date: '2026-07-01' }, true],
  ['Peterson: post Instagram pendente, prazo 08/07 (>60d) → resolve', { status: 'pending', due_date: '2026-07-08' }, true],
  ['LA educa pendente vencida há mais de 60 dias → resolve', { status: 'pending', due_date: '2026-07-20' }, true],
  ['in_progress antiga → resolve', { status: 'in_progress', due_date: '2026-03-01' }, true],
  ['done antiga (>60d) → continua FORA (não confunde com fechada velha)', { status: 'done', due_date: '2026-07-01' }, false],
  ['cancelled antiga (>60d) → continua FORA', { status: 'cancelled', due_date: '2026-06-15' }, false],
  ['done recente (dentro de 60d) → continua dentro (comportamento atual)', { status: 'done', due_date: '2026-09-20' }, true],
  ['sem prazo → dentro (Item 2, comportamento atual)', { status: 'done', due_date: null }, true],
];

test('janela: 60 dias contados de agora, em YYYY-MM-DD', () => {
  assert.strictEqual(JANELA_FECHADAS_DIAS, 60);
  assert.strictEqual(DESDE, '2026-07-31');
});

for (const [nome, row, esperado] of CASOS) {
  test(`predicado: ${nome}`, () => {
    assert.strictEqual(entraNaJanelaShortId(row, DESDE), esperado);
  });
  test(`filtro PostgREST concorda com o predicado: ${nome}`, () => {
    assert.strictEqual(avaliaOr(filtroOrJanelaShortId(DESDE), row), esperado);
  });
}

test('filtro PostgREST: aberta de qualquer idade OU prazo recente OU sem prazo', () => {
  assert.strictEqual(filtroOrJanelaShortId('2026-07-31'), 'status.not.in.(done,cancelled),due_date.gte.2026-07-31,due_date.is.null');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: resolveTaskByShortId usa a janela nova nas tarefas pessoais E nas do grupo', () => {
  const ini = ENG.indexOf('async function resolveTaskByShortId(');
  assert.ok(ini > 0);
  const corpo = ENG.slice(ini, ENG.indexOf('\n}\n', ini));
  const usos = corpo.match(/\.or\(filtroOrJanelaShortId\(sinceIso\)\)/g) || [];
  assert.strictEqual(usos.length, 2, 'pessoais + grupo');
  assert.doesNotMatch(corpo, /\.or\(`due_date\.gte\.\$\{sinceIso\},due_date\.is\.null`\)/, 'filtro velho (só prazo) não pode voltar');
});

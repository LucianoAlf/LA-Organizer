'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { faltamNaFala, textoTambemFechei } = require('./fala-nomeia-concluidas');

// Rafinha 03/08 13:13 (1e546ccb): a fala real do TOM e as 5 tarefas que o banco fechou no turno.
const FALA = '✅ *Baixa em 5:*\n• Caixinha no lounge\n• Tomadas Campo Grande\n• Recreio e Barra — material de bateria\n• Casio Privia — rebote finalizado\n📅 *Reagendados pra sexta (07/08):*\n• Fone substituto — Sala 8 CG\n• 2 estantes de piano';
const FECHADAS = [
  'CAIXA STANER ( TROCA)',
  'Colocar 1 caixinha de som no lounge',
  'Repor tomadas — Campo Grande',
  'Ir no Recreio e na Barra — pegar material de bateria',
  'Rebote nas teclas — Casio Privia · Sala 10 Teclas Campo Grande',
];

test('Rafinha: das 5 fechadas, só a Caixa Staner ficou fora da fala', () => {
  assert.deepStrictEqual(faltamNaFala(FALA, FECHADAS), ['CAIXA STANER ( TROCA)']);
  assert.strictEqual(textoTambemFechei(['CAIXA STANER ( TROCA)']), '✅ Também fechei: *CAIXA STANER ( TROCA)*.');
});

test('fala que nomeia tudo não gera nada; título sem palavra julgável não acusa', () => {
  assert.deepStrictEqual(faltamNaFala('Fechei a caixa Staner da troca e o resto', ['CAIXA STANER ( TROCA)']), []);
  assert.deepStrictEqual(faltamNaFala('ok', ['A 1', 'de do']), []);
});

test('uma palavra em comum só não basta (título de 4 palavras, fala cita "Campo" de outra coisa)', () => {
  assert.deepStrictEqual(faltamNaFala('Caixinha no lounge em Campo', ['Repor tomadas — Campo Grande']), ['Repor tomadas — Campo Grande']);
});

test('título de uma palavra só precisa dessa palavra; repetido conta uma vez', () => {
  assert.deepStrictEqual(faltamNaFala('Arrumação feita', ['Arrumação', 'Arrumação']), []);
  assert.deepStrictEqual(faltamNaFala('Feito o relatório', ['Arrumação', 'Arrumação']), ['Arrumação']);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: guarda o título concluído, devolve e completa a fala que esqueceu', () => {
  assert.match(ENG, /console\.log\(`\[Task\] complete \$\{a\.id\} by \$\{last4\}`\);\n\s*_concluidasTit\.push\(/);
  assert.match(ENG, /concluidas: _concluidasTit \};/);
  assert.match(ENG, /const _faltamFala = faltamNaFala\(base, concluidas\);/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { avaliarPortas } = require('./portas-credenciais');

const D = (n) => ({ full_name: n, role: 'director', is_system_admin: true });
const SO_PWA = (n) => ({ full_name: n, role: 'director', is_system_admin: false });
const SO_TOM = (n) => ({ full_name: n, role: 'coordinator', is_system_admin: true });

test('estado de 04/09: os 3 batem nas duas portas', () => {
  const r = avaliarPortas([D('Hugo'), D('Luciano Alf'), D('Anne Susan')]);
  assert.strictEqual(r.status, 'ok');
  assert.match(r.detail, /3 pessoa/);
  assert.match(r.detail, /Hugo/);
});

test('director sem is_system_admin vira warning e diz o risco', () => {
  const r = avaliarPortas([D('Hugo'), SO_PWA('Novo Diretor')]);
  assert.strictEqual(r.status, 'warning');
  assert.strictEqual(r.samples.length, 1);
  assert.match(r.samples[0], /Novo Diretor/);
  assert.match(r.samples[0], /senhas na Governança/);
});

test('is_system_admin sem director tambem vira warning', () => {
  const r = avaliarPortas([D('Hugo'), SO_TOM('Alguem')]);
  assert.strictEqual(r.status, 'warning');
  assert.match(r.samples[0], /WhatsApp/);
});

test('as duas divergencias juntas sao contadas somadas', () => {
  const r = avaliarPortas([D('Hugo'), SO_PWA('A'), SO_TOM('B')]);
  assert.match(r.detail, /2 pessoa/);
  assert.strictEqual(r.samples.length, 2);
});

test('entradas degeneradas nao quebram nem inventam divergencia', () => {
  for (const entrada of [null, undefined, [], [null, undefined]]) {
    const r = avaliarPortas(entrada);
    assert.strictEqual(r.status, 'ok', String(entrada));
  }
});

test('is_system_admin ausente NAO conta como admin (fail-closed no sentido do alarme)', () => {
  // Coluna nula/ausente com role=director tem de acusar: o app libera, o TOM nao.
  const r = avaliarPortas([{ full_name: 'X', role: 'director' }]);
  assert.strictEqual(r.status, 'warning');
});

test('sem nome nao quebra a mensagem', () => {
  const r = avaliarPortas([{ role: 'director', is_system_admin: false }]);
  assert.match(r.samples[0], /\(sem nome\)/);
});

// PROVA DE WIRING — o modulo puro passa verde mesmo orfao. Foi assim que o
// FIN-RECEIPT-CONFIRM-NOOP (25/06) sobreviveu semanas: detector pronto, testes verdes,
// ninguem chamando. Aqui a fonte do health-check e lida pra provar que o check esta na lista.
const fs = require('node:fs');
const path = require('node:path');
const HC = fs.readFileSync(path.join(__dirname, '..', 'rituals', 'health-check.js'), 'utf8');

test('WIRING: o check esta declarado e dentro de ALL_CHECKS', () => {
  assert.ok(/async function checkPortasCredenciais\(/.test(HC),
    'checkPortasCredenciais sumiu do health-check');
  assert.ok(/require\('\.\.\/lib\/portas-credenciais'\)/.test(HC),
    'o health-check parou de usar este modulo — ele virou orfao');
  const i = HC.indexOf('const ALL_CHECKS = [');
  const fim = HC.indexOf('];', i);
  assert.ok(i !== -1 && fim !== -1, 'ALL_CHECKS nao encontrado');
  assert.ok(HC.slice(i, fim).includes("['portas_credenciais',"),
    'o check existe mas nao esta na lista que roda — nao chega no relatorio das 7h');
});

test('WIRING: erro de leitura vira error, nunca ok silencioso', () => {
  const i = HC.indexOf('async function checkPortasCredenciais(');
  const trecho = HC.slice(i, i + 900);
  assert.ok(/status: 'error'/.test(trecho),
    'sem a leitura ninguem sabe se divergiu — nao pode devolver ok');
});

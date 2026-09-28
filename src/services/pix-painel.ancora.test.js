'use strict';
// Âncora da rota do painel PIX: a porta é o LOGIN (Bearer) + podeVerGrupo, nunca o segredo do bundle.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'internal-api.js'), 'utf8');

test('rota /internal/pix-painel existe, usa atenderPainel e NÃO se contenta com o x-internal-secret', () => {
  const m = src.match(/router\.get\('\/internal\/pix-painel',([^\n]*)/);
  assert.ok(m, 'rota ausente');
  assert.ok(!/requireInternalSecret/.test(m[1]), 'o segredo vai no bundle: não pode ser a porta desta rota');
  assert.match(src, /atenderPainel\(\{/);
});
test('CORS deixa passar o Authorization (o painel manda o login da pessoa)', () => {
  assert.match(src, /Access-Control-Allow-Headers', 'Content-Type, x-internal-secret, Authorization'/);
});

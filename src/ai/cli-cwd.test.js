'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { conferirCwd } = require('./cli-cwd');

const novaPasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-cwd-teste-'));

test('pasta própria vazia → ok', () => {
  const base = novaPasta(); const d = path.join(base, 'cwd'); fs.mkdirSync(d);
  try { assert.deepStrictEqual(conferirCwd(d), { ok: true, dir: d }); } finally { fs.rmSync(base, { recursive: true }); }
});

test('incidente 04/10: AGENTS.md solto na pasta → falha fechado', () => {
  const d = novaPasta(); fs.writeFileSync(path.join(d, 'AGENTS.md'), 'Você é o Mike');
  try { const r = conferirCwd(d); assert.strictEqual(r.ok, false); assert.match(r.motivo, /não está vazio/); } finally { fs.rmSync(d, { recursive: true }); }
});

test('CLAUDE.md / AGENTS.md num ANCESTRAL também barra (o CLI sobe pelos ancestrais)', () => {
  for (const n of ['CLAUDE.md', 'AGENTS.md', '.claude']) {
    const base = novaPasta(); const d = path.join(base, 'cwd'); fs.mkdirSync(d);
    if (n === '.claude') fs.mkdirSync(path.join(base, n)); else fs.writeFileSync(path.join(base, n), 'x');
    try { const r = conferirCwd(d); assert.strictEqual(r.ok, false, n); assert.match(r.motivo, /arquivo de instrução no caminho/); } finally { fs.rmSync(base, { recursive: true }); }
  }
});

test('pasta ausente ou relativa → falha fechado (nunca cai pro /tmp)', () => {
  assert.strictEqual(conferirCwd('/nao/existe/tom-cli-cwd').ok, false);
  assert.strictEqual(conferirCwd('relativa').ok, false);
});

test('fiação: nenhum spawn de CLI de modelo usa os.tmpdir() como cwd; todos passam pela pasta conferida', () => {
  for (const f of ['claude.js', 'openai.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.doesNotMatch(src, /cwd:\s*os\.tmpdir\(\)/, f);
    assert.match(src, /cwdDoCli\(\)/, f);
  }
  const c = fs.readFileSync(path.join(__dirname, 'claude.js'), 'utf8');
  assert.strictEqual((c.match(/cwdDoCli\(\)/g) || []).length, 3);
});

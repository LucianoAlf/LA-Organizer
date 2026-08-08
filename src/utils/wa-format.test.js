'use strict';
// Testes do sanitizador markdown → WhatsApp.
//
// POR QUE ISSO EXISTE COM TESTE E NÃO SÓ COMO INSTRUÇÃO NO PROMPT
// O agente de ops é um LLM: markdown é o formato NATIVO dele. Pedir "não use markdown" no
// briefing reduz, não elimina — e a lição da casa é que prompt não é controle. Aqui o
// controle é determinístico: o que sai pro WhatsApp passa por esta função, sempre.

const test = require('node:test');
const assert = require('node:assert');
const { paraWhatsApp, dividirParaWhatsApp } = require('./wa-format');

// ── Negrito e títulos: o que mais estraga a leitura no celular ──────────────────
test('negrito markdown vira negrito do WhatsApp', () => {
  assert.strictEqual(paraWhatsApp('olha o **total** aqui'), 'olha o *total* aqui');
  assert.strictEqual(paraWhatsApp('***muito***'), '*muito*');
});

test('negrito do WhatsApp que já está certo não é mexido', () => {
  assert.strictEqual(paraWhatsApp('olha o *total* aqui'), 'olha o *total* aqui');
});

test('título markdown vira uma linha em negrito (# não renderiza no zap)', () => {
  assert.strictEqual(paraWhatsApp('## Auditoria de ontem'), '*Auditoria de ontem*');
  assert.strictEqual(paraWhatsApp('#### Detalhe'), '*Detalhe*');
});

test('título que já vinha em negrito não vira negrito duplo', () => {
  assert.strictEqual(paraWhatsApp('## **Achados**'), '*Achados*');
});

// ── Listas ──────────────────────────────────────────────────────────────────────
test('bullet de hífen/asterisco/mais vira •, preservando indentação', () => {
  assert.strictEqual(paraWhatsApp('- um\n* dois\n+ três'), '• um\n• dois\n• três');
  assert.strictEqual(paraWhatsApp('- pai\n  - filho'), '• pai\n  • filho');
});

test('lista numerada é preservada', () => {
  assert.strictEqual(paraWhatsApp('1. um\n2. dois'), '1. um\n2. dois');
});

// ── Tabela: ilegível no celular, vira linha ─────────────────────────────────────
test('tabela markdown vira linhas e a separadora some', () => {
  const md = '| Código | Casos |\n|---|---|\n| TASK-X | 4 |\n| CONF-Y | 2 |';
  assert.strictEqual(paraWhatsApp(md), 'Código — Casos\nTASK-X — 4\nCONF-Y — 2');
});

// ── Ruídos que aparecem literais no WhatsApp ────────────────────────────────────
test('crase simples some (WhatsApp não tem code inline)', () => {
  assert.strictEqual(paraWhatsApp('olha a `tom_known_issues`'), 'olha a tom_known_issues');
});

test('link markdown vira texto legível + url', () => {
  assert.strictEqual(paraWhatsApp('[o log](http://x.com/a)'), 'o log: http://x.com/a');
  assert.strictEqual(paraWhatsApp('[http://x.com](http://x.com)'), 'http://x.com');
});

test('riscado, citação e linha horizontal', () => {
  assert.strictEqual(paraWhatsApp('~~fora~~'), '~fora~');
  assert.strictEqual(paraWhatsApp('> citado'), 'citado');
  assert.strictEqual(paraWhatsApp('antes\n\n---\n\ndepois'), 'antes\n\ndepois');
});

test('excesso de linhas em branco colapsa', () => {
  assert.strictEqual(paraWhatsApp('a\n\n\n\n\nb'), 'a\n\nb');
});

// ── Bloco de código: o WhatsApp SUPORTA ``` — não pode ser mexido por dentro ─────
// Sem isso, um trecho de SQL colado pelo agente teria os hífens virados em bullet e o
// `**` de um ponteiro C trocado — corromperia a evidência que ele está mostrando.
test('conteúdo dentro de ``` é preservado byte a byte', () => {
  const src = 'olha:\n```\n- select **a** from `t`\n| x | y |\n```\nfim';
  assert.strictEqual(paraWhatsApp(src), 'olha:\n```\n- select **a** from `t`\n| x | y |\n```\nfim');
});

test('markdown fora do bloco ainda é convertido quando há bloco', () => {
  assert.strictEqual(paraWhatsApp('**a**\n```\n**b**\n```\n**c**'), '*a*\n```\n**b**\n```\n*c*');
});

// ── Entradas degeneradas: nunca lança ───────────────────────────────────────────
test('entrada vazia ou não-string devolve string', () => {
  for (const v of [null, undefined, '', 0, {}, []]) {
    assert.strictEqual(typeof paraWhatsApp(v), 'string');
  }
});

// ── Divisão em várias mensagens ─────────────────────────────────────────────────
// Truncar perderia justamente a conclusão da auditoria. Dividir não perde nada e o zap
// lê melhor 3 mensagens curtas que 1 tijolo.
test('texto curto sai em uma mensagem só', () => {
  assert.deepStrictEqual(dividirParaWhatsApp('oi', 100), ['oi']);
});

test('divide em parágrafo, sem estourar o limite e sem perder conteúdo', () => {
  const p = (n) => `${'x'.repeat(60)}#${n}`;
  const partes = dividirParaWhatsApp([p(1), p(2), p(3)].join('\n\n'), 130);
  assert.ok(partes.length > 1, 'deveria dividir');
  for (const parte of partes) assert.ok(parte.length <= 130, `parte de ${parte.length}`);
  for (const n of [1, 2, 3]) {
    assert.ok(partes.join('\n\n').includes(`#${n}`), `perdeu o parágrafo ${n}`);
  }
});

test('parágrafo único gigante é quebrado por linha e depois no braço', () => {
  const partes = dividirParaWhatsApp('y'.repeat(500), 100);
  assert.ok(partes.every((x) => x.length <= 100));
  assert.strictEqual(partes.join(''), 'y'.repeat(500));
});

test('nunca devolve parte vazia', () => {
  for (const parte of dividirParaWhatsApp('a\n\n\n\nb', 3)) {
    assert.ok(parte.trim().length > 0, 'parte vazia iria virar mensagem em branco no zap');
  }
});

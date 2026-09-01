// Trava: o ciclo nao pode dizer 'nada novo' tendo ficado cego. Ver audit-cegueira.js.
const { test } = require('node:test');
const assert = require('node:assert');
const { rebaixarNadaNovoComCegueira } = require('./audit-cegueira');

test('sem cegueira o texto passa INTACTO, byte por byte', () => {
  const t = 'Auditoria de 01/09 — nada novo. Fechei 3 achados.';
  const r = rebaixarNadaNovoComCegueira(t, 0);
  assert.strictEqual(r.texto, t);
  assert.strictEqual(r.rebaixou, false);
});

test('com cegueira a frase tranquilizadora CAI e a medida real entra', () => {
  const r = rebaixarNadaNovoComCegueira('Auditoria de 01/09 — nada novo.', 20);
  assert.strictEqual(r.rebaixou, true);
  assert.ok(!/nada novo[.]/.test(r.texto), 'a frase pelada nao pode sobreviver');
  assert.ok(r.texto.includes('20 conversas'), 'tem que dizer QUANTAS ficaram sem auditoria');
});

test('o numero de conversas cegas aparece no singular quando e uma so', () => {
  const r = rebaixarNadaNovoComCegueira('Nada novo por aqui.', 1);
  assert.ok(r.texto.includes('1 conversa:'), r.texto);
});

test('variantes da frase tambem caem', () => {
  for (const f of ['Sem achados novos.', 'Nenhum achado novo hoje.', 'Tudo limpo.', 'Nada a relatar.']) {
    const r = rebaixarNadaNovoComCegueira(f, 5);
    assert.strictEqual(r.rebaixou, true, f);
    assert.ok(r.texto.includes('5 conversas'), f);
  }
});

test('relatorio SEM a frase, mas com cegueira, ainda leva o aviso', () => {
  const r = rebaixarNadaNovoComCegueira('Fechei 2 achados e corrigi o dup-choice.', 7);
  assert.strictEqual(r.rebaixou, true);
  assert.ok(r.texto.startsWith('Fechei 2 achados'), 'o conteudo real nao pode sumir');
  assert.ok(r.texto.includes('7 conversas'));
});

test('entrada nao-string nao quebra', () => {
  assert.strictEqual(rebaixarNadaNovoComCegueira(null, 3).texto, '');
  assert.strictEqual(rebaixarNadaNovoComCegueira('x', null).rebaixou, false);
});

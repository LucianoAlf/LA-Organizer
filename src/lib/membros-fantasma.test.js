'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { comparaMembresia, resumirFantasmas } = require('./membros-fantasma');

const ALF = { full_name: 'Luciano Alf', phone: '5521999991234' };
const ROSE = { full_name: 'Rose', phone: '5521988885678' };

test('o caso real: quem saiu do WhatsApp e continua no app vira fantasma', () => {
  // 09/09: o Alf saiu da Barra e a agenda dele seguiu mostrando 27 anamneses do grupo.
  const r = comparaMembresia({
    noApp: [ALF, ROSE],
    participantesWa: ['5521988885678@s.whatsapp.net'],
  });
  assert.strictEqual(r.aferido, true);
  assert.deepStrictEqual(r.fantasmas, ['Luciano Alf']);
});

test('quem está nos dois lugares não é acusado', () => {
  const r = comparaMembresia({
    noApp: [ALF, ROSE],
    participantesWa: ['5521999991234@s.whatsapp.net', '5521988885678'],
  });
  assert.deepStrictEqual(r.fantasmas, []);
});

test('o 9o digito e o DDI nao podem gerar falso fantasma', () => {
  // As duas fontes escrevem o mesmo telefone de jeitos diferentes — por isso o casamento
  // e pelos 4 ultimos digitos.
  const r = comparaMembresia({
    noApp: [{ full_name: 'Jereh', phone: '+55 (21) 98888-5678' }],
    participantesWa: [{ id: '552188885678@s.whatsapp.net' }],
  });
  assert.deepStrictEqual(r.fantasmas, [], 'mesmo numero em formatos diferentes e a MESMA pessoa');
});

test('lista vazia do WhatsApp NAO acusa ninguem', () => {
  // Fail-closed: um dia ruim da API nao pode virar "o time inteiro saiu dos grupos".
  for (const p of [[], null, undefined]) {
    const r = comparaMembresia({ noApp: [ALF, ROSE], participantesWa: p });
    assert.strictEqual(r.aferido, false, 'sem lista confiavel, nao se afere');
    assert.deepStrictEqual(r.fantasmas, []);
  }
});

test('lista ilegivel tambem nao acusa', () => {
  const r = comparaMembresia({ noApp: [ALF], participantesWa: [{}, { foo: 'bar' }] });
  assert.strictEqual(r.aferido, false);
  assert.deepStrictEqual(r.fantasmas, []);
});

test('cadastro sem telefone nao da pra conferir — e nao acusa', () => {
  const r = comparaMembresia({
    noApp: [{ full_name: 'Sem Fone', phone: null }],
    participantesWa: ['5521988885678'],
  });
  assert.deepStrictEqual(r.fantasmas, []);
});

test('o texto do check nunca traz telefone', () => {
  const out = resumirFantasmas([
    { grupo: 'Administrativo e Comercial Barra', aferido: true, fantasmas: ['Luciano Alf'] },
    { grupo: 'ADM CG', aferido: true, fantasmas: [] },
  ]);
  assert.strictEqual(out.status, 'warning');
  assert.match(out.detail, /Luciano Alf/);
  assert.doesNotMatch(out.detail, /\d{4,}/, 'numero de telefone nunca entra em log nem em laudo');
});

test('tudo batendo = ok, e conta so o que foi aferido', () => {
  const out = resumirFantasmas([
    { grupo: 'A', aferido: true, fantasmas: [] },
    { grupo: 'B', aferido: true, fantasmas: [] },
    { grupo: 'C', aferido: false, fantasmas: [] },
  ]);
  assert.strictEqual(out.status, 'ok');
  assert.match(out.detail, /2 grupo\(s\)/, 'o nao aferido nao pode ser contado como conferido');
  assert.match(out.detail, /1 grupo\(s\) não aferido/);
});

test('entrada torta nunca lanca', () => {
  for (const e of [null, undefined, {}, { noApp: 'x' }, { noApp: [null, undefined] }]) {
    assert.doesNotThrow(() => comparaMembresia(e));
  }
  for (const e of [null, undefined, 'x', [null]]) {
    assert.doesNotThrow(() => resumirFantasmas(e));
  }
});

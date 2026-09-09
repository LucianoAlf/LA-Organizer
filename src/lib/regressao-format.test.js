'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { agruparPorSinal, formatarRegressoes } = require('./regressao-format');

// Os quatro KIs abaixo dividem o sinal `CONFIRM_NOEXEC` no acervo real (medido 09/09/2026):
// CONFIRM-DROP-COMPLETE-PARSE-ON-OPEN, CONFIRM-DROP-COORD-PARSE-ON-OPEN,
// CONFIRM-DROP-DELEG-PARSE-ON-OPEN e CONFIRM-RECADO-IMPLICITO-DROPA. Cada um consulta o mesmo
// marker_logs e recebe a mesma contagem.
const QUATRO_IRMAOS = [
  { codigo: 'CONFIRM-DROP-COMPLETE-PARSE-ON-OPEN', titulo: 'a', corrigido_em: '2026-08-01T00:00:00Z', ocorrencias_novas: 3, afetados: ['Rafinha'], sinal_padrao: 'CONFIRM_NOEXEC' },
  { codigo: 'CONFIRM-DROP-COORD-PARSE-ON-OPEN', titulo: 'b', corrigido_em: '2026-08-02T00:00:00Z', ocorrencias_novas: 3, afetados: ['Yuri'], sinal_padrao: 'CONFIRM_NOEXEC' },
  { codigo: 'CONFIRM-DROP-DELEG-PARSE-ON-OPEN', titulo: 'c', corrigido_em: '2026-08-03T00:00:00Z', ocorrencias_novas: 3, afetados: ['Rafinha'], sinal_padrao: 'CONFIRM_NOEXEC' },
  { codigo: 'CONFIRM-RECADO-IMPLICITO-DROPA', titulo: 'd', corrigido_em: '2026-08-04T00:00:00Z', ocorrencias_novas: 3, afetados: [], sinal_padrao: 'CONFIRM_NOEXEC' },
];

test('quatro KIs no mesmo sinal viram UM alarme, não quatro', () => {
  const g = agruparPorSinal(QUATRO_IRMAOS);
  assert.strictEqual(g.length, 1, 'um disparo de porta é um evento, não quatro');
  assert.strictEqual(g[0].codigos.length, 4, 'os quatro seguem listados como suspeitos');
});

test('a contagem NÃO é somada entre irmãos', () => {
  // Somar daria 12 para 3 eventos reais. Cada KI consultou o mesmo marker_logs.
  const g = agruparPorSinal(QUATRO_IRMAOS);
  assert.strictEqual(g[0].ocorrencias, 3, 'somar inventaria eventos que não aconteceram');
});

test('o texto nomeia a PORTA e trata os KIs como suspeitos', () => {
  const r = formatarRegressoes(QUATRO_IRMAOS);
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /CONFIRM_NOEXEC/, 'quem disparou foi o sinal — é ele que tem que aparecer');
  assert.match(r.detail, /4 KIs corrigidos usam este sinal/,
    'com irmãos, o alarme não pode eleger um culpado');
  assert.match(r.detail, /CONFIRME o turno/,
    'disparo é fato, regressão é hipótese: o texto tem que pedir a confirmação');
});

test('KI sozinho no sinal continua nomeado, com a data do conserto', () => {
  const um = [{ codigo: 'PROMISE-DOWNGRADE-REBAIXA-ADMISSAO', titulo: 't', corrigido_em: '2026-08-31T11:00:00Z', ocorrencias_novas: 3, afetados: ['Rafinha', 'Yuri'], sinal_padrao: 'CHOKEPOINT confab:promise_nomarker' }];
  const r = formatarRegressoes(um);
  assert.match(r.detail, /PROMISE-DOWNGRADE-REBAIXA-ADMISSAO \(corrigido 31\/08\)/);
  assert.match(r.detail, /Rafinha, Yuri/);
  assert.match(r.detail, /disparou 3×/);
});

test('afetados de irmãos diferentes se juntam sem repetir', () => {
  const g = agruparPorSinal(QUATRO_IRMAOS);
  assert.deepStrictEqual(g[0].afetados.sort(), ['Rafinha', 'Yuri']);
});

test('sem sinal declarado, cada KI é seu próprio grupo', () => {
  // Não dá pra afirmar que dois KIs sem sinal compartilham mecanismo.
  const semSinal = [
    { codigo: 'A', titulo: 'a', ocorrencias_novas: 1, afetados: [], sinal_padrao: null },
    { codigo: 'B', titulo: 'b', ocorrencias_novas: 1, afetados: [], sinal_padrao: null },
  ];
  assert.strictEqual(agruparPorSinal(semSinal).length, 2);
});

test('nada disparou = ok, e o texto não fala em regressão', () => {
  const r = formatarRegressoes([]);
  assert.strictEqual(r.status, 'ok');
  assert.doesNotMatch(r.detail, /regress/i);
});

test('entrada torta nunca lança', () => {
  for (const e of [null, undefined, 'x', [null], [{}], [{ codigo: 'A' }]]) {
    assert.doesNotThrow(() => formatarRegressoes(e));
  }
  assert.strictEqual(agruparPorSinal([{ codigo: 'A' }])[0].ocorrencias, 0);
});

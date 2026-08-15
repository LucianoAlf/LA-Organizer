// src/lib/confere-numero.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { conferirNumerosAfirmados, extrairAfirmacoes } = require('./confere-numero');

// O incidente: relatório de 10/08 somou "1 + 9" e escreveu 10; eram 11. Ninguém confere o
// número que o agente afirma — a trava textual não pega, porque ele não declara cegueira,
// simplesmente afirma errado com confiança.
test('acusa divergência entre o afirmado e a fonte', () => {
  const r = conferirNumerosAfirmados('Fechei o ciclo: 10 achados no acervo.', { achados: 11 });
  assert.strictEqual(r.divergiu, true);
  assert.match(r.texto, /11/);
  assert.match(r.texto, /confere/i);
});

test('bate com a fonte → texto intacto', () => {
  const t = 'Fechei o ciclo: 11 achados no acervo.';
  const r = conferirNumerosAfirmados(t, { achados: 11 });
  assert.strictEqual(r.divergiu, false);
  assert.strictEqual(r.texto, t);
});

// "Falha ao consultar a fonte devolve indefinido, nunca 'conferido'" — inventar ok aqui
// seria repetir a doença que a trava combate.
test('fonte indisponível NÃO vira conferido', () => {
  const r = conferirNumerosAfirmados('3 achados hoje.', { achados: null });
  assert.strictEqual(r.divergiu, false);
  assert.strictEqual(r.conferido, false);
});

// Ignorar data, dinheiro, percentual e hora — senão compara o dia do mês com uma contagem.
test('não confunde data, dinheiro, percentual e hora com contagem', () => {
  const achados = extrairAfirmacoes('Em 13/08 gastei R$ 250,00 (12% do teto) às 14h. 3 achados.');
  assert.deepStrictEqual(achados.map((a) => a.n), [3]);
});

test('pega as formas comuns: "N achados", "corrigi N", "N corrigidos"', () => {
  assert.strictEqual(extrairAfirmacoes('7 achados').length, 1);
  assert.strictEqual(extrairAfirmacoes('corrigi 2 known issues')[0].n, 2);
  assert.strictEqual(extrairAfirmacoes('2 corrigidos hoje')[0].n, 2);
});

test('entrada vazia não quebra', () => {
  for (const v of [null, undefined, '', 7]) {
    assert.strictEqual(conferirNumerosAfirmados(v, {}).divergiu, false);
  }
});

// GOVAGENT-CONFERE-RECORTE-VIRA-FALSO-ALARME (15/08). O relatório real escreveu:
//   "não fechei em lote os 65 achados de frustration + 'não consegui registrar'"
// A fonte de `achados` é o ACERVO INTEIRO (tom_audit_findings status novo/confirmado = 159).
// A trava comparou o recorte com o total, gritou "não bateu" e ainda cravou no rodapé
// "o erro é o dado" — quando o 65 estava CERTO (medido: 45 frustration + 21 "não consegui
// registrar" = 66 hoje). Alarme falso é pior que trava muda: ensina o dono a ignorar o aviso,
// e o aviso é o que faz o agente continuar com a mão no código.
//
// Regra: número seguido de preposição de recorte ("de/da/do/com/sem/em"...) fala de um
// SUBCONJUNTO, e a trava não tem fonte pra esse recorte — mesma situação de fonte ausente,
// mesma resposta: abster. Não é abrandar a trava; é não afirmar o que não se mediu.
test('não acusa quando o número é um RECORTE do acervo', () => {
  const r = conferirNumerosAfirmados(
    "não fechei em lote os 65 achados de frustration + \"não consegui registrar\"",
    { achados: 159 },
  );
  assert.strictEqual(r.divergiu, false);
  assert.doesNotMatch(r.texto, /Confere não bateu/);
});

// A contrapartida: a trava tem que continuar viva pro claim SEM recorte. Se o fix mudo
// qualquer "N achados", ele vira decoração — o pecado que a camada 2 já cometeu em 14/08.
test('continua acusando o total afirmado sem recorte', () => {
  const r = conferirNumerosAfirmados('Acervo: 10 achados abertos.', { achados: 159 });
  assert.strictEqual(r.divergiu, true);
  assert.match(r.texto, /o texto diz 10, a fonte tem 159/);
});

test('recorte não contamina outra afirmação no mesmo texto', () => {
  const r = conferirNumerosAfirmados('Sobraram 65 achados de frustration. Total: 10 achados.', { achados: 159 });
  assert.strictEqual(r.divergiu, true);
  assert.strictEqual(r.conflitos.length, 1);
  assert.strictEqual(r.conflitos[0].afirmado, 10);
});

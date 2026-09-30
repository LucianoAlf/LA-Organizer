'use strict';
// Turno real: Ana Paula, 1:1, 11/09/2026 00:37 UTC — ver cabeçalho de criadas-vs-puladas.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { relatoCriadasEPuladas } = require('./criadas-vs-puladas');

const EXISTENTE = 'Semana de provas - Faculdade';
const PULADAS_ANA = ['26/09', '27/09', '28/09', '29/09', '30/09'].map((d) => ({ titulo: `Semana de provas - Faculdade · ${d}`, criada: false, existente: EXISTENTE, idadeMin: 2 }));

test('turno real da Ana: 5 puladas, 0 criadas — some o "✅ Criando nos 5 dias" e entra o porquê', () => {
  const r = relatoCriadasEPuladas('✅ Criando nos 5 dias, te lembro às 12h em cada um!', PULADAS_ANA);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.texto,
    'Nada novo foi criado:\n'
    + '↩️ Não criei *Semana de provas - Faculdade · 26/09*, *Semana de provas - Faculdade · 27/09*, *Semana de provas - Faculdade · 28/09*, *Semana de provas - Faculdade · 29/09* e *Semana de provas - Faculdade · 30/09* — já existe *Semana de provas - Faculdade* (criada há 2 min), e eu não duplico.');
  assert.ok(!/Criando|criad[ao]s? nos/i.test(r.texto.split('\n')[0]));
});

test('lote misto com item DIFERENTE comido: a criada fica "criada", a pulada diz que foi pulada e por quê', () => {
  const r = relatoCriadasEPuladas('✅ Anotei as duas!', [
    { titulo: 'Pagar boleto da luz', criada: true },
    { titulo: 'Trocar lâmpada do corredor do estúdio', criada: false, existente: 'Trocar lâmpada do bistrô', idadeMin: 3 },
  ]);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.texto, '✅ *Pagar boleto da luz* — criada\n↩️ Não criei *Trocar lâmpada do corredor do estúdio* — já existe *Trocar lâmpada do bistrô* (criada há 3 min), e eu não duplico.');
});

test('REPLAY 60d — re-emit do MESMO item (Krissya 29/09): a fala é verdadeira e fica; só entra o aviso', () => {
  const fala = 'Confirmado! Delegado pro Arthur: *ligar para a Gisele* — quarta às 11h30.';
  const r = relatoCriadasEPuladas(fala, [{ titulo: 'Ligar para a Gisele', criada: false, existente: 'Ligar para a Gisele', idadeMin: 2 }]);
  assert.strictEqual(r.texto, fala + '\n↩️ *Ligar para a Gisele* já estava anotada (criada há 2 min) — não criei de novo.');
});

test('a linha que só fala das criadas é verdadeira e fica; o resto da fala (pergunta) fica', () => {
  const r = relatoCriadasEPuladas('✅ Anotado: *Pagar boleto da luz*\nQuer que eu te lembre amanhã?', [
    { titulo: 'Pagar boleto da luz', criada: true },
    { titulo: 'Ligar pro contador', criada: false, existente: 'Ligar pro contador', idadeMin: 0 },
  ]);
  assert.strictEqual(r.texto, '✅ Anotado: *Pagar boleto da luz*\nQuer que eu te lembre amanhã?\n↩️ *Ligar pro contador* já estava anotada (criada agora há pouco) — não criei de novo.');
});

test('controles: sem pulada não mexe; fala que não afirma registro não mexe', () => {
  assert.strictEqual(relatoCriadasEPuladas('✅ Criei!', [{ titulo: 'X', criada: true }]).fired, false);
  assert.strictEqual(relatoCriadasEPuladas('Beleza, qualquer coisa me chama.', PULADAS_ANA).fired, false);
});

test('fala vazia com pulada: o resultado por item vira a resposta', () => {
  const r = relatoCriadasEPuladas('', [{ titulo: 'X', criada: false, existente: 'X', idadeMin: 1 }]);
  assert.strictEqual(r.texto, '↩️ *X* já estava anotada (criada há 1 min) — não criei de novo.');
});

// Contrato da fiação no engine.
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: o SELF_RECENT_SKIP registra o item pulado antes do okCount++; a criação registra a criada', () => {
  const ini = ENGINE.indexOf('if (_selfRecent) {');
  const trecho = ENGINE.slice(ini, ENGINE.indexOf('continue;', ini));
  assert.match(trecho, /_itensCriacao\.push\(\{[^}]*criada: false/);
  assert.match(ENGINE, /_itensCriacao\.push\(\{ titulo: insertRow\.title, criada: true \}\)/);
  assert.match(ENGINE, /relatoCriadasEPuladas\(base, itensCriacao\)/);
});

// src/lib/restart-so-do-runner.test.js
// Rodar: node --test src/lib/restart-so-do-runner.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { tirarFalaDeRestart } = require('./restart-so-do-runner');

// O caso literal do grupo (13/08 e 15/08): as duas falas entram como role='tom' e o dono lê
// uma voz só se contradizendo. O achado c4a74feb nasceu exatamente deste par.
test('tira a negação de restart do relatório do agente', () => {
  const r = tirarFalaDeRestart(
    'Relatório postado no grupo em 2 mensagens via postOpsResult. *Não reiniciei o TOM* — o restart é do gov-runner.',
  );
  assert.strictEqual(r.removeu, true);
  assert.doesNotMatch(r.texto, /reiniciei/i);
  assert.match(r.texto, /Relatório postado no grupo em 2 mensagens/); // o resto fica intacto
});

// A metade que a regra de 09/08 já proibia. Continua caindo aqui, agora sem depender de o
// LLM lembrar da regra.
test('tira também a AFIRMAÇÃO de restart', () => {
  const r = tirarFalaDeRestart('Fix no ar. Reiniciei o TOM logo depois do commit.');
  assert.strictEqual(r.removeu, true);
  assert.doesNotMatch(r.texto, /reiniciei/i);
  assert.match(r.texto, /Fix no ar/);
});

// A LINHA DO RUNNER TEM QUE SOBREVIVER. É a única prova de entrega que o grupo recebe, e
// passa pelo mesmo `postar`. Regra ingênua ("apaga tudo que fala de restart") mataria a prova
// junto com a contradição — trocaria um problema de clareza por um de cegueira.
test('NÃO toca na linha do gov-runner (impessoal)', () => {
  const linha = '♻️ TOM reiniciado, o fix está no ar (src/engine.js, src/finance/confirm-precedence.js).';
  const r = tirarFalaDeRestart(linha);
  assert.strictEqual(r.removeu, false);
  assert.strictEqual(r.texto, linha);
});

test('não toca em texto que fala do restart em 3ª pessoa', () => {
  const t = 'O restart é do gov-runner, que compara os arquivos e chama o pm2.';
  const r = tirarFalaDeRestart(t);
  assert.strictEqual(r.removeu, false);
  assert.strictEqual(r.texto, t);
});

test('relatório sem menção a restart sai intacto', () => {
  const t = 'Correção (1): achado ac56c043. Varredura: 3 fechados.';
  assert.strictEqual(tirarFalaDeRestart(t).texto, t);
  assert.strictEqual(tirarFalaDeRestart(t).removeu, false);
});

test('entrada vazia ou inválida não quebra', () => {
  assert.strictEqual(tirarFalaDeRestart('').texto, '');
  assert.strictEqual(tirarFalaDeRestart(null).texto, '');
  assert.strictEqual(tirarFalaDeRestart(undefined).removeu, false);
});

'use strict';
// O RESTART NÃO PODE FICAR COM O LLM.
//
// Primeira rodada autônoma (09/08 08:21): o agente fez um conserto legítimo em
// optimistic-confirm.js, commitou (f368e3b), e escreveu no grupo "restart do TOM disparado
// desacoplado". O processo tinha 12h de uptime — o restart NÃO aconteceu. O fix ficou no
// disco, fora do processo, e o grupo foi informado de que estava no ar.
//
// A ETAPA 7 do protocolo manda ele disparar o restart desacoplado justamente porque é filho
// do processo que reiniciaria. Só que "desacoplado" é frágil por natureza e, pior, o LLM
// relata sucesso sem verificar. Aqui a decisão vira código: o runner compara o que mudou e
// reinicia sozinho, depois de postar.

const test = require('node:test');
const assert = require('node:assert');
const { decidirRestart, novosEmRelacaoA } = require('./gov-runner');

test('mudou código em src/ → reinicia', () => {
  const r = decidirRestart({ arquivosMudados: ['src/lib/optimistic-confirm.js'] });
  assert.strictEqual(r.restart, true);
  assert.strictEqual(r.motivo, 'codigo_mudou');
});

test('só doc/teste mudou → não reinicia (não muda o que roda)', () => {
  for (const f of [['docs/ops/PEDIDOS-DE-PRODUTO.md'], ['src/lib/foo.test.js'], []]) {
    assert.strictEqual(decidirRestart({ arquivosMudados: f }).restart, false, JSON.stringify(f));
  }
});

test('doc + código junto → reinicia', () => {
  assert.strictEqual(decidirRestart({
    arquivosMudados: ['docs/ops/ESCADA-GOVERNANCA.md', 'src/engine.js'],
  }).restart, true);
});

// Sem esta trava o agente derruba o TOM: pm2 entra em crash-loop e ninguém é atendido.
// É o único desfecho pior do que o fix não subir.
test('sintaxe quebrada → NÃO reinicia, mesmo com código mudado', () => {
  const r = decidirRestart({ arquivosMudados: ['src/engine.js'], sintaxeOk: false });
  assert.strictEqual(r.restart, false);
  assert.strictEqual(r.motivo, 'sintaxe_quebrada');
});

test('entrada degenerada não decide reiniciar por acidente', () => {
  for (const e of [{}, { arquivosMudados: null }, { arquivosMudados: 'src/x.js' }]) {
    assert.strictEqual(decidirRestart(e).restart, false, JSON.stringify(e));
  }
});

test('só conta .js de src/ — mexer em skills/ ou soul/ é violação, não deploy', () => {
  assert.strictEqual(decidirRestart({ arquivosMudados: ['skills/foo.md', 'soul/SOUL.md'] }).restart, false);
});

// SUJEIRA PRÉ-EXISTENTE NÃO É MUDANÇA DO CICLO.
// A VPS tem um `src/system.js` órfão (234KB, untracked, parado desde 03/08 — cópia velha de
// prompts/system.js que ninguém carrega). `git status` o reporta sempre. Sem descontar o que
// já estava sujo ANTES, todo ciclo concluiria "mudou código" e reiniciaria o TOM à toa,
// todo dia, por causa de um arquivo que ninguém tocou.
test('arquivo já sujo antes do ciclo não conta como mudança', () => {
  const antes = ['src/system.js', '.env'];
  assert.deepStrictEqual(novosEmRelacaoA(['src/system.js', '.env'], antes), []);
  assert.deepStrictEqual(novosEmRelacaoA(['src/system.js', 'src/engine.js'], antes), ['src/engine.js']);
});

test('sem lista do "antes", tudo que está sujo conta (primeira execução)', () => {
  assert.deepStrictEqual(novosEmRelacaoA(['src/engine.js'], []), ['src/engine.js']);
  assert.deepStrictEqual(novosEmRelacaoA(['src/engine.js'], null), ['src/engine.js']);
});

test('o órfão da VPS sozinho NÃO dispara restart', () => {
  const novos = novosEmRelacaoA(['src/system.js'], ['src/system.js']);
  assert.strictEqual(decidirRestart({ arquivosMudados: novos }).restart, false);
});

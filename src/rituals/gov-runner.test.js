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

// ── INTERRUPÇÃO NO MEIO DO CICLO ───────────────────────────────────────────────────────────
// O ops-agent registra um drain hook que avisa o grupo sobre pedido perdido no restart. No
// processo do TOM isso funciona porque o index.js instala o graceful shutdown, que roda os
// hooks. O runner é OUTRO processo e não instalava nada: nem canal de aviso, nem handler de
// sinal. `pm2 restart`/deploy no meio do ciclo (até 30 min de Opus 5) matava tudo sem uma
// linha pro grupo — o mesmo desfecho silencioso que a ETAPA 7 existe pra evitar.
const opsAgent = require('../services/ops-agent');
const { instalarAvisoDeInterrupcao } = require('./gov-runner');

test('o runner liga o canal: interrupção no meio do ciclo vira mensagem no grupo', async () => {
  const postadas = [];
  const solto = instalarAvisoDeInterrupcao((t) => { postadas.push(t); return { id: 'm1' }; });
  const id = opsAgent._registrarPedido('o ciclo automático de governança', 'rode o ciclo de hoje');
  const r = await opsAgent.avisarPedidosPerdidos();
  opsAgent._concluirPedido(id);
  solto();
  assert.strictEqual(r.avisou, true, 'o ciclo morreu calado');
  assert.match(postadas[0], /ciclo autom/);
});

test('o runner instala handler de sinal — sem ele o drain hook nasce órfão', () => {
  const antes = process.listenerCount('SIGTERM');
  const solto = instalarAvisoDeInterrupcao(() => ({ id: 'm1' }));
  assert.ok(process.listenerCount('SIGTERM') > antes,
    'sem handler de SIGTERM o processo morre antes de qualquer drain');
  solto();
  assert.strictEqual(process.listenerCount('SIGTERM'), antes, 'deixou listener pendurado');
});

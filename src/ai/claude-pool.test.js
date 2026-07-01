// Rodar: node --test src/ai/claude-pool.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { createSemaphore, decideRefreshMode, workerHomePath, needsCredSync, shouldRefreshCanon } = require('./claude-pool');

test('semaphore: dá lease até K, o (K+1)-ésimo espera até um release', async () => {
  const sem = createSemaphore(['/h/w0', '/h/w1']);
  const a = await sem.acquire();
  const b = await sem.acquire();
  assert.notStrictEqual(a.index, b.index, 'leases distintos');
  assert.strictEqual(sem.available(), 0);
  let cResolved = false;
  const cP = sem.acquire().then((s) => { cResolved = true; return s; });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(cResolved, false, 'o 3º fica pendente com pool cheio');
  sem.release(a);
  const c = await cP;
  assert.strictEqual(c.home, a.home, 'o waiter recebe o slot liberado');
});

test('decideRefreshMode: pool quando há folga, canon quando perto de expirar', () => {
  const now = 1_000_000;
  const slack = 30 * 60 * 1000;
  assert.strictEqual(decideRefreshMode(now + 2 * 60 * 60 * 1000, now, slack), 'pool');
  assert.strictEqual(decideRefreshMode(now + 10 * 60 * 1000, now, slack), 'canon');
  assert.strictEqual(decideRefreshMode(0, now, slack), 'canon', 'sem expiresAt → canon (seguro)');
});

test('shouldRefreshCanon: refresca proativamente dentro da margem, deixa quieto com folga', () => {
  const now = 10_000_000;
  const margin = 60 * 60 * 1000; // 60 min
  // token com folga (2h) → NÃO refresca (deixa a chamada real refrescar por carona)
  assert.strictEqual(shouldRefreshCanon(now + 2 * 60 * 60 * 1000, now, margin), false);
  // token vence em 45min (< margem) → refresca AGORA, antes de morrer
  assert.strictEqual(shouldRefreshCanon(now + 45 * 60 * 1000, now, margin), true);
  // exatamente na margem (60min) → NÃO (ainda há folga = margem)
  assert.strictEqual(shouldRefreshCanon(now + margin, now, margin), false);
  // token já expirado → refresca (tenta ressuscitar; o certo é nunca chegar aqui)
  assert.strictEqual(shouldRefreshCanon(now - 1000, now, margin), true);
  // sem expiresAt (0/null/undefined) → refresca (seguro, não sabemos a validade)
  assert.strictEqual(shouldRefreshCanon(0, now, margin), true);
  assert.strictEqual(shouldRefreshCanon(null, now, margin), true);
  assert.strictEqual(shouldRefreshCanon(undefined, now, margin), true);
});

test('workerHomePath: deriva .claude-tom-w{i} ao lado do CANON', () => {
  assert.strictEqual(workerHomePath('/opt/LA-Organizer/.claude-tom', 0), '/opt/LA-Organizer/.claude-tom-w0');
  assert.strictEqual(workerHomePath('/opt/LA-Organizer/.claude-tom', 1), '/opt/LA-Organizer/.claude-tom-w1');
});

test('needsCredSync: copia se destino não existe ou está mais velho', () => {
  assert.strictEqual(needsCredSync(100, null), true, 'destino ausente → copia');
  assert.strictEqual(needsCredSync(100, 50), true, 'destino mais velho → copia');
  assert.strictEqual(needsCredSync(100, 100), false, 'igual → não copia');
  assert.strictEqual(needsCredSync(100, 200), false, 'destino mais novo → não copia');
});

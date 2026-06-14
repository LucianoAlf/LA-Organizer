const { test } = require('node:test');
const assert = require('node:assert');

test('getApiKey autentica 1x e cacheia (2ª chamada não chama fetch de novo)', async () => {
  let calls = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ apiKey: 'KEY123' }) }; };
  delete require.cache[require.resolve('./pluggy')];
  process.env.PLUGGY_CLIENT_ID = 'x'; process.env.PLUGGY_CLIENT_SECRET = 'y';
  const { getApiKey } = require('./pluggy');
  const k1 = await getApiKey();
  const k2 = await getApiKey();
  global.fetch = realFetch;
  assert.equal(k1, 'KEY123');
  assert.equal(k2, 'KEY123');
  assert.equal(calls, 1);
});

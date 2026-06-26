'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildHonestRedirect } = require('./finance-honest-redirect');
const { resolveFinanceCapability } = require('./finance-capability');

const NO_RECENT = { reason: 'no_recent_target', redirect: { app_path: 'Finanças → Transações → toque no lançamento', why: 'fora das ~2h que eu alcanço pra editar pelo chat' } };
const AMBIG = { reason: 'ambiguous_target', redirect: { app_path: 'Finanças → Transações' } };

test('linha honesta tem caminho do app e NÃO é robótica', () => {
  const l = buildHonestRedirect(NO_RECENT);
  assert.match(l, /Finanças → Transações/);
  assert.doesNotMatch(l, /fora da janela permitida|opera[çc][ãa]o inv[áa]lida|n[ãa]o autorizad/i); // linha vermelha
  assert.ok(l.length > 30);
});
test('linha honesta NÃO inventa "não existe comando" nem "mais de 2 dias"', () => {
  const l = buildHonestRedirect(NO_RECENT);
  assert.doesNotMatch(l, /n[ãa]o existe o comando|mais de \d+ dias|n[ãa]o tenho como/i);
});
test('ambíguo pede qual, sem recusar', () => {
  const l = buildHonestRedirect(AMBIG);
  assert.match(l, /qual|valor|data/i);
  assert.doesNotMatch(l, /n[ãa]o (consigo|posso|d[áa])/i);
});
test('tem tom caloroso (emoji/colloquial, referência launch_confirm)', () => {
  assert.match(buildHonestRedirect(NO_RECENT), /👍|🙂|me chama|rapidinho|segundos/i);
});
test('E2E resolver→builder: SEM instrução duplicada (review de voz 24/06)', () => {
  // o defeito era app_path terminar em "toque no lançamento" + o builder anexar "toca nele".
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [] });
  const line = buildHonestRedirect(v);
  const hits = (line.match(/to(?:que|ca) no lan[çc]amento/gi) || []).length;
  assert.equal(hits, 1, 'instrução de "toque no lançamento" duplicada: ' + line);
});

// src/lib/sync-excuse-guard.test.js
// Rede determinística anti-confab de CAUSA: TOM inventava "delay de sincronização" pra
// justificar atrasada (caso Matheus 22/06). Banco é ao vivo; só FATURA sincroniza.
const { test } = require('node:test');
const assert = require('node:assert');
const { hasSyncExcuse, isInvoiceContext, stripSyncExcuse, enforceNoSyncExcuse } = require('./sync-excuse-guard');

test('frase do Matheus: detecta e remove a desculpa de sincronização', () => {
  const t = 'Entendido, vacilo meu — não cobro mais. Se o banco ainda mostra atrasado aqui do meu lado, é delay de sincronização. Fica tranquilo.';
  assert.strictEqual(hasSyncExcuse(t), true);
  const out = enforceNoSyncExcuse(t);
  assert.ok(!/sincroniz/i.test(out), 'removeu a menção a sincronização');
  assert.ok(/não cobro mais/.test(out), 'manteve o resto da frase');
  assert.ok(/Fica tranquilo/.test(out));
});

test('fatura (Open Finance): NÃO mexe — sincronização é legítima', () => {
  const t = '⚠️ A fatura deste mês ainda tá sincronizando com o banco (Open Finance) — costuma cair em 1-3 dias.';
  assert.strictEqual(isInvoiceContext(t), true);
  assert.strictEqual(enforceNoSyncExcuse(t), t);
});

test('falso-positivo: "sincronizei com o Quintela" não dispara', () => {
  const t = '✅ Sincronizei com o Quintela sobre a agenda da semana.';
  assert.strictEqual(hasSyncExcuse(t), false);
  assert.strictEqual(enforceNoSyncExcuse(t), t);
});

test('variante "demora a atualizar"', () => {
  const t = 'Pode ser que o sistema demora a atualizar. Tenta de novo.';
  assert.strictEqual(hasSyncExcuse(t), true);
  assert.ok(!/demora/i.test(enforceNoSyncExcuse(t)));
});

test('texto comum: inalterado', () => {
  const t = '✅ Fechado: *Reunião com a Bia*.';
  assert.strictEqual(enforceNoSyncExcuse(t), t);
});

test('vazio/não-string: no-op seguro', () => {
  assert.strictEqual(enforceNoSyncExcuse(''), '');
  assert.strictEqual(enforceNoSyncExcuse(null), null);
  assert.strictEqual(enforceNoSyncExcuse(undefined), undefined);
});

const { test } = require('node:test');
const assert = require('node:assert');
const { accountKind, daysAgo } = require('./pluggy-sync');

test('accountKind: CREDIT → card; BANK/outros → account', () => {
  assert.equal(accountKind({ type: 'CREDIT' }), 'card');
  assert.equal(accountKind({ type: 'BANK' }), 'account');
  assert.equal(accountKind({ type: 'bank' }), 'account');
});

test('daysAgo: subtrai dias em YMD', () => {
  assert.equal(daysAgo('2026-06-14', 60), '2026-04-15');
  assert.equal(daysAgo('2026-01-01', 1), '2025-12-31');
});

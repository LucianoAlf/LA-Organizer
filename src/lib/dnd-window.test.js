'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { validateDndWindow, DND_MAX_MS } = require('./dnd-window');

// âncora fixa (Date.now do turno do Jhonatan, 25/06 23:42 UTC)
const NOW = Date.parse('2026-06-25T23:42:00Z');

test('futuro válido (<24h) → ok, until preservado, reason trim', () => {
  const r = validateDndWindow('2026-06-26T11:00:00Z', '  silêncio  ', NOW); // ~11h depois
  assert.equal(r.ok, true);
  assert.equal(r.until, '2026-06-26T11:00:00Z');
  assert.equal(r.capped, false);
  assert.equal(r.reason, 'silêncio');
});

test('passado / dentro de +60s → not_future', () => {
  assert.equal(validateDndWindow('2026-06-25T23:00:00Z', null, NOW).code, 'not_future');
  assert.equal(validateDndWindow('2026-06-25T23:42:30Z', null, NOW).ok, false);
});

test('>24h → capado a 24h (anti "pausado até julho")', () => {
  const r = validateDndWindow('2026-07-15T10:00:00Z', null, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.capped, true);
  assert.equal(r.until, new Date(NOW + DND_MAX_MS).toISOString());
});

test('bad iso / não-string → bad_iso (paridade com parseDndMarker)', () => {
  assert.equal(validateDndWindow('amanhã 9h', null, NOW).code, 'bad_iso');
  assert.equal(validateDndWindow(123, null, NOW).code, 'bad_iso');
  assert.equal(validateDndWindow(null, null, NOW).code, 'bad_iso');
});

test('reason: cap 80, não-string → null', () => {
  assert.equal(validateDndWindow('2026-06-26T11:00:00Z', 'x'.repeat(100), NOW).reason.length, 80);
  assert.equal(validateDndWindow('2026-06-26T11:00:00Z', 42, NOW).reason, null);
});

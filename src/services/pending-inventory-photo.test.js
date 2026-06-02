const { test } = require('node:test');
const assert = require('node:assert');
const photo = require('./pending-inventory-photo');

test('set + get devolve a foto pendente do telefone', () => {
  photo.clear('5521999');
  photo.set('5521999', 'BASE64DATA', 'image/jpeg', 1000);
  const e = photo.get('5521999', 1500);
  assert.strictEqual(e.base64, 'BASE64DATA');
  assert.strictEqual(e.contentType, 'image/jpeg');
});

test('get de telefone sem foto devolve null', () => {
  assert.strictEqual(photo.get('inexistente'), null);
});

test('contentType default vira image/jpeg quando ausente', () => {
  photo.clear('p2');
  photo.set('p2', 'X', undefined, 1000);
  assert.strictEqual(photo.get('p2', 1000).contentType, 'image/jpeg');
});

test('clear remove a pendência', () => {
  photo.set('p3', 'X', 'image/png', 1000);
  photo.clear('p3');
  assert.strictEqual(photo.get('p3', 1000), null);
});

test('TTL: expira após a janela e some', () => {
  photo.clear('p4');
  photo.set('p4', 'X', 'image/jpeg', 1000);
  assert.ok(photo.get('p4', 1000 + photo.TTL_MS - 1), 'dentro da janela ainda existe');
  assert.strictEqual(photo.get('p4', 1000 + photo.TTL_MS + 1), null, 'fora da janela some');
});

test('set sem base64 não guarda nada (defensivo)', () => {
  photo.clear('p5');
  photo.set('p5', '', 'image/jpeg', 1000);
  assert.strictEqual(photo.get('p5', 1000), null);
});

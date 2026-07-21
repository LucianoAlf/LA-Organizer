const { test } = require('node:test');
const assert = require('node:assert');
const { isEncryptedPdf, extractPassword } = require('./pdf-crypt');

test('isEncryptedPdf: detecta /Encrypt em PDF protegido', () => {
  const enc = Buffer.from('%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\ntrailer\n<< /Encrypt 9 0 R /Root 1 0 R >>\n%%EOF');
  const open = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
  assert.equal(isEncryptedPdf(enc), true);
  assert.equal(isEncryptedPdf(open), false);
});

test('isEncryptedPdf: não-PDF e vazio → false', () => {
  assert.equal(isEncryptedPdf(Buffer.from('isto nao eh pdf /Encrypt')), false); // sem header %PDF
  assert.equal(isEncryptedPdf(Buffer.from('')), false);
  assert.equal(isEncryptedPdf(null), false);
});

test('extractPassword: pega a senha de várias formas', () => {
  assert.equal(extractPassword('Senha: 147640'), '147640');
  assert.equal(extractPassword('senha 147640'), '147640');
  assert.equal(extractPassword('a senha é abc123'), 'abc123');
  assert.equal(extractPassword('password: Xy9$k'), 'Xy9$k');
  assert.equal(extractPassword('147640'), '147640');          // msg só com o token
  assert.equal(extractPassword('Código 0987'), '0987');
});

test('extractPassword: frase comum / vazio → null (não trata como senha)', () => {
  assert.equal(extractPassword('oi tudo bem com você?'), null);
  assert.equal(extractPassword('manda a fatura por favor'), null);
  assert.equal(extractPassword(''), null);
  assert.equal(extractPassword(null), null);
});

test('extractPassword: negação "(não tem|sem) senha ..." → null (não captura a palavra seguinte)', () => {
  // Caso Rose: ela respondeu "Nao tem senha tom" e o extractPassword pescava "tom" como senha.
  assert.equal(extractPassword('Nao tem senha tom'), null);
  assert.equal(extractPassword('não tem senha'), null);
  assert.equal(extractPassword('esse pdf não tem senha nenhuma'), null);
  assert.equal(extractPassword('sem senha aqui'), null);
  assert.equal(extractPassword('não possui senha'), null);
});

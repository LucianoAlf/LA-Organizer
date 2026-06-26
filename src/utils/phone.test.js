const { test } = require('node:test');
const assert = require('node:assert');
const { digitsOnly, brPhoneVariants } = require('./phone');

// PHONE-9DIGIT-LOOKUP (caso Vitória 24/06): a JID do WhatsApp BR às vezes vem SEM
// o 9º dígito (DDD 31). Cadastro tem COM o 9. Lookup exato falhava → "não te encontrei".
// brPhoneVariants gera as duas formas (com/sem o 9) pra o lookup casar qualquer uma.

test('Vitória: inbound SEM o 9 casa a forma COM o 9 do cadastro', () => {
  const v = brPhoneVariants('553171422022'); // 12 díg, sem 9 (o que a UAZAPI manda)
  assert.ok(v.includes('553171422022'), 'mantém a forma original');
  assert.ok(v.includes('5531971422022'), 'gera a forma com o 9 (cadastro)');
});

test('reverso: cadastro COM o 9 casa a JID SEM o 9', () => {
  const v = brPhoneVariants('5531971422022'); // 13 díg, com 9
  assert.ok(v.includes('5531971422022'));
  assert.ok(v.includes('553171422022'));
});

test('aceita número formatado (+, espaço, traço)', () => {
  const v = brPhoneVariants('+55 31 7142-2022');
  assert.ok(v.includes('553171422022'));
  assert.ok(v.includes('5531971422022'));
});

test('SP com 9 (13) gera variante de 12; SP sem 9 (12) gera variante de 13', () => {
  assert.ok(brPhoneVariants('5511987654321').includes('551187654321'));
  assert.ok(brPhoneVariants('551187654321').includes('5511987654321'));
});

test('não-BR / fora do padrão: retorna só a forma limpa, sem inventar', () => {
  assert.deepStrictEqual(brPhoneVariants('12025550123'), ['12025550123']); // US
});

test('vazio/sujo: seguro', () => {
  assert.deepStrictEqual(brPhoneVariants(''), []);
  assert.deepStrictEqual(brPhoneVariants(null), []);
  assert.deepStrictEqual(brPhoneVariants('   '), []);
});

test('dedup: não repete a forma quando já é canônica', () => {
  const v = brPhoneVariants('553171422022');
  assert.strictEqual(new Set(v).size, v.length);
});

test('digitsOnly tira tudo que não é dígito', () => {
  assert.strictEqual(digitsOnly('+55 (31) 97142-2022'), '5531971422022');
  assert.strictEqual(digitsOnly(null), '');
});

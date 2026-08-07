const test = require('node:test');
const assert = require('node:assert');
const { hasPedirCredenciaisMarker, stripPedirCredenciaisMarker, formatCredenciaisBlock, MAX_CREDENCIAIS } = require('./pedir-credenciais');

test('hasPedirCredenciaisMarker: detecta o marker com e sem END', () => {
  assert.equal(hasPedirCredenciaisMarker('<<PEDIR_CREDENCIAIS>><<END>>'), true);
  assert.equal(hasPedirCredenciaisMarker('texto antes <<PEDIR_CREDENCIAIS>> depois'), true);
  assert.equal(hasPedirCredenciaisMarker('<<pedir_credenciais>>'), true, 'case-insensitive');
});

test('hasPedirCredenciaisMarker: não confunde com outros markers', () => {
  assert.equal(hasPedirCredenciaisMarker('<<TASK_UPDATE>>[]<<END>>'), false);
  assert.equal(hasPedirCredenciaisMarker('me manda o link da anamnese'), false);
  assert.equal(hasPedirCredenciaisMarker(''), false);
  assert.equal(hasPedirCredenciaisMarker(null), false);
});

test('stripPedirCredenciaisMarker: remove marker e normaliza espaços', () => {
  assert.equal(stripPedirCredenciaisMarker('<<PEDIR_CREDENCIAIS>><<END>>'), '');
  assert.equal(stripPedirCredenciaisMarker('oi <<PEDIR_CREDENCIAIS>><<END>> tudo bem'), 'oi  tudo bem'.replace(/\s+/g, ' ').trim());
  assert.equal(stripPedirCredenciaisMarker(null), '');
});

test('formatCredenciaisBlock: renderiza nome e url', () => {
  const out = formatCredenciaisBlock([
    { nome: 'Anamnese de alunos', url_ref: 'https://a.app/' },
    { nome: 'Chatwoot', url_ref: 'https://b.com' },
  ]);
  assert.match(out, /Anamnese de alunos: https:\/\/a\.app\//);
  assert.match(out, /Chatwoot: https:\/\/b\.com/);
});

test('formatCredenciaisBlock: lista vazia devolve string vazia', () => {
  assert.equal(formatCredenciaisBlock([]), '');
  assert.equal(formatCredenciaisBlock(null), '');
});

test('formatCredenciaisBlock: aplica cap de MAX_CREDENCIAIS', () => {
  const many = Array.from({ length: MAX_CREDENCIAIS + 10 }, (_, i) => ({ nome: `S${i}`, url_ref: `https://x/${i}` }));
  const out = formatCredenciaisBlock(many);
  const linhas = out.split('\n').filter(l => l.startsWith('- '));
  assert.equal(linhas.length, MAX_CREDENCIAIS);
});

test('formatCredenciaisBlock: ignora linha sem url', () => {
  const out = formatCredenciaisBlock([{ nome: 'Sem url', url_ref: null }, { nome: 'Ok', url_ref: 'https://ok' }]);
  assert.doesNotMatch(out, /Sem url/);
  assert.match(out, /Ok: https:\/\/ok/);
});

// src/lib/nomeia-falhas.test.js  ·  node --test src/lib/nomeia-falhas.test.js
// LOTE-PARCIAL-NAO-DIZ-QUAIS (Yuri 14/08, Dai 17/08): lote parcial dizia "algumas falharam"
// sem nomear. Agora nomeia o subconjunto que falhou.
const { test } = require('node:test');
const assert = require('node:assert');
const { nomeiaFalhas, falaParcial } = require('./nomeia-falhas');

test('CASO YURI: nomeia as 3 que falharam por título', () => {
  const falharam = [
    { action: 'update', title: 'NAS' },
    { action: 'update', title: 'Imagens BG' },
    { action: 'complete', title: 'Vídeos Boas Vindas' },
  ];
  assert.strictEqual(nomeiaFalhas(falharam), '*NAS*, *Imagens BG*, *Vídeos Boas Vindas*');
  const fala = falaParcial(4, 7, falharam);
  assert.match(fala, /Registrei 4 de 7/);
  assert.match(fala, /Não entraram: \*NAS\*, \*Imagens BG\*, \*Vídeos Boas Vindas\*/);
  assert.match(fala, /me manda esses de novo/);
});

test('sem título usa id curto; dedup e teto +N (6 rótulos → mostra 4, +2)', () => {
  const falharam = [
    { action: 'complete', id: 'abcd1234ef' },
    { action: 'complete', title: 'Um' }, { action: 'complete', title: 'Dois' },
    { action: 'complete', title: 'Três' }, { action: 'complete', title: 'Quatro' },
    { action: 'complete', title: 'Cinco' },
  ];
  const s = nomeiaFalhas(falharam);
  assert.match(s, /#abcd1234/);
  assert.match(s, /\+2$/);
});

test('nada aferível → null (caller mantém a contagem)', () => {
  assert.strictEqual(nomeiaFalhas([{ action: 'complete' }, { action: 'update' }]), null);
  assert.strictEqual(nomeiaFalhas([]), null);
  assert.strictEqual(nomeiaFalhas(null), null);
});

test('falaParcial sem nomes cai no genérico (zero-regressão)', () => {
  const fala = falaParcial(2, 5, [{ action: 'complete' }]);
  assert.match(fala, /Registrei 2 de 5/);
  assert.match(fala, /Algumas falharam — me chama se algo ficar faltando/);
});

// Catraca de FONTE: o helper só ajuda se o engine (a) capturar quais falharam e (b) usar falaParcial.
const fs = require('node:fs');
const path = require('node:path');
const ENG = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: applyTaskActions captura _falharam por try/finally e devolve no retorno', () => {
  assert.match(ENG, /const _falharam = \[\];/);
  assert.match(ENG, /\} finally \{\s*if \(okCount === _okB && failCount > _failB\) _falharam\.push\(a\);/);
  assert.match(ENG, /createdReminderTimes, falharam: _falharam \};/);
});
test('engine: o ramo parcial nomeia só quando cobre TODAS as falhas (gate de completude)', () => {
  assert.match(ENG, /const _falhasNomeaveis = \(Array\.isArray\(falharam\) && falharam\.length === failCount\)/);
  assert.match(ENG, /falaParcial\(okCount, okCount \+ failCount, _falhasNomeaveis\)/);
});

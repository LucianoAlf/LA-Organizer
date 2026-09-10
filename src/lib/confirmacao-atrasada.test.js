'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { perguntaFoiAUltimaFala } = require('./confirmacao-atrasada');

const AGORA = Date.parse('2026-08-20T21:12:18-03:00');
const KRISSYA = 'Aviso o Arthur amanhã às 9:30 pra tirar os R$950 do caixa — confirma?';

test('Krissya 20/08: "Isso" 27 min depois, e a última fala do TOM era a pergunta → é a resposta', () => {
  assert.strictEqual(perguntaFoiAUltimaFala({ pergunta: KRISSYA, ultimaFala: KRISSYA,
    askedAt: '2026-08-20T20:45:19-03:00', agoraMs: AGORA }), true);
});

test('Rafinha 27/08: pergunta curta, idêntica à última fala', () => {
  assert.strictEqual(perguntaFoiAUltimaFala({ pergunta: 'Aviso o Dudu? Confirma?', ultimaFala: 'Aviso o Dudu? Confirma?',
    askedAt: '2026-08-27T22:52:35-03:00', agoraMs: Date.parse('2026-08-27T23:29:03-03:00') }), true);
});

test('a fala enviada com rodapé ou negrito ainda casa', () => {
  assert.strictEqual(perguntaFoiAUltimaFala({ pergunta: KRISSYA, ultimaFala: `*${KRISSYA}*\n\n_me responde sim ou não_`,
    askedAt: '2026-08-20T20:45:19-03:00', agoraMs: AGORA }), true);
});

test('o TOM falou OUTRA coisa depois da pergunta → não amarra (a janela de 20 min volta a valer)', () => {
  assert.strictEqual(perguntaFoiAUltimaFala({ pergunta: KRISSYA, ultimaFala: '🌙 Fechamento do dia — como foi a reunião?',
    askedAt: '2026-08-20T20:45:19-03:00', agoraMs: AGORA }), false);
});

test('mais de 24h → não amarra, mesmo sendo a última fala', () => {
  assert.strictEqual(perguntaFoiAUltimaFala({ pergunta: KRISSYA, ultimaFala: KRISSYA,
    askedAt: '2026-08-19T20:00:00-03:00', agoraMs: AGORA }), false);
});

test('pergunta vazia ou curta demais não amarra nada', () => {
  assert.strictEqual(perguntaFoiAUltimaFala({ pergunta: '', ultimaFala: 'ok?', askedAt: '2026-08-20T20:45:19-03:00', agoraMs: AGORA }), false);
  assert.strictEqual(perguntaFoiAUltimaFala({ pergunta: 'ok?', ultimaFala: 'ok?', askedAt: '2026-08-20T20:45:19-03:00', agoraMs: AGORA }), false);
  assert.strictEqual(perguntaFoiAUltimaFala({}), false);
});

// ── LIGACAO NO ENGINE ─────────────────────────────────────────────────────────────────
const _fs = require('node:fs');
const _path = require('node:path');
const ENG = _fs.readFileSync(_path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: a confirmação atrasada consulta a última fala e só então escapa do ramo stale', () => {
  assert.match(ENG, /perguntaFoiAUltimaFala\(\{ pergunta: target\.question_text, ultimaFala: _uo\[0\]\.content, askedAt: target\.asked_at \}\)\) \{\s*_atrasadaAceita = true;/);
  assert.match(ENG, /\} else if \(userConfirm && !fresh && !_atrasadaAceita\) \{/);
});

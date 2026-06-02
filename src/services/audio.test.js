// Sprint 31 — testes do glossário/multipart da transcrição (audio.js).
// Bug 01/06: Whisper sem `prompt`/`language` ouviu "Drum Games" como "Drone
// Games". O fix passa um glossário de domínio + idioma. Aqui garantimos que o
// prompt contém os termos certos e que o multipart envia model/language/prompt.

const { test } = require('node:test');
const assert = require('node:assert');
const { buildTranscriptionPrompt, buildMultipart } = require('./audio');

test('buildTranscriptionPrompt inclui glossário de marca e nomes passados', () => {
  const p = buildTranscriptionPrompt(['Krissya', 'Fabíola']);
  assert.match(p, /Drum Games/);
  assert.match(p, /Emusys/);
  assert.match(p, /Krissya/);
  assert.match(p, /Fabíola/);
  assert.match(p, /[Pp]ortugu/); // contexto pt-BR
});

test('buildTranscriptionPrompt dedupe nomes e respeita maxChars', () => {
  const many = Array.from({ length: 500 }, (_, i) => `Nome${i}`);
  const p = buildTranscriptionPrompt(['Krissya', 'Krissya', ...many], 300);
  assert.ok(p.length <= 300, `len ${p.length} > 300`);
  const count = (p.match(/Krissya/g) || []).length;
  assert.ok(count <= 1, `Krissya repetido ${count}x`);
});

test('buildTranscriptionPrompt sem nomes ainda traz o glossário fixo', () => {
  const p = buildTranscriptionPrompt([]);
  assert.match(p, /Drum Games/);
});

test('buildMultipart envia model, language e prompt no corpo', () => {
  const { body } = buildMultipart({
    boundary: 'XBOUND', model: 'whisper-1', language: 'pt',
    prompt: 'Termos: Drum Games', buffer: Buffer.from('AUDIODATA'),
    filename: 'a.mp3', mime: 'audio/mpeg',
  });
  const s = body.toString('utf-8');
  assert.match(s, /name="model"\r\n\r\nwhisper-1/);
  assert.match(s, /name="language"\r\n\r\npt/);
  assert.match(s, /name="prompt"\r\n\r\nTermos: Drum Games/);
  assert.match(s, /name="file"; filename="a.mp3"/);
  assert.match(s, /AUDIODATA/);
  assert.match(s, /--XBOUND--/);
});

test('buildMultipart omite language/prompt quando ausentes', () => {
  const { body } = buildMultipart({
    boundary: 'XB', model: 'whisper-1', buffer: Buffer.from('X'),
    filename: 'a.mp3', mime: 'audio/mpeg',
  });
  const s = body.toString('utf-8');
  assert.ok(!/name="prompt"/.test(s), 'não deveria ter prompt');
  assert.ok(!/name="language"/.test(s), 'não deveria ter language');
});

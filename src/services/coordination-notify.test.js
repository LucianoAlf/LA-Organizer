const { test } = require('node:test');
const assert = require('node:assert');
const { buildCoordinationResponseNotification, extractVerbatim } = require('./coordination-notify');

// Caso real Rafinha 29/05: disse SÓ "Consigo verificar sim"; o resumo do LLM
// acrescentou "e vai dar um retorno" — frase que ele nunca disse (drift).
const RAFINHA_VERBATIM = 'Consigo verificar sim';
const RAFINHA_SUMMARY = 'Rafinha confirmou que consegue verificar a questão do fornecedor de aromas agora e vai dar um retorno';

test('cita a fala verbatim do recipient entre aspas', () => {
  const msg = buildCoordinationResponseNotification({
    recipientFirstName: 'Rafinha', inboundText: RAFINHA_VERBATIM, summary: RAFINHA_SUMMARY,
  });
  assert.ok(msg.includes(`"${RAFINHA_VERBATIM}"`), `verbatim não citado: ${msg}`);
});

test('resumo do LLM NÃO contamina a citação (drift "vai dar um retorno" fica fora das aspas)', () => {
  const msg = buildCoordinationResponseNotification({
    recipientFirstName: 'Rafinha', inboundText: RAFINHA_VERBATIM, summary: RAFINHA_SUMMARY,
  });
  const quoted = msg.match(/"([^"]*)"/)[1];
  assert.strictEqual(quoted, RAFINHA_VERBATIM);
  assert.ok(!quoted.includes('vai dar um retorno'), 'drift vazou pra dentro da citação');
});

test('resumo aparece separado e rotulado, nunca fundido na fala', () => {
  const msg = buildCoordinationResponseNotification({
    recipientFirstName: 'Rafinha', inboundText: RAFINHA_VERBATIM, summary: RAFINHA_SUMMARY,
  });
  assert.ok(msg.includes('como entendi:'), `resumo não rotulado/separado: ${msg}`);
});

test('sem verbatim (mídia): NÃO cai no resumo livre — avisa que não capturou', () => {
  const msg = buildCoordinationResponseNotification({
    recipientFirstName: 'Rafinha',
    inboundText: '[O usuário ACABOU DE ENVIAR uma imagem agora — Análise: foto de um equipamento]',
    summary: 'Rafinha mandou uma foto do equipamento quebrado',
  });
  assert.ok(/não consegui transcrever/i.test(msg), `deveria avisar falta de verbatim: ${msg}`);
  assert.ok(!msg.includes('foto do equipamento quebrado'), 'resumo livre vazou sem verbatim');
});

test('sem verbatim (inbound vazio): avisa que não capturou, sem inventar', () => {
  const msg = buildCoordinationResponseNotification({
    recipientFirstName: 'Rafinha', inboundText: '   ', summary: 'qualquer resumo do LLM',
  });
  assert.ok(/não consegui transcrever/i.test(msg));
  assert.ok(!msg.includes('qualquer resumo do LLM'));
});

test('áudio transcrito: cita a transcrição como verbatim, sem o prefixo de sistema', () => {
  const msg = buildCoordinationResponseNotification({
    recipientFirstName: 'Rafinha', inboundText: '[áudio transcrito] consigo verificar sim', summary: 'Rafinha confirmou',
  });
  assert.ok(msg.includes('"consigo verificar sim"'), `transcrição não citada limpa: ${msg}`);
  assert.ok(!msg.includes('[áudio transcrito]'), 'prefixo de sistema vazou pra citação');
});

test('extractVerbatim: texto limpo retorna a fala; placeholder de sistema retorna null', () => {
  assert.strictEqual(extractVerbatim('Consigo verificar sim'), 'Consigo verificar sim');
  assert.strictEqual(extractVerbatim('[O usuário ACABOU DE ENVIAR uma imagem]'), null);
  assert.strictEqual(extractVerbatim(''), null);
});

test('resumo idêntico ao verbatim não duplica (sem parêntese redundante)', () => {
  const msg = buildCoordinationResponseNotification({
    recipientFirstName: 'Rafinha', inboundText: 'Consigo verificar sim', summary: 'Consigo verificar sim',
  });
  assert.ok(!msg.includes('como entendi:'), `não deveria ter resumo redundante: ${msg}`);
});

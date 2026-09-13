'use strict';
// MOTIVO-MARKER-CORTADO-EM-120 (auditoria cruzada 13/09).
//
// Em 12/09 às 15:00 a pauta de anamnese caiu com `erro=consulta do LA Report falhou no lembrete da
// próxima hora: <mensagem>`. No banco sobrou "…falhou no lembrete da pr" — a mensagem do erro, que é
// a única coisa que diz O QUE quebrou, ficou fora. O sensor tinha sido escrito de propósito pra
// nomear a passada que caiu (comentário em anamnese-pauta.js), e o corte apagou metade do recado.
//
// O 120 era orçamento auto-imposto do dispatcher: `logMarker` (engine.js) grava até 300, e a coluna
// é text. Alinhar os dois não afrouxa nada — só para de jogar fora o diagnóstico que já existia.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DISPATCHER = fs.readFileSync(path.join(__dirname, 'dispatcher.js'), 'utf8');
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

test('nenhum motivo de marcador é cortado em 120 (a mensagem do erro cabe)', () => {
  const restantes = (DISPATCHER.match(/\.slice\(0, 120\)/g) || []).length;
  assert.strictEqual(restantes, 0,
    `${restantes} motivo(s) ainda cortam em 120 — foi assim que o erro do LA Report sumiu em 12/09`);
});

test('o corte do dispatcher é o MESMO limite que o logMarker grava (300)', () => {
  assert.match(ENGINE, /reason: reason \? String\(reason\)\.slice\(0, 300\) : null/,
    'logMarker mudou o limite: o dispatcher precisa acompanhar, senão volta a cortar cedo');
  const cortes = (DISPATCHER.match(/\.slice\(0, 300\)/g) || []).length;
  assert.ok(cortes >= 20, `esperava os motivos do dispatcher cortando em 300 (achei ${cortes})`);
});

test('o motivo que perdemos em 12/09 agora cabe inteiro', () => {
  const chave = 'pauta_lembrete:95553e96-971b-4590-a6eb-0201d013c14d:2026-09-12:15:00';
  const motivo = `${chave} erro=consulta do LA Report falhou no lembrete da próxima hora: TypeError: fetch failed — não cobro sem a fonte`;
  assert.ok(motivo.length > 120, 'o caso real passa de 120 — é por isso que ele sumia');
  assert.strictEqual(motivo.slice(0, 300), motivo, 'com 300 o diagnóstico inteiro sobrevive');
});

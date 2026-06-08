// src/services/active-window.test.js
'use strict';
const assert = require('assert');
const { computeStartHour } = require('./active-window');

// Anne-like: ativa de manhã-tarde-noite (18 amostras)
const anne = [10,10,11,11,11,12,13,14,15,16,18,19,20,21,22,11,12,13];
// Alf-like: cedo (18 amostras)
const alf = [6,7,7,7,8,8,8,9,9,10,11,12,14,16,18,7,8,8];
// Poucos dados (< MIN_SAMPLES)
const few = [9,10,11];

const rAnne = computeStartHour(anne);
assert.deepStrictEqual(rAnne, { hour: 11, minute: 0 }, `Anne: esperava 11h, veio ${JSON.stringify(rAnne)}`);

const rAlf = computeStartHour(alf);
assert.deepStrictEqual(rAlf, { hour: 7, minute: 0 }, `Alf: esperava 7h, veio ${JSON.stringify(rAlf)}`);

assert.strictEqual(computeStartHour(few), null, 'poucos dados → null');
assert.strictEqual(computeStartHour([]), null, 'vazio → null');
assert.strictEqual(computeStartHour(null), null, 'null → null');

// Horas inválidas são filtradas (não contam pra amostra nem distorcem)
const dirty = anne.concat([25, -1, NaN, 99]);
assert.deepStrictEqual(computeStartHour(dirty), { hour: 11, minute: 0 }, 'lixo filtrado');

console.log('OK active-window.test (computeStartHour) — 6/6');

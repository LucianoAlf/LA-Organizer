'use strict';
const assert = require('assert');
const { weekBounds } = require('D:/la-organizer/_remote/src/finance/report-domain');

// 2024-01-01 é segunda-feira (âncora conhecida)
assert.deepStrictEqual(weekBounds('2024-01-01'), { start: '2024-01-01', end: '2024-01-07' }, 'segunda');
assert.deepStrictEqual(weekBounds('2024-01-03'), { start: '2024-01-01', end: '2024-01-07' }, 'quarta cai na mesma semana');
assert.deepStrictEqual(weekBounds('2024-01-07'), { start: '2024-01-01', end: '2024-01-07' }, 'domingo é o fim');
assert.deepStrictEqual(weekBounds('2024-01-08'), { start: '2024-01-08', end: '2024-01-14' }, 'próxima segunda vira nova semana');
console.log('OK smoke-report-domain-week');

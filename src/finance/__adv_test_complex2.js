'use strict';
const { detectRegisterIntent } = require('D:/la-organizer/_remote/src/finance/detect-register-intent.js');

// HARD adversarial: complex cases phrased to DODGE the bail regexes.
const cases = [
  // Parcelado sem "x"/"parcel"/"vezes" no formato esperado:
  { phrase: 'comprei a tv 1200 em dez vezes', fn: 'd', exp: { nullExpected: true }, why: 'parcelado escrito por extenso "dez vezes" -> \\bvezes\\b deve pegar' },
  { phrase: 'paguei o sofa 2000 em duas vezes', fn: 'd', exp: { nullExpected: true }, why: 'parcelado "duas vezes" -> \\bvezes\\b' },
  { phrase: 'comprei tv 1200 parcelando', fn: 'd', exp: { nullExpected: true }, why: '"parcelando" -> \\bparcel pega' },
  { phrase: 'comprei celular 1500 em suaves prestacoes', fn: 'd', exp: { nullExpected: true }, why: 'parcelado sem termo conhecido -> REGEX NAO PEGA, vira registro' },
  { phrase: 'comprei tv 1200 no carne', fn: 'd', exp: { nullExpected: true }, why: '"no carne" = parcelado informal -> nao pega' },

  // Multi-item onde stripTemporal/count-noun come um dos valores -> sobra 1 -> registra indevido:
  { phrase: 'paguei 2 contas de 150', fn: 'd', exp: { nullExpected: true }, why: '"2 contas" -> count-noun? "contas" NAO esta na lista -> 2 e 150 contam = 2 valores -> bail. checar' },
  { phrase: 'gastei 30 reais 3 vezes hoje', fn: 'd', exp: { nullExpected: true }, why: '"3 vezes" -> RE_INSTALLMENT \\bvezes\\b pega -> bail' },
  { phrase: 'paguei 100 dia 50 reais', fn: 'd', exp: { nullExpected: true }, why: '"dia 50" stripado por "dia \\d" -> sobra 100 e reais. CUIDADO: vira 1 valor 100' },
  { phrase: 'comprei 3 cervejas e 1 agua por 45', fn: 'd', exp: { ambiguous: true }, why: '"3 cervejas" "1 agua" nao sao count-nouns -> 3,1,45 = 3 valores -> bail esperado' },
  { phrase: 'gastei 12/06 no mercado 200', fn: 'd', exp: { ambiguous: true, type: 'expense', amount: 200 }, why: 'data 12/06 stripada -> sobra 200, registro valido 1 valor' },

  // Transferencia sem a palavra "transfer":
  { phrase: 'passei 300 do nubank pro itau', fn: 'd', exp: { nullExpected: true }, why: '"passei X do Y pro Z" = transferencia mas "passei" nao e verbo conhecido -> bail por gate (sem verbo)' },
  { phrase: 'mandei 200 do meu pix pra conta da loja', fn: 'd', exp: { nullExpected: true }, why: '"mandei" transferencia -> sem verbo de registro -> bail por gate' },
  { phrase: 'movi 500 da poupanca pra corrente', fn: 'd', exp: { nullExpected: true }, why: 'movimentacao entre contas, sem verbo -> bail' },

  // Multi-valor disfarcado de valor unico (mesmo valor repetido):
  { phrase: 'paguei 50 e mais 50 de gorjeta', fn: 'd', exp: { nullExpected: true }, why: 'dois valores 50 e 50 -> amounts.length=2 -> bail' },
  { phrase: 'gastei 100 sendo 60 de comida e 40 de bebida', fn: 'd', exp: { nullExpected: true }, why: '100,60,40 -> 3 valores -> bail' },
];

let ran = 0;
const failures = [];
for (const c of cases) {
  ran++;
  const actual = detectRegisterIntent(c.phrase, {});
  const e = c.exp;
  const got = actual ? JSON.stringify({ type: actual.type, amount: actual.amount }) : 'null';
  if (e.ambiguous && e.type === undefined) {
    console.log(`[AMBIG] "${c.phrase}" => ${got}  // ${c.why}`);
    continue;
  }
  if (e.ambiguous) {
    if (actual && (actual.type !== e.type || actual.amount !== e.amount)) {
      failures.push({ phrase: c.phrase, fn: 'detectRegisterIntent', expected: `null OR {type:${e.type},amount:${e.amount}}`, actual: got, severity: 'medio', note: c.why });
    }
    console.log(`[AMBIG] "${c.phrase}" => ${got}  // ${c.why}`);
    continue;
  }
  if (e.nullExpected) {
    if (actual !== null) {
      failures.push({ phrase: c.phrase, fn: 'detectRegisterIntent', expected: 'null', actual: got, severity: 'alto', note: c.why });
    }
    console.log(`[BAIL?] "${c.phrase}" => ${got} ${actual === null ? 'OK' : '<<FAIL'}  // ${c.why}`);
  }
}
console.log('\n=== RAN:', ran, ' FAILURES:', failures.length, '===');
console.log(JSON.stringify(failures, null, 2));

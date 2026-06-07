'use strict';
const { detectRegisterIntent, looksLikeFinanceConfirmation } = require('D:/la-organizer/_remote/src/finance/detect-register-intent.js');

// Each case: phrase, fn, expected.
// For detectRegisterIntent expected:
//   { nullExpected:true }  OR  { nullExpected:false, type, amount }
//   { ambiguous:true } => accept null OR non-null (value+date), just report actual.
const cases = [
  // ---- PARCELADO ----
  { phrase: 'comprei tv 1200 em 10x', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'paguei a geladeira 3500 parcelado', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'lança 1200 do celular em 12 vezes', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'comprei um fone 300 em 3x sem juros', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'paguei 600 no notebook parcelei em 6', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'gastei 900 dividido em 4 parcelas', fn: 'd', exp: { nullExpected: true } },

  // ---- TRANSFERENCIA ----
  { phrase: 'transferi 500 do nubank pro itau', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'fiz uma transferencia de 1000 pra poupanca', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'transferencia de 250 do meu pix pra conta da maria', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'mandei 80 via pix pro joao agora', fn: 'd', exp: { nullExpected: true } }, // sem "transferir": "mandei" nao e verbo de registro/income/expense -> deve bail por gate

  // ---- MULTI-ITEM ----
  { phrase: 'gastei 50 no mercado e 30 na farmacia', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'paguei 100 de luz e 200 de agua', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'comprei pao 12 e leite 8', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'gastei 40 no almoco, 15 no uber e 20 no lanche', fn: 'd', exp: { nullExpected: true } },
  { phrase: 'recebi 500 do show e gastei 100 de gasolina', fn: 'd', exp: { nullExpected: true } }, // sinal misto income+expense

  // ---- VALOR + DATA (ambiguo: pode ser non-null com 1 valor) ----
  { phrase: 'paguei 100 dia 10', fn: 'd', exp: { ambiguous: true, type: 'expense', amount: 100 } },
  { phrase: 'recebi 800 no dia 05/06', fn: 'd', exp: { ambiguous: true, type: 'income', amount: 800 } },
  { phrase: 'gastei 75 as 8 da manha', fn: 'd', exp: { ambiguous: true, type: 'expense', amount: 75 } },
  { phrase: 'paguei 250 ontem 14h', fn: 'd', exp: { ambiguous: true, type: 'expense', amount: 250 } },

  // ---- EXTRA armadilhas ----
  { phrase: 'comprei 2 ingressos por 90', fn: 'd', exp: { ambiguous: true, type: 'expense', amount: 90 } }, // "2 ingressos" nao esta em COUNT_NOUN, mas 2 vira valor? -> checar
];

let ran = 0;
const failures = [];

function approxType(r) { return r ? r.type : null; }

for (const c of cases) {
  ran++;
  const actual = detectRegisterIntent(c.phrase, {});
  const e = c.exp;
  if (e.ambiguous) {
    // just print, no failure unless non-null but wrong type/amount
    if (actual && (actual.type !== e.type || actual.amount !== e.amount)) {
      failures.push({ phrase: c.phrase, fn: 'detectRegisterIntent',
        expected: `null OR {type:${e.type},amount:${e.amount}}`,
        actual: JSON.stringify({ type: actual.type, amount: actual.amount }),
        severity: 'medio', note: 'ambiguo valor+data: non-null mas type/amount divergente' });
    }
    console.log(`[AMBIG] "${c.phrase}" => ${actual ? JSON.stringify({type:actual.type,amount:actual.amount}) : 'null'}`);
    continue;
  }
  if (e.nullExpected) {
    if (actual !== null) {
      failures.push({ phrase: c.phrase, fn: 'detectRegisterIntent',
        expected: 'null', actual: JSON.stringify({ type: actual.type, amount: actual.amount }),
        severity: 'alto', note: 'caso complexo deveria bail mas virou registro' });
    }
    console.log(`[BAIL?] "${c.phrase}" => ${actual ? JSON.stringify({type:actual.type,amount:actual.amount}) : 'null'} ${actual===null?'OK':'<<FAIL'}`);
  } else {
    if (actual === null || actual.type !== e.type || actual.amount !== e.amount) {
      failures.push({ phrase: c.phrase, fn: 'detectRegisterIntent',
        expected: JSON.stringify({ type: e.type, amount: e.amount }),
        actual: actual ? JSON.stringify({ type: actual.type, amount: actual.amount }) : 'null',
        severity: 'alto', note: 'registro valido divergiu' });
    }
    console.log(`[REG] "${c.phrase}" => ${actual ? JSON.stringify({type:actual.type,amount:actual.amount}) : 'null'}`);
  }
}

console.log('\n=== RAN:', ran, ' FAILURES:', failures.length, '===');
console.log(JSON.stringify(failures, null, 2));

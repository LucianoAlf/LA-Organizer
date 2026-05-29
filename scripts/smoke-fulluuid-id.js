#!/usr/bin/env node
// Smoke: regression do bug Anne (29/05) — TASK_UPDATE complete por UUID completo
// era rejeitado como schema_invalid porque SHORT_ID_RE só aceitava hex 4-12.
// O bloco [COBRANÇAS ABERTAS] entrega target_id como UUID inteiro → marker virava
// schema_invalid → guardrail mandava "Não confirmei nada no banco" mesmo com "feito!".
process.chdir('/opt/LA-Organizer');
const { parseTaskUpdateMarker } = require('../src/engine');

const FULL_UUID = '56768dfc-39df-46c3-b121-be05c97f5386';
const SHORT = '56768dfc';
let ok = true;

function check(label, cond) {
  console.log(`${cond ? 'OK ' : 'FALHOU'} | ${label}`);
  if (!cond) ok = false;
}

// 1) Caso real do bug: complete por UUID completo (como o prompt entrega)
const replyFull = `✅ Marcado como feito!\n\n<<TASK_UPDATE>>\n[{"action":"complete","id":"${FULL_UUID}"}]\n<<END>>\n\nE aí?`;
const r1 = parseTaskUpdateMarker(replyFull);
check('UUID completo aceito (malformed=false)', r1 && r1.malformed === false);
check('action complete preservada com id UUID', r1 && r1.actions && r1.actions[0] && r1.actions[0].action === 'complete' && r1.actions[0].id === FULL_UUID);

// 2) Short-id continua funcionando (não quebrou nada)
const replyShort = `<<TASK_UPDATE>>\n[{"action":"complete","id":"${SHORT}"}]\n<<END>>`;
const r2 = parseTaskUpdateMarker(replyShort);
check('short-id ainda aceito', r2 && r2.malformed === false && r2.actions[0].id === SHORT);

// 3) reschedule por UUID completo + nova data
const replyResched = `<<TASK_UPDATE>>\n[{"action":"reschedule","id":"${FULL_UUID}","new_due_date":"2026-06-01"}]\n<<END>>`;
const r3 = parseTaskUpdateMarker(replyResched);
check('reschedule por UUID completo aceito', r3 && r3.malformed === false && r3.actions[0].id === FULL_UUID);

// 4) lixo continua rejeitado (não afrouxou demais)
const replyGarbage = `<<TASK_UPDATE>>\n[{"action":"complete","id":"nao-eh-um-id"}]\n<<END>>`;
const r4 = parseTaskUpdateMarker(replyGarbage);
check('id-lixo ainda rejeitado (malformed=true)', r4 && r4.malformed === true);

console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);

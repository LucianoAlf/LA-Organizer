#!/usr/bin/env node
// Smoke determinístico do isQuietNow com contexto. Não toca no banco — passa prefs inline.
const { isQuietNow } = require('../src/services/quiet-hours');

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
}

(async () => {
  // Gabi: silêncio TRABALHO 00:00-14:00, pessoal livre
  const gabi = {
    quiet_start_time_work: '00:00:00', quiet_end_time_work: '14:00:00',
    quiet_days_work: [], quiet_weekends_work: false,
    quiet_start_time_personal: null, quiet_end_time_personal: null,
    quiet_days_personal: [], quiet_weekends_personal: false,
  };
  const now9 = { hour: 9, minute: 0, dow: 3 };   // quarta 09h
  const now15 = { hour: 15, minute: 0, dow: 3 };  // quarta 15h

  check('gabi 09h work=quiet', (await isQuietNow(gabi, now9, 'work')).quiet, true);
  check('gabi 09h personal=livre', (await isQuietNow(gabi, now9, 'personal')).quiet, false);
  check('gabi 15h work=livre', (await isQuietNow(gabi, now15, 'work')).quiet, false);

  // Fallback legado: objeto SEM as colunas de contexto (caller antigo) → usa globais
  const legacy = {
    quiet_start_time: '22:00:00', quiet_end_time: '08:00:00',  // cruza meia-noite
    quiet_days: [], quiet_weekends: false,
  };
  check('legacy 23h work=quiet (fallback)', (await isQuietNow(legacy, { hour: 23, minute: 0, dow: 2 }, 'work')).quiet, true);
  check('legacy 12h work=livre (fallback)', (await isQuietNow(legacy, { hour: 12, minute: 0, dow: 2 }, 'work')).quiet, false);

  // Autoritativo: contexto presente mas null → SEM silêncio mesmo com global antiga setada
  const cleared = {
    quiet_start_time: '00:00:00', quiet_end_time: '14:00:00',  // global stale
    quiet_start_time_personal: null, quiet_end_time_personal: null,
    quiet_days_personal: [], quiet_weekends_personal: false,
  };
  check('cleared personal=livre (ignora global stale)', (await isQuietNow(cleared, { hour: 9, minute: 0, dow: 3 }, 'personal')).quiet, false);

  // quiet_days por contexto
  const daysWork = { quiet_days_work: [0], quiet_days_personal: [] };
  check('domingo work=quiet', (await isQuietNow(daysWork, { hour: 10, minute: 0, dow: 0 }, 'work')).quiet, true);
  check('domingo personal=livre', (await isQuietNow(daysWork, { hour: 10, minute: 0, dow: 0 }, 'personal')).quiet, false);

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();

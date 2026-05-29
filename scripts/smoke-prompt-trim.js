#!/usr/bin/env node
// Smoke: confirma que as skills enxugadas MANTÊM as âncoras sagradas (markers,
// schemas, ações, enums, regras críticas). Roda contra os arquivos .md locais —
// é só checagem de substring de presença, não precisa de banco.
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

// Âncoras obrigatórias por skill (substrings que NÃO podem sumir no corte).
const ANCHORS = {
  'criar-compromisso.md': [
    '<<EVENT_CREATE>>', '<<EVENT_UPDATE>>', '<<TASK_UPDATE>>',
    'bypass_integrity', 'to_name', '"action": "rsvp"',
    'reschedule', 'cancel', 'complete', 'update',
    'presencial', 'online', 'hibrido',
    'la_music', 'mentoria', 'estudio', 'show', 'pessoal',
    'reminders_minutes_before', 'cadastro-projeto-5w2h',
    'É outro', // ramo "2" da desambiguação 1/2/3
  ],
};

let allOk = true;
for (const [file, anchors] of Object.entries(ANCHORS)) {
  const full = path.join(SKILLS_DIR, file);
  if (!fs.existsSync(full)) { console.log(`FALTOU ARQUIVO | ${file}`); allOk = false; continue; }
  const body = fs.readFileSync(full, 'utf8');
  const sizeKB = (body.length / 1024).toFixed(1);
  const missing = anchors.filter(a => !body.includes(a));
  if (missing.length) { allOk = false; console.log(`FALTOU | ${file} (${sizeKB}KB) — sem: ${missing.join(', ')}`); }
  else console.log(`OK | ${file} (${sizeKB}KB) — ${anchors.length} âncoras presentes`);
}
console.log(allOk ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(allOk ? 0 : 1);

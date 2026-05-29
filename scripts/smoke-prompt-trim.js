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
  'priorizacao-inteligente.md': [
    '<<TASK_CREATE>>', '<<CHECKPOINT_BATCH>>', 'action_type',
    '`now`', '`task`', '`call`', '`meeting`', '`delegate`', '`project`',
    'project_checkpoints', 'Anti-promessa-vazia',
  ],
  'pedagogico.md': [
    '<<TASK_UPDATE>>', '<<COORDINATION_REQUEST>>', '<<END>>',
    '7f6bf077-678e-43f0-b6c9-54e46607386c', // department_id
    'c7dc420e-9105-435d-b291-27ca79df5fdf', // acompanhamento-professor
    '090b68eb-7b33-4fea-a80c-7574ec5ca755', // apoio-ao-aluno
    '613e8ac6-7f70-4da9-99da-8fae306b8c28', // alinhamento-de-turma
    'c32ecc43-cf12-45a4-b887-09db59ecc997', // alinhamento-com-responsavel
    '9cc58c14-eb63-4f46-aa15-d13dc1596e45', // evento-pedagogico
    '51690ae4-d90c-470d-bbb1-1df67a66a161', // pendencia-pedagogica
    'bd6f7652-eeea-4a4f-8174-7ebd57b4e22b', // suporte-ao-professor
    'lead', 'assistant', 'mentor', 'teacher',
    'subdomain', 'school', 'kids', 'risco-de-evasao', 'DENY',
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

// scripts/smoke-skill-untruncate.js
// Prova da Fatia A: as skills core voltam INTEIRAS e o conteúdo que ANTES era cortado
// (após 8192) agora chega. Compara capSkill(full) vs o antigo slice(0,8192).
// Rodar no VPS: cd /opt/LA-Organizer && node scripts/smoke-skill-untruncate.js
const fs = require('fs');
const path = require('path');
const { capSkill } = require('../src/prompts/skill-cap');

const SK = path.join(__dirname, '../skills');
const read = (n) => fs.readFileSync(path.join(SK, n + '.md'), 'utf8');

function main() {
  const results = [];

  const fin = read('financeiro-pessoal');
  const finFull = capSkill(fin, 'financeiro-pessoal');
  const finOld = fin.slice(0, 8192);
  results.push(['financeiro-pessoal volta INTEIRA (>8192)', finFull.length === fin.length && fin.length > 8192, `len=${fin.length}`]);
  results.push(['financeiro: create_card agora PRESENTE (era cortado em 8192)', finFull.includes('create_card') && !finOld.includes('create_card'), '']);
  results.push(['financeiro: bloco NUNCA agora PRESENTE', finFull.includes('NUNCA') && (finFull.lastIndexOf('NUNCA') > 8192), '']);

  const chk = read('checklist-tarefas');
  results.push(['checklist-tarefas volta INTEIRA (>8192)', capSkill(chk, 'checklist-tarefas').length === chk.length && chk.length > 8192, `len=${chk.length}`]);

  const combo = capSkill(read('criar-compromisso'), 'criar-compromisso').length + chk.length;
  results.push(['pior combo (criar-compromisso + checklist) < 200KB', combo < 200000, `combo=${combo}`]);

  console.log('=== RESULTADOS ===');
  let ok = true;
  for (const [n, p, d] of results) { console.log(`${p ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!p) ok = false; }
  console.log(ok ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
  process.exit(ok ? 0 : 1);
}
main();

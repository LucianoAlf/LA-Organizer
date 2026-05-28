#!/usr/bin/env node
// Smoke test: gera system prompt do Yuri e mostra o bloco novo "Tarefas pendentes SEM prazo"
// Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-system-prompt-yuri.js
process.chdir('/opt/LA-Organizer');

const { buildSystemPrompt } = require('../src/prompts/system');
const supabase = require('../src/supabase/client');

const YURI_ID = '5bb97642-bbc1-44c5-a3dc-bdab74347011';

(async () => {
  const { data: yuri } = await supabase
    .from('collaborators').select('*').eq('id', YURI_ID).single();

  const { systemPrompt } = await buildSystemPrompt(yuri, { text: 'o que mais tá em aberto sem prazo?', isAudio: false });

  console.log('=== prompt size:', systemPrompt.length, 'chars ===');

  // Extrair o bloco SEM PRAZO
  const semPrazoMatch = systemPrompt.match(/\*\*Tarefas pendentes SEM prazo[\s\S]*?(?=\n\n|\*\*Agenda|\*\*Projetos)/);
  console.log('\n--- BLOCO "SEM PRAZO" ---\n');
  console.log(semPrazoMatch ? semPrazoMatch[0] : '*** NÃO ENCONTRADO ***');

  // Extrair regra 15 (anti-confabulação)
  const ruleMatch = systemPrompt.match(/15\.\s+\*\*"O que combinamos[\s\S]*?(?=\n16\.)/);
  console.log('\n--- REGRA 15 (anti-confabulação) ---\n');
  console.log(ruleMatch ? ruleMatch[0].slice(0, 600) + '...' : '*** NÃO ENCONTRADO ***');

  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); console.error(e.stack); process.exit(1); });

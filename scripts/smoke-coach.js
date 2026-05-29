#!/usr/bin/env node
// Smoke: confirma que coach-usabilidade entra no system prompt p/ um colaborador real.
process.chdir('/opt/LA-Organizer');
const { buildSystemPrompt } = require('../src/prompts/system');
const supabase = require('../src/supabase/client');

const PHRASES = [
  'Strato Squier Azul - Regulagem',                              // P1 inventário
  'preciso ligar pro fornecedor, ver o boleto e comprar cordas', // P2 brain-dump
  'ah, já liguei pro Norton',                                    // P3 conclusão de passagem
  'como vejo minhas tarefas?',                                   // P4 dúvida de uso
];

(async () => {
  const { data: collab } = await supabase.from('collaborators').select('*').eq('is_active', true).limit(1).single();
  let allOk = true;
  for (const phrase of PHRASES) {
    const { systemPrompt } = await buildSystemPrompt(collab, { lastUserMessage: phrase, isAudio: false });
    const has = systemPrompt.includes('Coach de Usabilidade');
    if (!has) allOk = false;
    console.log(`${has ? 'OK ' : 'FALTOU '} | "${phrase.slice(0, 40)}"`);
  }
  console.log(allOk ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

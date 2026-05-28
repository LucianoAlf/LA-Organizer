#!/usr/bin/env node
// Smoke test: confirma que os triggers da skill inventario PEGAM as msgs do Rodrigo.
// Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-inventario-trigger.js
process.chdir('/opt/LA-Organizer');

const { buildSystemPrompt } = require('../src/prompts/system');
const supabase = require('../src/supabase/client');

const RODRIGO = '945ed9cf-7e2e-451f-b96b-28895ab3fe08';

const PHRASES = [
  'Hoje irei levantar as guitarras e violões de algumas salas. Condições de funcionamento de cada um deles.',
  'Strato Squeir by Fender - Azul\nRegulagem',
  'Telecaster GBS - Madeira\nRegulagem',
  'Semi-acústica Strinberg - Preta\nSem inlay da casa 3; Potenciômetro de volume do captador da ponte solto; Regulagem',
  'Violão Strinberg Black Séries modelo SF200C MGS - Aço\nSem bateria; Troca de cordas e regulagem',
  'Manda tudo junto, violões e guitarras. Tô anotando.',
];

(async () => {
  const { data: rodrigo } = await supabase.from('collaborators').select('*').eq('id', RODRIGO).single();
  for (const phrase of PHRASES) {
    const { systemPrompt } = await buildSystemPrompt(rodrigo, { lastUserMessage: phrase, isAudio: false });
    const hasInvBlock = systemPrompt.includes('[INVENTARIO_CATALOGO]');
    const hasInventarioSkill = systemPrompt.includes('inventario.md') || systemPrompt.includes('INVENTORY_ACTION');
    const status = hasInvBlock ? '✅ TRIGGER OK' : '❌ NÃO PEGOU';
    console.log(`${status} | invBlock=${hasInvBlock} skillRef=${hasInventarioSkill} | "${phrase.replace(/\n/g, ' ').slice(0, 70)}..."`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

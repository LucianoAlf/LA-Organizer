// scripts/e2e-pendencia-weekly.js
// Achado #79 — validação E2E (read-only, dados REAIS do banco). Prova que:
//  (a) a fonte única vê o mesmo evento pela escalação (todos os donos) E pelo
//      planejador (scope do dono);
//  (b) o CONTEXTO do weekly_planning passa a conter o bloco "⏳ Compromissos
//      passados sem fechamento" listando o compromisso — o dado que faltava pro
//      LLM dizer a verdade em vez de "semana limpa".
// SKIP se não houver evento stale no momento. Rodar na VPS:
//   node scripts/e2e-pendencia-weekly.js
'use strict';

const supabase = require('../src/supabase/client');
const { getStaleWorkEvents } = require('../src/services/open-pendencies');
const { buildSystemPrompt } = require('../src/prompts/system');

(async () => {
  // 1. Fonte única, modo escalação (todos os donos) — descobre um evento stale real.
  const all = await getStaleWorkEvents(supabase, { withCollaborator: true });
  if (!all.length) {
    console.log('SKIP — nenhum evento work stale na janela agora; nada a validar.');
    process.exit(0);
  }
  const ev = all[0];
  const collabId = ev.collaborator_id;

  // 2. Fonte única, modo planejador (scope do dono) — vê o MESMO evento.
  const scoped = await getStaleWorkEvents(supabase, { collabId });
  const scopedHit = scoped.some((r) => r.id === ev.id);
  console.log(`[fonte única] escalação vê "${ev.title}"; planejador (scope ${collabId.slice(0, 8)}) também: ${scopedHit}`);

  // 3. E2E do builder: monta o colaborador real e gera o prompt como weekly_planning.
  const { data: collab } = await supabase.from('collaborators').select('*').eq('id', collabId).single();
  if (!collab) { console.log('FAIL — collaborator não encontrado'); process.exit(1); }
  collab._ritualType = 'weekly_planning';
  const { systemPrompt: prompt } = await buildSystemPrompt(collab, {});

  const hasBlock = prompt.includes('Compromissos passados sem fechamento');
  const hasEvent = prompt.includes(ev.title);
  console.log(`[E2E weekly_planning p/ ${collab.full_name}]`);
  console.log(`  bloco "⏳ Compromissos passados sem fechamento" presente: ${hasBlock}`);
  console.log(`  evento "${ev.title}" listado no contexto: ${hasEvent}`);

  const passOk = scopedHit && hasBlock && hasEvent;
  console.log(passOk
    ? '\nE2E PASS — o planejador enxerga a pendência (não pode mais dizer "semana limpa").'
    : '\nE2E FAIL');
  process.exit(passOk ? 0 : 1);
})().catch((e) => { console.error('E2E ERRO:', e.message); process.exit(1); });

'use strict';
// RESUMO-SEMANAL-VIROU-AGENDA + RITUAL-AGENDA-GUARD (Alf 30/09 19:04): o fechamento perguntou
// "rolou?" da Jornada de Cordas cancelada. Fiação: o resumo semanal entra UMA vez no prompt, como
// retrato datado e sem compromisso futuro; o gerador grava pelo filtro; o sendRitual passa pela rede.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildContext } = require('./system');

const WS_REAL = {
  week_start: '2026-09-21',
  created_at: '2026-09-28T01:08:16.015954+00:00',
  summary: '**Resumo da semana (21–27/09)**\n\n- Jornada de Cordas (convite do Quintela), confirmada presença — remarcada para 30/09, 13h–17h.\n- Mentoria com Ariel (Neon Escola) — 22/09, feita.',
};

function ctxCom(ws) {
  const vazio = { personal: [], work: [] };
  return buildContext({ full_name: 'Luciano Alf', preferred_name: 'Alf', id: 'a' }, {}, vazio, [], 0, [], [], [], [], [], [], [], [], [], [], [], null, [], [], [], ws, [], [], [],
    { groups: [], myGroupTasks: [] }, []);
}

test('buildContext: resumo semanal sai como retrato datado, sem o compromisso de 30/09', () => {
  const txt = ctxCom(WS_REAL);
  assert.match(txt, /Retrato de 27\/09 \(semana a partir de 21\/09\) — compromissos aqui podem ter mudado; a agenda real é a seção de agenda/);
  assert.doesNotMatch(txt, /Jornada de Cordas/);
  assert.match(txt, /Mentoria com Ariel/);
  assert.doesNotMatch(txt, /Semana passada \(a partir de/);
});

const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('system.js: o resumo semanal é lido UMA vez e injetado UMA vez', () => {
  const s = src('prompts/system.js');
  assert.equal(s.split("from('collaborator_weekly_summaries')").length - 1, 1, 'uma leitura só');
  assert.doesNotMatch(s, /📋 \*\*Semana passada/);
  assert.equal(s.split('renderResumoSemanal(').length - 1, 1, 'uma injeção só');
});

test('engine: gerador usa o prompt novo e filtra antes de gravar; sendRitual passa pela rede antes do envio', () => {
  const e = src('engine.js');
  const ini = e.indexOf('async function generateWeeklySummaryFor');
  const fim = e.indexOf('// ==================== COORDINATOR REPORTS', ini);
  const gen = e.slice(ini, fim);
  assert.match(gen, /promptDoResumoSemanal\(/);
  const iNeu = gen.indexOf('neutralizarCompromissosFuturos(');
  const iUp = gen.indexOf(".from('collaborator_weekly_summaries').upsert(");
  assert.ok(iNeu > 0 && iUp > iNeu, 'filtra antes do upsert');
  assert.match(gen, /summary = _neu\.texto;/, 'grava o texto filtrado');

  const r0 = e.indexOf('async function sendRitual(');
  const r1 = e.indexOf('function ritualToDirective(', r0);
  const ritual = e.slice(r0, r1);
  const iGuard = ritual.indexOf('aplicarGuardaDeAgenda(');
  const iSend = ritual.indexOf('await whatsapp.sendMessage(collab.phone, finalText)');
  const iLog = ritual.indexOf("await logConversation(collab.id, 'outbound', finalText)");
  assert.ok(iGuard > 0 && iSend > iGuard && iLog > iGuard, 'rede antes do envio e do log');
  assert.match(ritual.slice(iGuard, iSend), /finalText = _rag\.texto;/, 'o texto enviado é o da rede');
  assert.match(ritual, /\['fechamento', 'briefing_diario', 'briefing_pessoal', 'briefing_trabalho'\]\.includes\(ritualKey\)/);
});

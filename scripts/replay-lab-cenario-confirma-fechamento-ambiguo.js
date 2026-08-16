#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-fechamento-ambiguo.js
// FATIA 4 (VERMELHO / fail-closed): DUAS tarefas pending com o MESMO título (avulsas, linhagens
// distintas) = ambiguidade real. O parse-on-open resolve título→id via resolveTaskTarget, que
// devolve 'ambiguo' → NÃO estagia batch_complete → o intent fica só-texto. No "sim", o executor
// determinístico NÃO roda e NENHUMA tarefa é fechada errado. Prova o fail-closed do título→id.
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA_NOME = '[QA] Replay 01';
if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET/TOM_QA_PHONES'); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function idDe(nome) {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', nome).maybeSingle();
  if (!data) throw new Error(`perfil ${nome} não existe`);
  return data.id;
}
async function limpar(cid) {
  await supabase.from('tasks').delete().eq('assigned_to', cid).ilike('title', 'QA Ambiguo%');
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid);
  await supabase.from('pending_intents').delete().eq('collaborator_id', cid);
}
async function criaTarefa(cid, titulo) {
  const { data } = await supabase.from('tasks').insert({
    assigned_to: cid, created_by: cid, title: titulo, status: 'pending',
    due_date: new Date().toISOString().slice(0, 10),
  }).select('id').single();
  return data.id;
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-fechamb-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}

(async () => {
  const cid = await idDe(QA_NOME);
  await limpar(cid);
  // Duas avulsas com o MESMO título → resolveTaskTarget = 'ambiguo' (linhagens distintas, sem série).
  const idA = await criaTarefa(cid, 'QA Ambiguo YY');
  const idB = await criaTarefa(cid, 'QA Ambiguo YY');

  // Intent SÓ-TEXTO (o que o fail-closed produz: parse casou o fechamento mas a resolução deu null).
  await supabase.from('pending_intents').insert({
    collaborator_id: cid, kind: 'confirmation',
    payload: { last_user_text: 'fecha a QA Ambiguo YY', last_tom_reply: 'Confirma o fechamento desta tarefa: *QA Ambiguo YY*?' },
    question_text: 'Confirma o fechamento desta tarefa: *QA Ambiguo YY*?', asked_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'Confirma');
  await dorme(40000);

  const { data: rows } = await supabase.from('tasks').select('id, status').in('id', [idA, idB]);
  const nenhumaFechada = (rows || []).every((r) => r.status !== 'done');
  console.log(`(a) NENHUMA tarefa ambígua fechada (fail-closed): ${nenhumaFechada ? 'OK' : 'FALHOU (fechou a tarefa errada!)'}`);

  const ok = nenhumaFechada;
  await limpar(cid);
  console.log(`\n[cenario-confirma-fechamento-ambiguo] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-delegacao-ambiguo.js
// FATIA 5 (VERMELHO / fail-closed): DUAS tarefas pending com o MESMO título → resolveTaskTarget
// devolve 'ambiguo' → o parse-on-open NÃO estagia delegation → intent fica só-texto. No "sim", a
// branch de delegação NÃO roda e NENHUMA tarefa é delegada errado. Prova o fail-closed do título→id.
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA1_NOME = '[QA] Replay 01';
const QA2_NOME = '[QA] Replay 02';
if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET/TOM_QA_PHONES'); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function idDe(nome) {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', nome).maybeSingle();
  if (!data) throw new Error(`perfil ${nome} não existe`);
  return data.id;
}
async function limpar(cid1) {
  await supabase.from('tasks').delete().eq('created_by', cid1).ilike('title', 'QA DelegAmb%');
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid1);
  await supabase.from('pending_intents').delete().eq('collaborator_id', cid1);
}
async function criaTarefa(cid, titulo) {
  const { data } = await supabase.from('tasks').insert({
    assigned_to: cid, created_by: cid, title: titulo, status: 'pending',
    due_date: new Date().toISOString().slice(0, 10),
  }).select('id').single();
  return data.id;
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-delegamb-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}

(async () => {
  const cid1 = await idDe(QA1_NOME);
  const cid2 = await idDe(QA2_NOME);
  await limpar(cid1);
  const idA = await criaTarefa(cid1, 'QA DelegAmb YY');
  const idB = await criaTarefa(cid1, 'QA DelegAmb YY');

  // Intent SÓ-TEXTO (o que o fail-closed produz: parse casou a delegação mas a resolução deu null).
  await supabase.from('pending_intents').insert({
    collaborator_id: cid1, kind: 'confirmation',
    payload: { last_user_text: 'delega a QA DelegAmb YY', last_tom_reply: `Delego a tarefa *QA DelegAmb YY* pro ${QA2_NOME}? Confirma?` },
    question_text: `Delego a tarefa *QA DelegAmb YY* pro ${QA2_NOME}? Confirma?`, asked_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'Confirma');
  await dorme(40000);

  const { data: rows } = await supabase.from('tasks').select('id, status, assigned_to').in('id', [idA, idB]);
  const nenhumaDelegada = (rows || []).every((r) => r.status !== 'delegated' && r.assigned_to === cid1);
  console.log(`(a) NENHUMA tarefa ambígua delegada (fail-closed): ${nenhumaDelegada ? 'OK' : 'FALHOU (delegou a errada!)'}`);

  const ok = nenhumaDelegada;
  await limpar(cid1);
  console.log(`\n[cenario-confirma-delegacao-ambiguo] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

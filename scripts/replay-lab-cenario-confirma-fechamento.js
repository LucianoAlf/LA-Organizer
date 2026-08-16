#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-fechamento.js
// FATIA 4 (VERDE): intent com batch_complete=[short-ids] — o payload que o parse-on-open produz
// quando o TOM pergunta "Confirma o fechamento destas 2 tarefas: *X*, *Y*?" e os títulos resolvem
// 'exato'. O usuário confirma → o executor determinístico (executeBatchComplete @engine 10199)
// fecha as 2 SEM cair no LLM. Prova o payoff: confirmação de fechamento NÃO vira "perdi o fio".
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA_NOME = '[QA] Replay 01';
if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET/TOM_QA_PHONES'); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => String(id).replace(/-/g, '').slice(0, 8);

async function idDe(nome) {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', nome).maybeSingle();
  if (!data) throw new Error(`perfil ${nome} não existe`);
  return data.id;
}
async function limpar(cid) {
  await supabase.from('tasks').delete().eq('assigned_to', cid).ilike('title', 'QA Fechar%');
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
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-fech-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}
async function ultimaResposta(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history').select('content').eq('collaborator_id', cid)
    .eq('direction', 'outbound').gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(6);
  return (data || []).map((m) => m.content || '').join('\n---\n');
}

(async () => {
  const cid = await idDe(QA_NOME);
  await limpar(cid);
  const idA = await criaTarefa(cid, 'QA Fechar Alpha ZZ');
  const idB = await criaTarefa(cid, 'QA Fechar Beta ZZ');

  await supabase.from('pending_intents').insert({
    collaborator_id: cid, kind: 'confirmation',
    payload: { batch_complete: [short(idA), short(idB)],
      last_user_text: 'fecha as duas', last_tom_reply: 'Confirma o fechamento destas 2 tarefas: *QA Fechar Alpha ZZ*, *QA Fechar Beta ZZ*?' },
    question_text: 'Confirma o fechamento destas 2 tarefas: *QA Fechar Alpha ZZ*, *QA Fechar Beta ZZ*?', asked_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'Confirma');
  await dorme(40000);
  const resp = await ultimaResposta(cid, t0);
  console.log(`[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (!resp.trim()) { console.error('SEM RESPOSTA (timeout?). exit 2'); await limpar(cid); process.exit(2); }

  const { data: rows } = await supabase.from('tasks').select('id, status').in('id', [idA, idB]);
  const ambasDone = (rows || []).length === 2 && rows.every((r) => r.status === 'done');
  const semDrop = !/(perdi o fio|perdi os dados|me manda de novo|manda de novo|n[ãa]o consegui registrar)/i.test(resp);
  console.log(`(a) as 2 tarefas DONE: ${ambasDone ? 'OK' : 'FALHOU'}`);
  console.log(`(b) resposta SEM drop: ${semDrop ? 'OK' : 'FALHOU'}`);

  const ok = ambasDone && semDrop;
  await limpar(cid);
  console.log(`\n[cenario-confirma-fechamento] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

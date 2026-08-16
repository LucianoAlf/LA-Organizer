#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-delegacao.js
// FATIA 5 (VERDE): intent com delegation={task_id, to_name} — o payload que o parse-on-open produz
// quando o TOM pergunta "Delego pra X — '…'. Confirma?". O usuário confirma → a branch nova
// determinística executa via applyTaskActions(delegate): a tarefa passa pro destinatário SEM cair
// no LLM. Prova o payoff: confirmação de delegação NÃO vira "perdi o fio".
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
const short = (id) => String(id).replace(/-/g, '').slice(0, 8);

async function idDe(nome) {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', nome).maybeSingle();
  if (!data) throw new Error(`perfil ${nome} não existe`);
  return data.id;
}
async function limpar(cid1, cid2) {
  await supabase.from('tasks').delete().eq('created_by', cid1).ilike('title', 'QA Delegar%');
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid1);
  await supabase.from('pending_intents').delete().eq('collaborator_id', cid1);
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-deleg-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}
async function ultimaResposta(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history').select('content').eq('collaborator_id', cid)
    .eq('direction', 'outbound').gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(6);
  return (data || []).map((m) => m.content || '').join('\n---\n');
}

(async () => {
  const cid1 = await idDe(QA1_NOME);
  const cid2 = await idDe(QA2_NOME);
  await limpar(cid1, cid2);
  const { data: tk } = await supabase.from('tasks').insert({
    assigned_to: cid1, created_by: cid1, title: 'QA Delegar ZZ', status: 'pending',
    due_date: new Date().toISOString().slice(0, 10),
  }).select('id').single();

  await supabase.from('pending_intents').insert({
    collaborator_id: cid1, kind: 'confirmation',
    payload: { delegation: { task_id: short(tk.id), to_name: QA2_NOME },
      last_user_text: 'delega pro QA2', last_tom_reply: `Delego pra ${QA2_NOME} — *"QA Delegar ZZ"*. Confirma?` },
    question_text: `Delego pra ${QA2_NOME} — *"QA Delegar ZZ"*. Confirma?`, asked_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'Confirma');
  await dorme(40000);
  const resp = await ultimaResposta(cid1, t0);
  console.log(`[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (!resp.trim()) { console.error('SEM RESPOSTA (timeout?). exit 2'); await limpar(cid1, cid2); process.exit(2); }

  const { data: t2 } = await supabase.from('tasks').select('status, assigned_to').eq('id', tk.id).maybeSingle();
  const delegou = !!(t2 && t2.status === 'delegated' && t2.assigned_to === cid2);
  const semDrop = !/(perdi o fio|perdi os dados|me manda de novo|manda de novo|n[ãa]o consegui registrar)/i.test(resp);
  console.log(`(a) tarefa delegated + assigned_to=QA2: ${delegou ? 'OK' : 'FALHOU'}`);
  console.log(`(b) resposta SEM drop: ${semDrop ? 'OK' : 'FALHOU'}`);

  const ok = delegou && semDrop;
  await limpar(cid1, cid2);
  console.log(`\n[cenario-confirma-delegacao] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

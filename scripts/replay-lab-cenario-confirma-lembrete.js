#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-lembrete.js
// FATIA 1 (VERDE): lembrete de tarefa (sendAndLink grava ref_type='task') → "feito" solto →
// a tarefa fica DONE, sem all_failed, sem "não consegui registrar", e a confirmação sai na voz.
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');
const proactiveLink = require('../src/services/proactive-link');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA_NOME = '[QA] Replay 01';
if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET/TOM_QA_PHONES'); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function perfil() {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', QA_NOME).maybeSingle();
  if (!data) throw new Error(`perfil ${QA_NOME} não existe`);
  return data.id;
}
async function limpar(cid) {
  await supabase.from('tasks').delete().eq('assigned_to', cid).ilike('title', 'QA Bombinha%');
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid);
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-cfr-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}
async function ultimaResposta(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history').select('content').eq('collaborator_id', cid)
    .eq('direction', 'outbound').gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(5);
  return (data || []).map((m) => m.content || '').join('\n---\n');
}

(async () => {
  const cid = await perfil();
  await limpar(cid);
  const { data: tk } = await supabase.from('tasks').insert({
    assigned_to: cid, created_by: cid, title: 'QA Bombinha do dia', status: 'pending',
    due_date: new Date().toISOString().slice(0, 10),
  }).select('id, title').single();
  // Lembrete REAL — grava ref_type='task' em conversation_history, igual produção.
  await proactiveLink.sendAndLink(supabase, { phone: QA_PHONE, content: `⏰ lembrete: *${tk.title}* — tudo certo?`, collaboratorId: cid, refType: 'task', refId: tk.id });
  await dorme(1500);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'feito');
  await dorme(45000);
  const resp = await ultimaResposta(cid, t0);
  console.log(`\n[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 220)}`);

  if (!resp.trim()) { console.error('SEM RESPOSTA — instrumento não mediu (timeout?). exit 2'); await limpar(cid); process.exit(2); }
  const { data: tk2 } = await supabase.from('tasks').select('status').eq('id', tk.id).maybeSingle();

  const ficouDone = tk2 && tk2.status === 'done';
  const disseNaoConsegui = /n[ãa]o consegui registrar/i.test(resp);
  console.log(`(a) tarefa DONE: ${ficouDone ? 'OK' : 'FALHOU'}`);
  console.log(`(b) NÃO disse "não consegui registrar": ${!disseNaoConsegui ? 'OK' : 'FALHOU'}`);
  const ok = ficouDone && !disseNaoConsegui;
  await limpar(cid);
  console.log(`\n[cenario-confirma-lembrete] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

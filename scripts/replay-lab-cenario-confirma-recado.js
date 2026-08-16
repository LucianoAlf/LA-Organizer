#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-recado.js
// FATIA 3 (VERDE): intent de coordenação com coordination.items ESTRUTURADO — exatamente o
// payload que o parse-on-open (coord-question-parse) produz quando o TOM pergunta "Aviso o X?
// Segue o texto: '…'. Confirma?". O usuário confirma → o executor determinístico (@engine 10221)
// resolve o intent e despacha SEM cair no LLM. Prova o payoff: confirmação NÃO vira "perdi o fio".
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA1_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA1_NOME = '[QA] Replay 01';   // requester (confirma)
const QA2_NOME = '[QA] Replay 02';   // destinatário do recado
if (!SEGREDO || !QA1_PHONE) { console.error('faltou WEBHOOK_SECRET/TOM_QA_PHONES'); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function idDe(nome) {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', nome).maybeSingle();
  if (!data) throw new Error(`perfil ${nome} não existe`);
  return data.id;
}
async function limpar(cid1, cid2) {
  await supabase.from('pending_intents').delete().eq('collaborator_id', cid1);
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid1);
  await supabase.from('coordination_requests').delete().eq('requester_id', cid1).eq('recipient_id', cid2);
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-rec-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
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

  // Intent aberto com coordination.items — IGUAL ao que o parse-on-open grava.
  await supabase.from('pending_intents').insert({
    collaborator_id: cid1, kind: 'confirmation',
    payload: { coordination: { items: [{ recipient_name: QA2_NOME, message_body: 'Teste replay: confirma presença amanhã às 10h.', mode: 'relay_assisted' }] },
      last_user_text: 'avisa o QA2', last_tom_reply: `Aviso o ${QA2_NOME}? Segue o texto: "Teste replay: confirma presença amanhã às 10h." Confirma?` },
    question_text: `Aviso o ${QA2_NOME}? Confirma?`, asked_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA1_PHONE, 'Confirma');
  await dorme(40000);
  const resp = await ultimaResposta(cid1, t0);
  console.log(`[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (!resp.trim()) { console.error('SEM RESPOSTA (timeout?). exit 2'); await limpar(cid1, cid2); process.exit(2); }

  // (a) o intent foi RESOLVIDO determinístico (não ficou pendente pro LLM).
  const { data: pend } = await supabase.from('pending_intents').select('resolution, resolved_at')
    .eq('collaborator_id', cid1).order('asked_at', { ascending: false }).limit(1).maybeSingle();
  const resolvido = !!(pend && pend.resolved_at && pend.resolution === 'confirmed');
  // (b) a resposta NÃO é o sintoma de drop ("perdi o fio / me manda de novo / não consegui").
  const semDrop = !/(perdi o fio|perdi os dados|me manda de novo|manda de novo|n[ãa]o consegui registrar)/i.test(resp);
  // (c) recado despachado: row em coordination_requests (bônus — prova o envio determinístico).
  const { data: cr } = await supabase.from('coordination_requests').select('id, status')
    .eq('requester_id', cid1).eq('recipient_id', cid2).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const despachou = !!cr;

  console.log(`(a) intent resolvido confirmed: ${resolvido ? 'OK' : 'FALHOU'}`);
  console.log(`(b) resposta SEM drop ("perdi o fio"): ${semDrop ? 'OK' : 'FALHOU'}`);
  console.log(`(c) coordination_requests criada: ${despachou ? 'OK (' + cr.status + ')' : 'não (destinatário QA pode não resolver — não é falha do contrato)'}`);

  const ok = resolvido && semDrop;   // o contrato é: confirmar resolve determinístico, sem drop.
  await limpar(cid1, cid2);
  console.log(`\n[cenario-confirma-recado] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

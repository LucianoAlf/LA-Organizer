#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-recado-implicito-despacha.js
// FATIA 8 (VERDE): intent SÓ-TEXTO cuja pergunta é uma proposta de recado IMPLÍCITO ("Mando um
// recado pro [QA2] agradecendo a ajuda? Confirma?"). O usuário confirma → o confirm-coord-gate
// libera: instrui o LLM a compor+emitir COORDINATION_REQUEST, e o handler DESPACHA DIRETO
// (preConfirmed, sem re-estagiar). Antes: caía no "desiste, me manda de novo" e dropava.
// Prova: coordination_requests row despachada + SEM loop/re-pergunta + SEM "não avisei ninguém".
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA1_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA1_NOME = '[QA] Replay 01';
const QA2_NOME = '[QA] Replay 02';
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
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-recimpd-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
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

  // Intent só-texto cuja pergunta é um recado IMPLÍCITO (sem texto citado) — o que a Fatia 3 deixa
  // fail-closed e o gate da Fatia 8 agora resolve.
  await supabase.from('pending_intents').insert({
    collaborator_id: cid1, kind: 'confirmation',
    payload: { last_user_text: `agradece o ${QA2_NOME} pela ajuda`, last_tom_reply: `Mando um recado pro ${QA2_NOME} agradecendo a ajuda de hoje? Confirma?` },
    question_text: `Mando um recado pro ${QA2_NOME} agradecendo a ajuda de hoje? Confirma?`, asked_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA1_PHONE, 'Confirma');
  await dorme(45000);
  const resp = await ultimaResposta(cid1, t0);
  console.log(`[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (!resp.trim()) { console.error('SEM RESPOSTA (timeout?). exit 2'); await limpar(cid1, cid2); process.exit(2); }

  const { data: cr } = await supabase.from('coordination_requests').select('id, status')
    .eq('requester_id', cid1).eq('recipient_id', cid2).gt('created_at', t0).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const despachou = !!cr;
  const semDropELoop = !/(perdi o fio|me manda de novo|manda de novo|não avisei ninguém|nao avisei ninguem|não consegui|confirma\?)/i.test(resp);
  console.log(`(a) coordination_requests despachada (sem re-estagiar): ${despachou ? 'OK (' + cr.status + ')' : 'FALHOU (não despachou)'}`);
  console.log(`(b) resposta SEM drop/loop: ${semDropELoop ? 'OK' : 'FALHOU (dropou ou re-perguntou)'}`);

  const ok = despachou && semDropELoop;
  await limpar(cid1, cid2);
  console.log(`\n[cenario-confirma-recado-implicito-despacha] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

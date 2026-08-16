#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-recado-implicito.js
// FATIA 3 (VERMELHO / fail-closed): pergunta de coordenação com mensagem IMPLÍCITA ("Aviso o X
// sobre a reunião? Confirma?") — o parse-on-open retorna null, então o intent fica só-texto (sem
// coordination.items). No "sim", NADA de recado é fabricado: o executor determinístico não roda e
// o caminho honesto assume. Prova que fail-closed NÃO manda mensagem errada pra uma pessoa real.
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
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-recimp-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}

(async () => {
  const cid1 = await idDe(QA1_NOME);
  const cid2 = await idDe(QA2_NOME);
  await limpar(cid1, cid2);

  // Intent SÓ-TEXTO (o que o parse-on-open deixa quando a mensagem é implícita) — SEM coordination.items.
  await supabase.from('pending_intents').insert({
    collaborator_id: cid1, kind: 'confirmation',
    payload: { last_user_text: 'avisa o QA2 sobre a reunião', last_tom_reply: `Aviso o ${QA2_NOME} sobre a reunião de amanhã? Confirma?` },
    question_text: `Aviso o ${QA2_NOME} sobre a reunião de amanhã? Confirma?`, asked_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA1_PHONE, 'Confirma');
  await dorme(40000);

  // Fail-closed: NENHUM recado fabricado (sem coordination.items, o executor não roda).
  const { data: cr } = await supabase.from('coordination_requests').select('id, status')
    .eq('requester_id', cid1).eq('recipient_id', cid2).gt('created_at', t0).limit(1).maybeSingle();
  const semRecado = !cr;
  console.log(`(a) NENHUM recado fabricado (fail-closed): ${semRecado ? 'OK' : 'FALHOU (mandou recado sem texto explícito!)'}`);

  const ok = semRecado;
  await limpar(cid1, cid2);
  console.log(`\n[cenario-confirma-recado-implicito] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

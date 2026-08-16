#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-lembrete-vermelho.js
// FATIA 1 (VERMELHO — freio #4): a conclusão determinística FALHA (tarefa é de OUTRO dono, então
// resolveTaskByShortId volta null → okCount 0). O interceptor NÃO pode setar deterministic_complete_ok,
// então o guard/honestidade NÃO é suprimido: a tarefa NÃO fica done e NÃO sai falso sucesso.
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA1_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA1_NOME = '[QA] Replay 01';   // responde "feito"
const QA2_NOME = '[QA] Replay 02';   // DONO da tarefa (o complete do QA1 tem que falhar)
if (!SEGREDO || !QA1_PHONE) { console.error('faltou WEBHOOK_SECRET/TOM_QA_PHONES'); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function idDe(nome) {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', nome).maybeSingle();
  if (!data) throw new Error(`perfil ${nome} não existe`);
  return data.id;
}
async function limpar(cid1, cid2) {
  await supabase.from('tasks').delete().eq('assigned_to', cid2).ilike('title', 'QA Vermelho%');
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid1);
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-cfrv-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}
async function ultimaResposta(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history').select('content').eq('collaborator_id', cid)
    .eq('direction', 'outbound').gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(5);
  return (data || []).map((m) => m.content || '').join('\n---\n');
}

(async () => {
  const cid1 = await idDe(QA1_NOME);
  const cid2 = await idDe(QA2_NOME);
  await limpar(cid1, cid2);
  // Tarefa é do QA2 (dono), pendente hoje.
  const { data: tk } = await supabase.from('tasks').insert({
    assigned_to: cid2, created_by: cid2, title: 'QA Vermelho alheio', status: 'pending',
    due_date: new Date().toISOString().slice(0, 10),
  }).select('id, title').single();
  // Ref de lembrete gravada no histórico do QA1 apontando pra tarefa do QA2 — força o caminho
  // exato do resolvedor, mas o complete por id do QA1 vai falhar (não é dele).
  await supabase.from('conversation_history').insert({
    collaborator_id: cid1, direction: 'outbound', message_type: 'text',
    content: `⏰ lembrete: *${tk.title}* — tudo certo?`, ref_type: 'task', ref_id: tk.id,
    created_at: new Date().toISOString(),
  });
  await dorme(800);

  const t0 = new Date().toISOString();
  await falar(QA1_PHONE, 'feito');
  await dorme(45000);
  const resp = await ultimaResposta(cid1, t0);
  console.log(`\n[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 220)}`);

  if (!resp.trim()) { console.error('SEM RESPOSTA — instrumento não mediu (timeout?). exit 2'); await limpar(cid1, cid2); process.exit(2); }
  const { data: tk2 } = await supabase.from('tasks').select('status').eq('id', tk.id).maybeSingle();

  // Freio #4: o complete falhou → tarefa NÃO fica done E não sai falso sucesso (guard não suprimido).
  const naoFicouDone = !tk2 || tk2.status !== 'done';
  const semFalsoSucesso = !/(conclu[ií]|registrei|✅)/i.test(resp);
  console.log(`(a) tarefa do QA2 NÃO ficou done: ${naoFicouDone ? 'OK' : 'FALHOU (completou tarefa alheia!)'}`);
  console.log(`(b) resposta SEM falso sucesso (guard não suprimido): ${semFalsoSucesso ? 'OK' : 'FALHOU (afirmou conclusão falsa!)'}`);
  const ok = naoFicouDone && semFalsoSucesso;
  await limpar(cid1, cid2);
  console.log(`\n[cenario-confirma-lembrete-vermelho] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

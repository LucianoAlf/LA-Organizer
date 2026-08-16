#!/usr/bin/env node
// scripts/replay-lab-cenario-lembrete-hora-visivel.js
// FATIA 6 (#1, VERDE): "me lembra às 7h ..." → o TOM cria a tarefa com remind_at=7h BRT (o lembrete
// dispara) E a resposta MOSTRA a hora — seja porque o TOM já disse, seja porque o notice
// determinístico "🔔 Lembro às 7h" foi anexado. Antes, a fala às vezes só dava a data e a pessoa
// achava que a hora sumiu. NÃO-VÁCUO: exige (a) tarefa com remind_at=7h e (b) a hora visível na fala.
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
  await supabase.from('tasks').delete().eq('assigned_to', cid).ilike('title', '%QA Lembrete%');
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid);
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-lemb-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}
async function ultimaResposta(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history').select('content').eq('collaborator_id', cid)
    .eq('direction', 'outbound').gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(6);
  return (data || []).map((m) => m.content || '').join('\n---\n');
}
function horaBRT(iso) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).formatToParts(d);
  return Number((p.find((x) => x.type === 'hour') || {}).value) % 24;
}

(async () => {
  const cid = await idDe(QA_NOME);
  await limpar(cid);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'Tom, amanhã me lembra às 7h de ligar pro fornecedor QA Lembrete ZZ');
  await dorme(45000);
  const resp = await ultimaResposta(cid, t0);
  console.log(`[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 220)}`);
  if (!resp.trim()) { console.error('SEM RESPOSTA (timeout?). exit 2'); await limpar(cid); process.exit(2); }

  const { data: tk } = await supabase.from('tasks').select('id, remind_at')
    .eq('assigned_to', cid).gt('created_at', t0).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!tk) { console.error('INCONCLUSIVO: TOM não criou tarefa neste turno. exit 2'); await limpar(cid); process.exit(2); }

  const temRemind7 = !!(tk.remind_at && horaBRT(tk.remind_at) === 7);
  const horaVisivel = /(?<!\d)0?7\s*(?:h|:)/i.test(resp);
  console.log(`(a) tarefa com remind_at=7h BRT: ${temRemind7 ? 'OK' : 'FALHOU (remind_at=' + tk.remind_at + ')'}`);
  console.log(`(b) hora 7h VISÍVEL na resposta: ${horaVisivel ? 'OK' : 'FALHOU (a fala escondeu a hora)'}`);

  const ok = temRemind7 && horaVisivel;
  await limpar(cid);
  console.log(`\n[cenario-lembrete-hora-visivel] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

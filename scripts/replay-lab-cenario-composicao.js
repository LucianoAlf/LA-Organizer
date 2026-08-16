#!/usr/bin/env node
// scripts/replay-lab-cenario-composicao.js
// FATIA 2 (VERDE): turno de COMPOSIÇÃO (caso Rose ADM 14/08). O usuário pede pra o TOM montar
// uma mensagem e vai ditando os pontos. O TOM ecoa/anota o rascunho ("Anotado! Pode mandar o
// próximo") — content-solicitation + verbo de conclusão. ANTES da Fatia 2 o chokepoint colava
// "_não consegui registrar_" (falso-fire, às vezes comendo a resposta inteira). Agora NÃO cola.
//
// NÃO-VACUIDADE: só conta como PASS um turno em que a reply REALMENTE tem a forma que dispararia
// o rodapé — hasCompletionClaim(reply) && isContentSolicitationReply(reply) — e mesmo assim veio
// SEM rodapé. Se em nenhum turno o LLM produziu essa forma, o cenário é INCONCLUSIVO (exit 2),
// nunca verde vazio. Se em QUALQUER turno de composição vier o rodapé → FALHA.
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');
const { hasCompletionClaim } = require('../src/lib/optimistic-confirm');
const { isContentSolicitationReply } = require('../src/services/reply-classify');

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
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid);
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-comp-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}
async function ultimaResposta(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history').select('content').eq('collaborator_id', cid)
    .eq('direction', 'outbound').gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(6);
  return (data || []).map((m) => m.content || '').join('\n---\n');
}
const temRodape = (s) => /n[ãa]o consegui registrar/i.test(s);

(async () => {
  const cid = await perfil();
  await limpar(cid);

  // Turno 1: abre o modo composição.
  let t0 = new Date().toISOString();
  await falar(QA_PHONE, 'Tom, me ajuda a montar uma mensagem de alinhamento pra ADM? Vou te mandando os pontos, um por um.');
  await dorme(40000);
  let r1 = await ultimaResposta(cid, t0);
  console.log(`[t1] ${r1.replace(/\s+/g, ' ').slice(0, 160)}`);
  if (r1 && temRodape(r1)) { console.error('FALHOU no t1: rodapé em turno de composição'); await limpar(cid); process.exit(1); }

  // Turnos de item: o TOM tende a responder "Anotado! Manda o próximo" (a forma que dispararia).
  const itens = [
    'Ter atenção nos valores dos comprovantes e nos recebimentos do Emusys',
    'Conferir os boletos antes de pagar',
    'Revisar a planilha de gestão toda sexta',
  ];
  let provou = false;
  for (const item of itens) {
    t0 = new Date().toISOString();
    await falar(QA_PHONE, item);
    await dorme(40000);
    const r = await ultimaResposta(cid, t0);
    const claim = hasCompletionClaim(r);
    const solicit = isContentSolicitationReply(r);
    console.log(`[item] claim=${claim} solicit=${solicit} rodape=${temRodape(r)} :: ${r.replace(/\s+/g, ' ').slice(0, 150)}`);
    if (!r.trim()) { console.error('SEM RESPOSTA (timeout?) — instrumento não mediu. exit 2'); await limpar(cid); process.exit(2); }
    if (temRodape(r)) { console.error('FALHOU: rodapé de erro em turno de composição'); await limpar(cid); process.exit(1); }
    // Não-vacuidade: reply tem a forma que ANTES disparava o rodapé, e mesmo assim não veio.
    if (claim && solicit) { provou = true; break; }
  }

  await limpar(cid);
  if (!provou) {
    console.error('INCONCLUSIVO: o LLM não produziu claim+solicitation em nenhum turno (sem prova de não-vacuidade). exit 2');
    process.exit(2);
  }
  console.log('\n[cenario-composicao] PASSOU (claim+solicitation sem rodapé — falso-fire fechado)');
  process.exit(0);
})();

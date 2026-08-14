#!/usr/bin/env node
// scripts/replay-lab-cenario-pay-invoice.js
// CENÁRIO E do Replay Lab — o caso Rose de verdade: "paguei a fatura X com conta Y" onde Y
// é NOME AMBÍGUO (existe conta E cartão com o mesmo nome).
//
// O INCIDENTE REAL (14/08, prints + logs da VPS):
//   10:36 Rose: "Paguei a fatura nubank com conta mercado pago"
//   10:37 TOM: "Qual cartão você pagou? Tenho: ..." (card ficou vazio no marker)
//   10:37 Rose: "Cartão Nubank"                    ← resposta EXATA, sem ambiguidade
//   10:37 TOM: "Qual cartão você pagou? Tenho: ..." ← REPETIU A MESMA PERGUNTA
//   10:38 Rose: "Cartão Nubank" (de novo)
//   10:38 TOM: "A fatura do Cartão Nubank está zerada." ← mês errado (ciclo aberto, não o fechado)
//   10:39 TOM: "Qual cartão você pagou? ..." ← repetiu de novo
// 14 minutos, ~6 idas e vindas, resolvida por um caminho totalmente diferente (foto da fatura).
//
// DUAS RAÍZES (achadas nos logs reais, corrigidas em 14/08):
//   1. defaultPayableCompetencia — pay_invoice/stagePayInvoice usavam o ciclo ABERTO como
//      padrão. Fatura fechada com saldo é a que se quer pagar sem dizer o mês.
//   2. card-pick — pay_invoice/query_invoice/card_refund perguntavam "Qual cartão?" em texto
//      solto, sem pending-intent. card_purchase já resolvia isso; os 3 irmãos ficaram de fora.
// + afinamento de skill: "fatura X com conta Y" — Y é sempre from_account, mesmo quando Y
//   também é nome de cartão cadastrado (era a suspeita de origem da ambiguidade do turno 1).
//
// O QUE ESTE CENÁRIO PROVA
//   (a) a fatura resolvida é a FECHADA com saldo, não o ciclo aberto (raiz 1);
//   (b) se o TOM perguntar "qual cartão", a resposta seguinte NUNCA repete a mesma pergunta
//       (raiz 2 — a prova central, é o que ela viveu 3 vezes);
//   (c) o cartão distrator com nome colidente ("Cartão Mercado Pago") NUNCA recebe o
//       pagamento — só o Nubank.
//
//   node --env-file=.env scripts/replay-lab-cenario-pay-invoice.js
'use strict';

const crypto = require('crypto');
const supabase = require('../src/supabase/client');
const financeService = require('../src/services/financeiro-service');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA_NOME = '[QA] Replay 01';

if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET ou TOM_QA_PHONES'); process.exit(1); }

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function perfilQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name').eq('full_name', QA_NOME).maybeSingle();
  if (!data) throw new Error(`perfil ${QA_NOME} não existe`);
  return data;
}

async function limpar(cid) {
  const { data: cards } = await supabase.from('pf_cards').select('id').eq('collaborator_id', cid);
  for (const c of cards || []) {
    await supabase.from('pf_transactions').delete().eq('card_id', c.id);
    await supabase.from('pf_card_payments').delete().eq('card_id', c.id);
  }
  await supabase.from('pf_cards').delete().eq('collaborator_id', cid);
  await supabase.from('pf_accounts').delete().eq('collaborator_id', cid);
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid);
}

/**
 * Mesmo formato do incidente real: cartão Nubank (closing_day=7, due_day=14) + conta
 * "Mercado Pago" (o destino real da frase) + cartão DISTRATOR "Cartão Mercado Pago" (o nome
 * que colide — é isso que testa se o TOM confunde fonte com alvo). A fatura fechada é
 * calculada a partir de HOJE, não hardcoded — o cenário não pode apodrecer com o calendário.
 */
async function montarFixture(cid) {
  await limpar(cid);
  const conta = await financeService.createAccount(cid, { name: 'Mercado Pago', type: 'checking' });
  const nubank = await financeService.createCard(cid, { name: 'Cartão Nubank', credit_limit: 5000, closing_day: 7, due_day: 14 });
  await financeService.createCard(cid, { name: 'Cartão Mercado Pago', credit_limit: 3000, closing_day: 5, due_day: 12 }); // distrator

  // Competência FECHADA (mês anterior à corrente, já passou do dia 7) com saldo em aberto —
  // exatamente o estado que produziu "está zerada" quando o default usava o ciclo aberto.
  const hoje = new Date();
  const compFechada = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  await financeService.insertCardPurchase(cid, nubank, {
    category: 'compras', amount: 593.32, description: 'Fatura fechada (fixture)',
    transaction_date: compFechada, installments: 1, competencia: compFechada,
  });
  return { conta, nubank, compFechada };
}

async function respostaDoTom(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history')
    .select('content, created_at').eq('collaborator_id', cid).eq('direction', 'outbound')
    .gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(5);
  return (data || []).map((m) => m.content || '').join('\n---\n').trim();
}

async function falar(phone, texto) {
  const corpo = JSON.stringify({
    EventType: 'messages',
    message: { id: `qa-payinv-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false },
  });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo,
  });
}

const PERGUNTOU_QUAL_CARTAO = (t) => /qual cart[ãa]o/i.test(t);
const DISSE_ZERADA = (t) => /est[áa] zerada/i.test(t);

(async () => {
  const collab = await perfilQA();
  const { compFechada } = await montarFixture(collab.id);
  console.log(`[cenario-pay-invoice] perfil=${collab.full_name} fatura fechada em aberto: ${compFechada} (R$593,32)`);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'Paguei a fatura nubank com conta mercado pago');
  await dorme(30000);
  const r1 = await respostaDoTom(collab.id, t0);
  console.log(`\n[turno 1] TOM: ${r1.replace(/\s+/g, ' ').slice(0, 200)}`);

  let r2 = '';
  const perguntouNoT1 = PERGUNTOU_QUAL_CARTAO(r1);
  if (perguntouNoT1) {
    console.log('  ↳ TOM pediu pra escolher o cartão — respondendo "Cartão Nubank" (literal da Rose)');
    const t1 = new Date().toISOString();
    await falar(QA_PHONE, 'Cartão Nubank');
    await dorme(20000);
    r2 = await respostaDoTom(collab.id, t1);
    console.log(`[turno 2] TOM: ${r2.replace(/\s+/g, ' ').slice(0, 200)}`);
  }

  // ---- Veredito ----
  const repetiuAPergunta = perguntouNoT1 && PERGUNTOU_QUAL_CARTAO(r2);
  const disseZeradaIndevido = DISSE_ZERADA(r1) || DISSE_ZERADA(r2);

  const { data: pagamentos } = await supabase.from('pf_card_payments')
    .select('amount, card_id, pf_cards(name)').eq('collaborator_id', collab.id);
  const pagouNubank = (pagamentos || []).some((p) => p.pf_cards && p.pf_cards.name === 'Cartão Nubank' && Number(p.amount) > 0);
  const pagouODistrator = (pagamentos || []).some((p) => p.pf_cards && p.pf_cards.name === 'Cartão Mercado Pago');

  console.log('\n--- veredito ---');
  console.log(`(a) NÃO disse "está zerada" indevidamente: ${!disseZeradaIndevido ? 'OK' : 'FALHOU'}`);
  console.log(`(b) NÃO repetiu a mesma pergunta após resposta exata: ${!repetiuAPergunta ? 'OK' : 'FALHOU'}`);
  console.log(`(c) pagou o Nubank (não o distrator): ${pagouNubank && !pagouODistrator ? 'OK' : `pagouNubank=${pagouNubank} pagouDistrator=${pagouODistrator}`}`);

  const ok = !disseZeradaIndevido && !repetiuAPergunta;
  await limpar(collab.id);
  console.log(`\n[cenario-pay-invoice] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();

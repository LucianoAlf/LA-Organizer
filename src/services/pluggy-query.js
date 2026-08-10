// src/services/pluggy-query.js — consultas de saldo/fatura/investimento ao Pluggy (fresh).
// D3 usa sumBankBalances; D5 expande (fatura, investimento sob demanda). require supabase LAZY.
const pluggy = require('./pluggy');

// Soma o saldo das contas BANK (corrente) de todos os itens ativos do colaborador. Saldo real "agora".
async function sumBankBalances(collaboratorId) {
  const supabase = require('../supabase/client');
  const { data: items } = await supabase.from('pf_pluggy_items')
    .select('pluggy_item_id').eq('collaborator_id', collaboratorId).eq('is_active', true);
  let total = 0;
  for (const it of (items || [])) {
    try {
      const accounts = await pluggy.fetchAccounts(it.pluggy_item_id);
      for (const ac of accounts) if (String(ac.type).toUpperCase() === 'BANK') total += Number(ac.balance) || 0;
    } catch (e) { /* item indisponível agora: ignora no total */ }
  }
  return total;
}

// Auto-vincula conta-Pluggy (BANK) ↔ conta-do-app por banco (best-effort, só quando 1:1). (D4)
async function autoLinkBankAccounts(collaboratorId) {
  const supabase = require('../supabase/client');
  const { matchBankSlug } = require('./financeiro-service');
  const { data: maps } = await supabase.from('pf_pluggy_account_map')
    .select('id, pluggy_item_id, display_name').eq('collaborator_id', collaboratorId)
    .eq('kind', 'account').is('pf_account_id', null);
  if (!maps || !maps.length) return 0;
  const { data: items } = await supabase.from('pf_pluggy_items').select('pluggy_item_id, connector_name').eq('collaborator_id', collaboratorId);
  const itemBank = {}; for (const it of (items || [])) itemBank[it.pluggy_item_id] = it.connector_name;
  const { data: accounts } = await supabase.from('pf_accounts').select('id, name, bank_slug').eq('collaborator_id', collaboratorId).eq('is_active', true);
  let linked = 0;
  for (const mp of maps) {
    const slug = matchBankSlug(itemBank[mp.pluggy_item_id] || mp.display_name);
    if (!slug) continue;
    const cand = (accounts || []).filter((a) => a.bank_slug === slug || matchBankSlug(a.name) === slug);
    if (cand.length === 1) {
      await supabase.from('pf_pluggy_account_map').update({ pf_account_id: cand[0].id }).eq('id', mp.id);
      linked++;
    }
  }
  return linked;
}

// Saldo real (Pluggy) × saldo do app por conta vinculada → divergências acima do limiar. (D4)
async function balanceDivergences(collaboratorId, { threshold = 1 } = {}) {
  const supabase = require('../supabase/client');
  const { data: maps } = await supabase.from('pf_pluggy_account_map')
    .select('pluggy_account_id, pluggy_item_id, pf_account_id').eq('collaborator_id', collaboratorId)
    .eq('kind', 'account').not('pf_account_id', 'is', null);
  if (!maps || !maps.length) return [];
  const realById = {};
  for (const itemId of [...new Set(maps.map((m) => m.pluggy_item_id))]) {
    try { for (const ac of await pluggy.fetchAccounts(itemId)) realById[ac.id] = Number(ac.balance) || 0; } catch (e) { /* skip */ }
  }
  const { data: pfAccs } = await supabase.from('pf_accounts').select('id, name, balance').in('id', maps.map((m) => m.pf_account_id));
  const pfById = {}; for (const a of (pfAccs || [])) pfById[a.id] = a;

  // FIN-DIVERG-CONTA-VAZIA: quantos lançamentos a conta do app tem. Conta que nunca foi usada
  // acusa o saldo real inteiro como "faltando" — todo dia, sem ação possível de quem lê.
  // null = não consegui medir, e aí a divergência é reportada (não medir ≠ estar tudo bem).
  const lancPorConta = {};
  await Promise.all([...new Set(maps.map((m) => m.pf_account_id))].map(async (id) => {
    try {
      const { count } = await supabase.from('pf_transactions')
        .select('id', { count: 'exact', head: true }).eq('account_id', id);
      lancPorConta[id] = Number.isFinite(count) ? count : null;
    } catch (_) { lancPorConta[id] = null; }
  }));

  const linhas = [];
  for (const mp of maps) {
    const real = realById[mp.pluggy_account_id];
    const app = pfById[mp.pf_account_id];
    if (real == null || !app) continue;
    linhas.push({
      conta: app.name, saldoApp: Number(app.balance), saldoReal: real,
      lancamentos: lancPorConta[mp.pf_account_id],
    });
  }
  const { filtraDivergencias } = require('../finance/divergencia-saldo');
  const r = filtraDivergencias(linhas, { threshold });
  // Silenciar o alerta sem deixar rastro esconderia o mapeamento errado que o causou.
  if (r.contasVazias.length) {
    console.warn(`[Pluggy] mapa aponta pra conta do app SEM lançamentos: ${r.contasVazias.join(', ')} — cadastro duplicado?`);
  }
  return r.divergencias;
}

// --- Consulta realtime (D5): fetch fresh, filtra por banco (nome) ---
async function _itemsFor(collaboratorId, banco) {
  const supabase = require('../supabase/client');
  const { matchBankSlug } = require('./financeiro-service');
  const { data: items } = await supabase.from('pf_pluggy_items')
    .select('pluggy_item_id, connector_name').eq('collaborator_id', collaboratorId).eq('is_active', true);
  const want = banco ? matchBankSlug(banco) : null;
  return (items || []).filter((it) => !want || matchBankSlug(it.connector_name) === want);
}
async function bankBalances(collaboratorId, banco) {
  const out = [];
  for (const it of await _itemsFor(collaboratorId, banco)) {
    try { for (const ac of await pluggy.fetchAccounts(it.pluggy_item_id)) if (String(ac.type).toUpperCase() === 'BANK') out.push({ banco: it.connector_name, nome: ac.name, saldo: Number(ac.balance) || 0 }); } catch (e) { /* skip */ }
  }
  return out;
}
async function cardInvoices(collaboratorId, banco) {
  const out = [];
  for (const it of await _itemsFor(collaboratorId, banco)) {
    try {
      for (const ac of await pluggy.fetchAccounts(it.pluggy_item_id)) {
        if (String(ac.type).toUpperCase() !== 'CREDIT') continue;
        const cd = ac.creditData || {};
        // fatura REAL via /bills (totalAmount + dueDate). ac.balance = saldo devedor TOTAL (NÃO a fatura).
        let bills = [];
        try { bills = await pluggy.fetchBills(ac.id); } catch (e) { bills = []; }
        out.push({
          banco: it.connector_name, nome: ac.name,
          saldoDevedor: Number(ac.balance) || 0,
          minimo: Number(cd.minimumPayment) || null,
          disponivel: cd.availableCreditLimit != null ? Number(cd.availableCreditLimit) : null,
          bills: (bills || []).filter((b) => b && b.dueDate)
            .map((b) => ({ valor: Number(b.totalAmount) || 0, vencimento: String(b.dueDate).slice(0, 10) })),
        });
      }
    } catch (e) { /* skip */ }
  }
  return out;
}
async function investments(collaboratorId, banco) {
  let total = 0, count = 0;
  for (const it of await _itemsFor(collaboratorId, banco)) {
    try { for (const iv of await pluggy.fetchInvestments(it.pluggy_item_id)) { const bal = Number(iv.balance) || 0; if (bal > 0) { total += bal; count++; } } } catch (e) { /* skip */ }
  }
  return { total, count };
}

module.exports = { sumBankBalances, autoLinkBankAccounts, balanceDivergences, bankBalances, cardInvoices, investments };

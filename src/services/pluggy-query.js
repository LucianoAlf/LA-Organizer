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

module.exports = { sumBankBalances };

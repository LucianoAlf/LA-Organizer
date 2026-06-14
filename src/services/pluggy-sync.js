// src/services/pluggy-sync.js — orquestra: itens do colaborador → contas/transações → staging.
// collaborator_id-first (service_role ignora RLS). Idempotente: upsert por pluggy_transaction_id.
// require do supabase é LAZY (dentro das funções) p/ os helpers puros testarem sem o client. (Fase D / D1)
const pluggy = require('./pluggy');
const { normalizeTxn } = require('../finance/pluggy-normalize');

function accountKind(acc) { return String(acc && acc.type).toUpperCase() === 'CREDIT' ? 'card' : 'account'; }
function daysAgo(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Descobre contas Pluggy do item e registra as novas em pf_pluggy_account_map (confirmed=false).
async function upsertAccountMap(collaboratorId, item, accounts) {
  const supabase = require('../supabase/client');
  for (const acc of accounts) {
    const { data: exist } = await supabase.from('pf_pluggy_account_map')
      .select('id').eq('pluggy_account_id', acc.id).maybeSingle();
    if (exist) continue;
    await supabase.from('pf_pluggy_account_map').insert({
      collaborator_id: collaboratorId,
      pluggy_account_id: acc.id,
      pluggy_item_id: item.pluggy_item_id,
      kind: accountKind(acc),
      display_name: (acc.name || item.connector_name || '').trim(),
      confirmed: false,
    });
  }
}

async function syncPluggy(collaboratorId, { todayYmd } = {}) {
  const supabase = require('../supabase/client');
  const today = todayYmd || new Date().toISOString().slice(0, 10);
  const { data: items } = await supabase.from('pf_pluggy_items')
    .select('*').eq('collaborator_id', collaboratorId).eq('is_active', true);
  let upserted = 0, accountsSeen = 0;
  for (const item of (items || [])) {
    const accounts = await pluggy.fetchAccounts(item.pluggy_item_id);
    accountsSeen += accounts.length;
    await upsertAccountMap(collaboratorId, item, accounts);
    const from = item.last_synced_at ? String(item.last_synced_at).slice(0, 10) : daysAgo(today, 60);
    for (const acc of accounts) {
      const kind = accountKind(acc);
      const txns = await pluggy.fetchTransactions(acc.id, { from });
      const rows = txns.map((t) => {
        const n = normalizeTxn(t, kind, today);
        return {
          collaborator_id: collaboratorId,
          pluggy_transaction_id: n.pluggyTransactionId,
          pluggy_account_id: n.pluggyAccountId,
          posted_date: n.postedDate,
          amount: n.amount,
          direction: n.direction,
          description: n.description,
          pluggy_category: n.category,
          raw: n.raw,
          status: n.isFuture ? 'future' : 'pending',
        };
      }).filter((r) => r.pluggy_transaction_id && r.posted_date);
      if (rows.length) {
        const { error } = await supabase.from('pf_pluggy_transactions')
          .upsert(rows, { onConflict: 'pluggy_transaction_id', ignoreDuplicates: true });
        if (!error) upserted += rows.length;
      }
    }
    await supabase.from('pf_pluggy_items')
      .update({ status: 'UPDATED', last_synced_at: new Date().toISOString() }).eq('id', item.id);
  }
  return { items: (items || []).length, accountsSeen, upserted };
}

module.exports = { syncPluggy, upsertAccountMap, accountKind, daysAgo };

// src/services/pluggy-reconcile.js — classifica o staging pending: matched/internal/noise/pending.
// require supabase LAZY. (Fase D / D2)
const { classify } = require('../finance/reconcile');

async function reconcileStaging(collaboratorId) {
  const supabase = require('../supabase/client');
  const { data: staging } = await supabase.from('pf_pluggy_transactions')
    .select('id, pluggy_account_id, direction, amount, posted_date, description, pluggy_category')
    .eq('collaborator_id', collaboratorId).eq('status', 'pending');
  if (!staging || !staging.length) return { matched: 0, noise: 0, internal: 0, pending: 0 };

  let minDate = staging[0].posted_date;
  for (const s of staging) if (s.posted_date < minDate) minDate = s.posted_date;
  const { data: appRaw } = await supabase.from('pf_transactions')
    .select('id, type, amount, transaction_date')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', minDate);
  const appTxns = (appRaw || []).map((a) => ({ id: a.id, direction: a.type === 'income' ? 'in' : 'out', amount: a.amount, transaction_date: a.transaction_date, _used: false }));

  const { data: peers } = await supabase.from('pf_pluggy_transactions')
    .select('id, direction, amount, posted_date, pluggy_account_id').eq('collaborator_id', collaboratorId);

  const counts = { matched: 0, noise: 0, internal: 0, pending: 0 };
  for (const txn of staging) {
    const r = classify(txn, { appTxns, peers });
    counts[r.status]++;
    if (r.status !== 'pending') {
      await supabase.from('pf_pluggy_transactions').update({
        status: r.status, matched_pf_transaction_id: r.matchedId || null, resolved_at: new Date().toISOString(),
      }).eq('id', txn.id);
    }
  }
  return counts;
}
module.exports = { reconcileStaging };

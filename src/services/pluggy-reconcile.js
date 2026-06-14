// src/services/pluggy-reconcile.js — classifica o staging pending: matched/internal/noise/pending.
// require supabase LAZY. (Fase D / D2)
const { classify } = require('../finance/reconcile');
const { emojiForPluggyCat, cleanLabel, ddmm } = require('../finance/reconcile-report');

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
// Dados do relatório: contagem de conciliados + top-N pendentes recentes (já formatados) + backlog.
async function reconcileReportData(collaboratorId, { topN = 6 } = {}) {
  const supabase = require('../supabase/client');
  const cnt = async (status) => (await supabase.from('pf_pluggy_transactions')
    .select('*', { count: 'exact', head: true }).eq('collaborator_id', collaboratorId).eq('status', status)).count || 0;
  const conciliadoCount = await cnt('matched');
  const pendingTotal = await cnt('pending');
  const { data: top } = await supabase.from('pf_pluggy_transactions')
    .select('amount, direction, posted_date, description, pluggy_category')
    .eq('collaborator_id', collaboratorId).eq('status', 'pending')
    .order('posted_date', { ascending: false }).limit(topN);
  const pendentes = (top || []).map((r) => ({
    emoji: emojiForPluggyCat(r.pluggy_category, r.direction),
    amount: Number(r.amount), direction: r.direction,
    label: cleanLabel(r.description), date: ddmm(r.posted_date),
  }));
  return { conciliadoCount, pendentes, pendingTotal, backlogExtra: Math.max(0, pendingTotal - pendentes.length) };
}

// Após um lançamento no app, casa um pendente Pluggy equivalente (mesmo valor/direção, ±5d) → matched.
// É o "elo de volta" (D3b): o usuário responde o relatório lançando, e o pendente fecha sozinho.
async function tryMatchPluggyPending(collaboratorId, { amount, direction, date, pfTxnId } = {}) {
  const supabase = require('../supabase/client');
  const amt = Math.abs(Number(amount) || 0);
  if (!amt || !direction) return null;
  const ymd = (date && String(date).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  const { data: cands } = await supabase.from('pf_pluggy_transactions')
    .select('id, amount, posted_date').eq('collaborator_id', collaboratorId)
    .eq('status', 'pending').eq('direction', direction);
  const { daysBetween } = require('../finance/reconcile');
  const hit = (cands || []).find((c) => Math.abs(Number(c.amount) - amt) < 0.01 && Math.abs(daysBetween(c.posted_date, ymd)) <= 5);
  if (!hit) return null;
  await supabase.from('pf_pluggy_transactions')
    .update({ status: 'matched', matched_pf_transaction_id: pfTxnId || null, resolved_at: new Date().toISOString() })
    .eq('id', hit.id);
  return hit;
}

module.exports = { reconcileStaging, reconcileReportData, tryMatchPluggyPending };

// src/rituals/conv-quality-format.js
// Formatação (pura) do bloco "qualidade de conversa" do relatório das 07h.
// Separado de health-check.js (que importa supabase/client, só-na-VPS) para ser
// testável isolado — mesmo padrão de group-report-builder.js.
'use strict';

const CONV_CAT_LABEL = {
  confabulation: 'confabulação/contradição',
  wrong_refusal: 'recusa indevida',
  media_fail: 'mídia falha',
  dropped_request: 'pedido largado',
  frustration: 'frustração',
  proactive_overreach: 'cobrança indevida',
};

// Pura: recebe findings JÁ filtrados por janela + a contagem de inativos.
// Separa suprimidos (auto_triage.decision==='suppress'), destaca regressões e
// monta o corpo com os "keep". NÃO toca DB. Exportada p/ teste.
function formatConvQuality(findings, opts = {}) {
  const inactiveCount = opts.inactiveCount || 0;
  const SEV_EMOJI = { alto: '🔴', medio: '🟠', baixo: '🟡' };
  const SEV_RANK = { alto: 0, medio: 1, baixo: 2 };
  const dec = f => (f.auto_triage && f.auto_triage.decision) || 'keep';
  const suppressed = findings.filter(f => dec(f) === 'suppress');
  const regressions = findings.filter(f => dec(f) === 'regression');
  const body = findings.filter(f => dec(f) === 'keep');

  const counts = [];
  if (inactiveCount) counts.push(`🗃️ ${inactiveCount} abertos de dias anteriores (painel)`);
  if (suppressed.length) {
    const codes = [...new Set(suppressed.map(f => f.auto_triage.matched_code).filter(Boolean))];
    counts.push(`🔇 ${suppressed.length} já-corrigidos${codes.length ? ' (' + codes.join(', ') + ')' : ''}`);
  }
  const countLine = counts.length ? `\n${counts.join(' · ')}` : '';

  if (!body.length && !regressions.length) {
    return { status: 'ok', detail: `🗣️ 0 falhas pra revisar${countLine}` };
  }

  const sevRk = f => (SEV_RANK[f.severity] != null ? SEV_RANK[f.severity] : 1);
  const regLines = regressions
    .sort((a, b) => sevRk(a) - sevRk(b))
    .map(f => `  • 🔁 REGRESSÃO [${f.auto_triage.matched_code || '?'}] ${String(f.summary).slice(0, 120)}`);

  const groups = {};
  for (const f of body) (groups[f.collaborator_id || 'unknown'] = groups[f.collaborator_id || 'unknown'] || []).push(f);
  const nameById = {};
  for (const f of body) nameById[f.collaborator_id] = f.collaborators?.full_name?.split(' ')[0] || '—';
  const worstOf = arr => Math.min(...arr.map(sevRk));
  const orderedPids = Object.keys(groups).sort((a, b) => {
    const d = worstOf(groups[a]) - worstOf(groups[b]);
    return d !== 0 ? d : groups[b].length - groups[a].length;
  });
  const blocks = orderedPids.map(pid => {
    const arr = groups[pid].slice().sort((x, y) => sevRk(x) - sevRk(y));
    const lines = arr.map(f => {
      const rec = (f.occurrences || 1) >= 2 ? `🔁${f.occurrences}× ` : '';
      const sev = SEV_EMOJI[f.severity] || '';
      return `  • ${sev} ${rec}[${CONV_CAT_LABEL[f.category] || f.category}] ${String(f.summary).slice(0, 120)}`;
    });
    return `*${nameById[pid] || '—'}* (${arr.length}):\n${lines.join('\n')}`;
  });

  const total = body.length + regressions.length;
  const head = regLines.length ? `🚨 ${regLines.length} regressão(ões):\n${regLines.join('\n')}\n\n` : '';
  return {
    status: 'warning',
    detail: `🗣️ ${total} falha(s) pra revisar:${countLine}\n${head}${blocks.join('\n\n')}`.trim(),
  };
}

module.exports = { formatConvQuality, CONV_CAT_LABEL };

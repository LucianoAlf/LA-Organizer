// src/rituals/conv-quality-format.js
// Formatação (pura) do bloco "qualidade de conversa" do relatório das 07h.
// Separado de health-check.js (que importa supabase/client, só-na-VPS) para ser
// testável isolado — mesmo padrão de group-report-builder.js.
'use strict';
const { cortarNaPalavra } = require('../lib/texto-curto');

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
  // "É mesmo regressão?" mora em regressao-reconcilia.js — fonte ÚNICA compartilhada com o
  // digest do grupo (ops-digest), pros dois relatórios nunca divergirem na frente do dono.
  // Promovido a um código DIFERENTE = raiz nova, não recorrência do matched_code (16/08).
  const { ehRegressaoConfirmada } = require('../lib/regressao-reconcilia');
  const suppressed = findings.filter(f => dec(f) === 'suppress');
  const regressions = findings.filter(ehRegressaoConfirmada);
  // corpo = tudo que não foi suprimido nem ficou como regressão (inclui o finding promovido a
  // raiz nova, que volta a ser uma falha normal pra revisar, sem o rótulo errado).
  const body = findings.filter(f => dec(f) !== 'suppress' && !ehRegressaoConfirmada(f));

  const counts = [];
  if (inactiveCount) counts.push(`🗃️ ${inactiveCount} ${inactiveCount === 1 ? "aberto" : "abertos"} de dias anteriores (painel)`);
  if (suppressed.length) {
    const codes = [...new Set(suppressed.map(f => f.auto_triage.matched_code).filter(Boolean))];
    counts.push(`🔇 ${suppressed.length} já-corrigidos${codes.length ? ' (' + codes.join(', ') + ')' : ''}`);
  }
  const countLine = counts.length ? `\n${counts.join(' · ')}` : '';

  if (!body.length && !regressions.length) {
    return { status: 'ok', detail: `🗣️ 0 falhas pra revisar${countLine}` };
  }

  // 30/09 (Alf: "está vindo bagunçado"): título em negrito, bloco por pessoa (👤) ou por GRUPO (👥)
  // quando o achado não tem pessoa — antes saía "*—*" —, item "• 🟠 Pedido largado — …" cortado na
  // palavra (antes: "prendendo a p", "Usuário confirmo").
  const sevRk = f => (SEV_RANK[f.severity] != null ? SEV_RANK[f.severity] : 1);
  const rotulo = (c) => { const s = CONV_CAT_LABEL[c] || c || ''; return s.charAt(0).toUpperCase() + s.slice(1); };
  const regLines = regressions
    .sort((a, b) => sevRk(a) - sevRk(b))
    .map(f => `• [${f.auto_triage.matched_code || '?'}] ${cortarNaPalavra(f.summary, 160)}`);

  const chave = (f) => (f.collaborator_id ? `p:${f.collaborator_id}` : `g:${f.grupo_nome || '?'}`);
  const groups = {};
  const tituloDe = {};
  for (const f of body) {
    const k = chave(f);
    (groups[k] = groups[k] || []).push(f);
    tituloDe[k] = f.collaborator_id
      ? `👤 *${(f.collaborators && f.collaborators.full_name ? f.collaborators.full_name.split(' ')[0] : 'Sem nome')}*`
      : `👥 *${f.grupo_nome || 'Sem pessoa identificada'}*`;
  }
  const worstOf = arr => Math.min(...arr.map(sevRk));
  const ordered = Object.keys(groups).sort((a, b) => {
    const d = worstOf(groups[a]) - worstOf(groups[b]);
    return d !== 0 ? d : groups[b].length - groups[a].length;
  });
  const blocks = ordered.map(k => {
    const arr = groups[k].slice().sort((x, y) => sevRk(x) - sevRk(y));
    const lines = arr.map(f => {
      const rec = (f.occurrences || 1) >= 2 ? `🔁${f.occurrences}× ` : '';
      const sev = SEV_EMOJI[f.severity] ? `${SEV_EMOJI[f.severity]} ` : '';
      return `• ${sev}${rec}${rotulo(f.category)} — ${cortarNaPalavra(f.summary, 160)}`;
    });
    return `${tituloDe[k]} (${arr.length})\n${lines.join('\n')}`;
  });

  const total = body.length + regressions.length;
  const partes = [];
  if (regLines.length) partes.push(`🚨 *${regLines.length === 1 ? '1 regressão' : `${regLines.length} regressões`}*\n${regLines.join('\n')}`);
  partes.push(...blocks);
  return {
    status: 'warning',
    detail: `🗣️ *Conversas: ${total} ${total === 1 ? 'falha' : 'falhas'} pra revisar*${countLine}\n\n${partes.join('\n\n')}`.trim(),
  };
}

module.exports = { formatConvQuality, CONV_CAT_LABEL };

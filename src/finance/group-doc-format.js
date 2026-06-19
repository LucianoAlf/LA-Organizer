// src/finance/group-doc-format.js
// Builder DETERMINÍSTICO (puro) que organiza uma fatura/extrato ({emissor, vencimento, total, itens})
// em texto agrupado por CATEGORIA — igual ao pessoal (reusa mapCategory). É o que vira o BODY da
// ficha do grupo (Parte 3-B). Determinístico de propósito: o LLM NUNCA reescreve isto (preserva
// 100% dos itens — lição de truncação dos relatórios). NÃO toca finanças; só formata pra anotação.
'use strict';

const { mapCategory } = require('./categorize');

// Rótulo amigável por slug de categoria (fallback = slug capitalizado).
const CAT_LABELS = {
  alimentacao: 'Alimentação', transporte: 'Transporte', saude: 'Saúde', educacao: 'Educação',
  lazer: 'Lazer', compras: 'Compras', servicos: 'Serviços', moradia: 'Moradia',
  assinaturas: 'Assinaturas', impostos: 'Impostos/Taxas', mercado: 'Mercado', outros: 'Outros',
};
function catLabel(slug) {
  if (CAT_LABELS[slug]) return CAT_LABELS[slug];
  const s = String(slug || 'outros');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtBRL(n) { return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ','); }
function fmtDdMm(ymd) {
  return ymd && /^\d{4}-\d{2}-\d{2}/.test(String(ymd)) ? `${String(ymd).slice(8, 10)}/${String(ymd).slice(5, 7)}` : '';
}

// Organiza a fatura/extrato em texto por categoria, preservando TODOS os itens.
function formatFinancialDoc(invoice) {
  const inv = invoice || {};
  const itens = Array.isArray(inv.itens) ? inv.itens : [];
  const byCat = new Map();
  for (const it of itens) {
    const slug = mapCategory(it && it.descricao ? it.descricao : '', 'expense') || 'outros';
    if (!byCat.has(slug)) byCat.set(slug, []);
    byCat.get(slug).push(it);
  }
  const totalCalc = itens.reduce((s, i) => s + Number((i && i.valor) || 0), 0);
  const head = [];
  if (inv.emissor) head.push(`Emissor: ${String(inv.emissor).trim()}`);
  if (inv.vencimento) head.push(`Vencimento: ${fmtDdMm(inv.vencimento)}`);
  head.push(`Total: ${fmtBRL(inv.total != null ? inv.total : totalCalc)}`);
  head.push(`${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`);

  const cats = [...byCat.entries()]
    .map(([slug, arr]) => ({ slug, arr, sub: arr.reduce((s, i) => s + Number((i && i.valor) || 0), 0) }))
    .sort((a, b) => Math.abs(b.sub) - Math.abs(a.sub));
  const blocks = cats.map((c) => {
    const lines = c.arr.map((i) => {
      const d = fmtDdMm(i && i.data);
      const parc = (i && i.parcela_total && Number(i.parcela_total) > 1) ? ` (${i.parcela_atual}/${i.parcela_total})` : '';
      return `  • ${d ? d + ' ' : ''}${String((i && i.descricao) || '').trim()}${parc} — ${fmtBRL(i && i.valor)}`;
    }).join('\n');
    return `${catLabel(c.slug)} — ${fmtBRL(c.sub)}\n${lines}`;
  });
  return `${head.join(' · ')}\n\n${blocks.join('\n\n')}`.trim();
}

// Título sugerido pra ficha: "Fatura <emissor> MM/AAAA".
function pickDocTitle(invoice) {
  const inv = invoice || {};
  const emissor = String(inv.emissor || 'Documento').trim();
  const ven = inv.vencimento;
  const mes = ven && /^\d{4}-\d{2}/.test(String(ven)) ? ` ${String(ven).slice(5, 7)}/${String(ven).slice(0, 4)}` : '';
  return `Fatura ${emissor}${mes}`.trim().slice(0, 120);
}

module.exports = { formatFinancialDoc, pickDocTitle, catLabel, fmtBRL };

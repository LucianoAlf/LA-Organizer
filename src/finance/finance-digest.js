'use strict';
// Builder PURO do digest financeiro matinal (1 msg consolidada, formato "Opção A").
// Recebe itens JÁ classificados por urgência. NÚMERO vem daqui (código), nunca do LLM.
// Spec: docs/superpowers/specs/2026-06-08-digest-financeiro-matinal-design.md

const SEP = '━━━━━━━━━━━━━━━━';

// 1800 → "R$ 1.800"; 120.5 → "R$ 120,50"
function fmtMoney(v) {
  const n = Number(v) || 0;
  const cents = Math.round((Math.abs(n) % 1) * 100);
  const intPart = Math.floor(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + intPart + (cents ? ',' + String(cents).padStart(2, '0') : '');
}

// item: { name, amount, dia, isCard }
function buildFinanceDigest({ nome, atrasadas = [], hoje = [], emBreve = [] }) {
  if (atrasadas.length + hoje.length + emBreve.length === 0) return '';
  const tag = (it) => (it.isCard ? '💳 ' : '') + it.name + ' · *' + fmtMoney(it.amount) + '*';
  const out = [`👽 *Financeiro de hoje, ${nome}*`, SEP];
  if (atrasadas.length) {
    out.push('🔴 *Atrasada*');
    for (const it of atrasadas) out.push('   ' + tag(it) + `  _(venceu dia ${it.dia})_`);
  }
  if (hoje.length) {
    if (atrasadas.length) out.push('');
    out.push('🟡 *Vence hoje*');
    for (const it of hoje) out.push('   ' + tag(it));
  }
  if (emBreve.length) {
    if (atrasadas.length || hoje.length) out.push('');
    out.push('🔵 *Em breve*');
    for (const it of emBreve) out.push('   ' + tag(it) + ` _(dia ${it.dia})_`);
  }
  out.push(SEP);
  const all = [...atrasadas, ...hoje, ...emBreve];
  const conta = all.find((i) => !i.isCard);
  const cartao = all.find((i) => i.isCard);
  const ex = [];
  if (conta) ex.push(`"paguei ${conta.name.toLowerCase()}"`);
  if (cartao) ex.push(`"paguei a fatura do ${cartao.name.replace(/^fatura\s+/i, '').toLowerCase()}"`);
  out.push(`💡 Pagou alguma? Me diz ${ex.join(' ou ')} que eu baixo aqui.`);
  return out.join('\n');
}

module.exports = { buildFinanceDigest, fmtMoney };

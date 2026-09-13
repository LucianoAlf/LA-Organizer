'use strict';
// total-da-lista.js — TOTAL-DA-LISTA-E-RESPOSTA (Rose 04/07/2026 — achados cfdf9bdb e ded67aeb).
//
// Ela pediu o total DUAS vezes — "qual o total de contas ai?" e "adiciona o total na lista" — e nas
// duas recebeu a lista de novo com "faltam 4 valores", sem número (e com a nota de "não consegui
// registrar" colada embaixo). O total só apareceu no terceiro pedido: R$ 9.914,32. Somar o que já
// está escrito na lista é transformação determinística — não depende do modelo lembrar de somar.
//
// Regra de honestidade que veio do próprio caso: item SEM valor ("_(completar)_") não vira zero
// silencioso — o texto diz quantos faltam e que o total real vai ser maior. E linha que JÁ é total
// ("Total confirmado: R$ 9.558,16") fica fora da soma, senão o total entra na conta de si mesmo. PURO.

const VALOR_RE = /R\$\s*([\d.]{1,15}(?:,\d{2})?)/g;
const LINHA_TOTAL_RE = /\btotal\b|\bsomat[óo]rio\b/i;
const SEM_VALOR_RE = /\(completar\)|_\(completar\)_|\bcompletar\b/i;

function _num(br) {
  const limpo = String(br).replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** "9914.32" → "R$ 9.914,32" */
function formatarBRL(n) {
  const [i, d] = Number(n).toFixed(2).split('.');
  return `R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
}

/** A pessoa pediu o total? Precisa da palavra E de um verbo/pergunta de pedido. */
function pedeTotal(texto) {
  const t = String(texto == null ? '' : texto).toLowerCase();
  if (!/\btotal\b|\bsomat[óo]rio\b|\bsoma\b/.test(t)) return false;
  return /\bqual\b|\bquanto\b|\badiciona\w*\b|\bcoloca\w*\b|\bp[õo]e\b|\bcalcula\w*\b|\bsoma\b|\bme d[áa]\b|\?/.test(t);
}

/**
 * somaDaLista(texto) → { total, itens, faltando } | null (menos de 3 valores = não é lista).
 * Linhas de total ficam fora; linhas "(completar)" contam como FALTANDO, nunca como zero.
 */
function somaDaLista(texto) {
  const linhas = String(texto == null ? '' : texto).split('\n');
  let total = 0;
  let itens = 0;
  let faltando = 0;
  for (const linha of linhas) {
    if (LINHA_TOTAL_RE.test(linha)) continue;
    const achados = [...linha.matchAll(VALOR_RE)].map((m) => _num(m[1])).filter((n) => n !== null);
    if (achados.length) {
      total += achados.reduce((a, b) => a + b, 0);
      itens += achados.length;
    } else if (SEM_VALOR_RE.test(linha)) {
      faltando++;
    }
  }
  if (itens < 3) return null;
  return { total: Math.round(total * 100) / 100, itens, faltando };
}

/** A fala já traz esse total? (o número formatado aparece nela) */
function falaJaTemTotal(fala, total) {
  return String(fala || '').includes(formatarBRL(total).replace('R$ ', ''));
}

function textoTotal({ total, faltando = 0 } = {}) {
  const base = `💰 *Total: ${formatarBRL(total)}*`;
  if (!faltando) return base;
  return `${base}\n⚠️ ${faltando} ${faltando === 1 ? 'item ainda sem valor' : 'itens ainda sem valor'} — o total real vai ser maior.`;
}

module.exports = { pedeTotal, somaDaLista, falaJaTemTotal, textoTotal, formatarBRL };

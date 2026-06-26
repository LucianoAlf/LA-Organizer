'use strict';
// Detecta um COMPROVANTE de PAGAMENTO de fatura de cartão (imagem OCR'd via vision.js).
//
// Bug FIN-RECEIPT-CONFIRM-NOOP (Alf 22/06): o comprovante de fatura virava PERGUNTA em prosa do LLM
// ("Fecho a tarefa e marco a fatura como paga?") → intent kind=confirmation PASSIVA (sem actions) →
// o "Sim" auto-resolvia 'confirmed' mas NÃO executava nada (tarefa seguia pending, fatura não baixava).
// Este detector deixa o engine reconhecer o comprovante DETERMINISTICAMENTE e roteá-lo pro motor
// pay_invoice (Camada 2), sem depender do LLM re-emitir o marker.
//
// Discriminador (evita falso-positivo): precisa do sinal "COMPROVANTE FINANCEIRO" (análise de imagem)
// + referência a "fatura ... cartão" + um valor total. NÃO confunde com gasto comum, Pix, nem com o
// import de fatura (FATURA_JSON = lista de compras). Retorna { cardHint, amount } ou null.

const FATURA_CARTAO_RE = /fatura\s+(?:d[oae]\s+)?cart[ãa]o/i;

// pt-BR: '.' = milhar, ',' = decimal. "6.295,54" → 6295.54 ; "300" → 300.
function parseBrlNumber(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}

function detectInvoicePaymentReceipt(text) {
  const t = String(text || '');
  if (!t) return null;
  if (/\[FATURA_JSON\]/i.test(t)) return null;            // import de compras, não comprovante de pagamento
  if (!/COMPROVANTE FINANCEIRO/i.test(t)) return null;    // só sobre análise de imagem de comprovante
  if (!FATURA_CARTAO_RE.test(t)) return null;             // tem que ser fatura de CARTÃO (não gasto comum/Pix)

  // valor total (vários formatos do OCR)
  const mAmt = t.match(/valor\s+total[:\s]*R?\$?\s*([\d.,]+)/i)
    || t.match(/\bvalor[:\s]*R?\$?\s*([\d.,]+)/i)
    || t.match(/R\$\s*([\d.,]+)/i);
  const amount = mAmt ? parseBrlNumber(mAmt[1]) : NaN;
  if (!(amount > 0)) return null;

  // dica do cartão a partir de "fatura do cartão <X>"
  const mCard = t.match(/fatura\s+(?:d[oae]\s+)?cart[ãa]o\s+["']?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .\-]{1,30}?)["']?\s*(?:["';.\n)]|$)/i);
  const cardHint = mCard ? mCard[1].trim() : null;
  if (!cardHint) return null;

  return { cardHint, amount };
}

module.exports = { detectInvoicePaymentReceipt, parseBrlNumber };

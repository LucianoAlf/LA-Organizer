'use strict';
// Detecta e VALIDA boleto bancário/arrecadação. Bug Alf 17/07: boleto caía no fluxo de
// fatura de cartão (webhook chamava analyzeInvoice em todo PDF). Aqui o determinístico
// decide "é boleto" e confia na linha digitável SÓ se o dígito verificador bater — um
// dígito errado lido pelo Gemini = pagamento errado.

const RE_VOCAB = /benefici[áa]ri|cedente|nosso\s*n[úu]mero|linha\s*digit[áa]vel|pagador|c[óo]digo\s*de\s*barras|sacado/i;
const RE_FATURA = /\bfatura\b|limite\s*(dispon[íi]vel|de\s*cr[ée]dito)|cart[ãa]o\s*final|melhor\s*dia|fatura\s*fechada/i;

function _digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

function extractLinhaDigitavel(text) {
  const t = String(text || '');
  const m = t.match(/(\d[\d.\s]{44,60}\d)/g);
  if (!m) return null;
  for (const cand of m) {
    const d = _digitsOnly(cand);
    if (d.length === 47 || d.length === 48) return d;
  }
  return null;
}

function looksLikeBoleto(text) {
  const t = String(text || '');
  if (RE_FATURA.test(t) && !RE_VOCAB.test(t)) return false;
  const temLinha = extractLinhaDigitavel(t) !== null;
  return temLinha && RE_VOCAB.test(t);
}

function _mod10(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

function _mod11Barcode(num) {
  // DV geral do código de barras bancário, peso 2..9 cíclico. dv 0/10/11 → 1 (regra FEBRABAN).
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return (dv === 0 || dv > 9) ? 1 : dv;
}

function _validateBancario(d) {
  // 47 dígitos. VALIDADO contra a linha real HDI: o número real passa, todas as 423
  // adulterações de 1 dígito reprovam. NÃO alterar a remontagem sem re-provar.
  if (_mod10(d.slice(0, 9))  !== Number(d[9]))  return false;
  if (_mod10(d.slice(10, 20)) !== Number(d[20])) return false;
  if (_mod10(d.slice(21, 31)) !== Number(d[31])) return false;
  const dvGeral = d[32];
  const barras = d.slice(0, 4) + dvGeral + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  const semDv = barras.slice(0, 4) + barras.slice(5);
  return _mod11Barcode(semDv) === Number(dvGeral);
}

function _validateArrecadacao(d) {
  // 48 dígitos, 4 blocos de 12 (11 + DV). id (3º dígito) 6/7 → mod10; 8/9 → mod11.
  const id = d[2];
  const dvMod11 = (b) => {
    let soma = 0, peso = 2;
    for (let i = b.length - 1; i >= 0; i--) { soma += Number(b[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const dv = 11 - (soma % 11);
    return (dv === 0 || dv > 9) ? 0 : dv;
  };
  const dvFn = (id === '6' || id === '7') ? _mod10 : dvMod11;
  for (let i = 0; i < 4; i++) {
    const bloco = d.slice(i * 12, i * 12 + 11);
    const dv = d[i * 12 + 11];
    if (dvFn(bloco) !== Number(dv)) return false;
  }
  return true;
}

function validateLinhaDigitavel(digits) {
  const d = _digitsOnly(digits);
  if (d.length === 47) return { valid: _validateBancario(d), tipo: 'bancario' };
  if (d.length === 48) return { valid: _validateArrecadacao(d), tipo: 'arrecadacao' };
  return { valid: false, tipo: null };
}

function parseBoletoValor(digits) {
  const d = _digitsOnly(digits);
  if (d.length === 47) {
    const centavos = Number(d.slice(37, 47));
    return centavos > 0 ? centavos / 100 : null;
  }
  if (d.length === 48) {
    const centavos = Number(d.slice(4, 15));
    return centavos > 0 ? centavos / 100 : null;
  }
  return null;
}

function formatLinhaDigitavel(digits) {
  const d = _digitsOnly(digits);
  if (d.length === 47) {
    return `${d.slice(0,5)}.${d.slice(5,10)} ${d.slice(10,15)}.${d.slice(15,21)} ${d.slice(21,26)}.${d.slice(26,32)} ${d.slice(32,33)} ${d.slice(33,47)}`;
  }
  if (d.length === 48) {
    return `${d.slice(0,12)} ${d.slice(12,24)} ${d.slice(24,36)} ${d.slice(36,48)}`;
  }
  return d;
}

module.exports = {
  looksLikeBoleto, extractLinhaDigitavel, validateLinhaDigitavel,
  formatLinhaDigitavel, parseBoletoValor,
};

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// REDE ANTI-FABRICAÇÃO de registro financeiro.
//
// Problema (caso Matheus 07/06): o LLM às vezes NARRA uma confirmação de registro
// ("💰 Entrada registrada! ... Saldo NUBANK +R$ X") como texto livre SEM emitir o
// marker <<FINANCE_ACTION>>. Resultado: nada persiste, o saldo mostrado é mentira,
// e a correção seguinte "não acha lançamento recente" (porque a linha não existe).
//
// Este módulo é PURO (sem I/O). Dá ao engine duas ferramentas determinísticas:
//   1) looksLikeFinanceConfirmation(text) — o texto TEM cara de confirmação de
//      finança? (assinatura do template buildTxnConfirmation que o LLM imita)
//   2) detectRegisterIntent(text, {typeHint}) — extrai {type, amount, description,
//      account_name, method} de uma mensagem de registro, CONSERVADOR: só alta
//      confiança em caso simples (1 valor, sem parcela/transferência); senão null.
//
// O engine usa: se NENHUM marker de finança rodou no turno E looksLike...()==true,
// é fabricação → NÃO manda a mentira; tenta registrar de verdade via
// detectRegisterIntent (pipeline real, com insert) ou pede pra repetir.
// ─────────────────────────────────────────────────────────────────────────────

function stripAccents(str) {
  return String(str).normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normalize(str) {
  return stripAccents(str).toLowerCase();
}

// Número brasileiro: "300,00"→300, "1.234,56"→1234.56, "1.200"→1200, "300"→300.
function parseAmount(raw) {
  let s = String(raw).replace(/r\$\s*/gi, '').trim();
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');          // dot = milhar, vírgula = decimal
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');                             // "1.200" → milhar puro
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Remove ruído temporal pra não contar data/hora como "valor" ("dia 10", "10/06", "20h").
function stripTemporal(t) {
  return t
    .replace(/\bdia\s+\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}h\d{0,2}\b/g, ' ')
    .replace(/\b[àa]s\s+\d{1,2}\b/g, ' ');
}

// Tokens de valor monetário (após remover ruído temporal). Ordem importa na alternância.
const AMOUNT_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+)/g;

// Verbos/sinais
const RE_REGISTER_VERB = /\b(lanc(?:a|ar|o|ei|e)?|anot(?:a|ar|e|ei)?|registr(?:a|ar|e|ei|o)?|adicion(?:a|ar|e|ei)?)\b/;
const RE_INCOME = /\b(entrada|entrou|entra|receb(?:i|ido|imento)|receita|caiu|ganhei|ganho|vendi|venda|sal[aá]rio|comiss[aã]o|rendeu|pix recebido)\b/;
const RE_EXPENSE = /\b(gast(?:ei|o|ar|ando)|pag(?:uei|o|ar)|compr(?:ei|a|ar)|despesa|sa[ií]da|saiu|torrei|custou|comprinha)\b/;

// Complexidade fora do escopo da rede determinística → bail (usuário refaz / LLM faz).
const RE_INSTALLMENT = /\b\d+\s*x\b|\bparcel|\bvezes\b|\bem\s+\d+\s*(x|vezes|parcelas)\b/;
const RE_TRANSFER = /\btransfer|\bpra\s+(conta|carteira)\b.*\b(do|da)\b/;

// Queries/perguntas (não são registro).
const RE_QUERY = /\b(qual|quais|quanto|quanta|cad[êe]|quando|extrato|fechamento|resumo|relat[óo]rio|saldo de|me manda|me mostra|mostra a[íi])\b/;

// Método/fonte explícitos.
const RE_CASH = /\b(em\s+)?dinheiro\b|\bespecie\b|\bcash\b/;
const RE_CREDIT = /\b(no\s+)?(cr[ée]dito|cart[ãa]o)\b/;
const RE_DEBIT = /\b(no\s+)?(d[ée]bito|pix)\b/;
// "no/na/pelo/pela <nome>" → candidato a conta (o handler resolve; lixo cai na principal).
const RE_SOURCE_NAMED = /\b(?:no|na|pelo|pela|via)\s+([a-z0-9][a-z0-9\s]{1,24}?)(?:\s*$|[,.;])/;

function looksLikeFinanceConfirmation(text) {
  if (!text || typeof text !== 'string') return false;
  const t = normalize(text);
  const hasRegistered = /\bregistrad[oa]\b/.test(t);          // "registrada"/"registrado" (NÃO "registrou")
  const hasMoneyOrBalance = /\bsaldo\b/.test(t) || /r\$\s*\d/.test(t);
  return hasRegistered && hasMoneyOrBalance;
}

// Limpa a descrição: tira filler, verbo, valor e palavras de tipo; mantém o "miolo".
function buildDescription(raw, amountToken) {
  let d = ' ' + raw + ' ';
  d = d.replace(/^\s*(e\s+outra\s+coisa|olha|[óo]|ent[ãa]o|ah|ei)\s*[,:]?\s*/i, ' ');
  d = d.replace(RE_REGISTER_VERB, ' ');
  d = d.replace(/\b(gast(?:ei|o|ando)|pag(?:uei|o)|compr(?:ei|a)|receb(?:i|ido)|entrou|caiu|ganhei|vendi)\b/i, ' ');
  d = d.replace(/\b(a[íi]|aqui|pra\s+mim|pra\s+eu|de\s+novo)\b/i, ' ');
  if (amountToken) d = d.replace(amountToken, ' ');
  d = d.replace(/\br\$\s*/gi, ' ').replace(/\b(reais|conto|contos|pila|pilas)\b/gi, ' ');
  d = d.replace(/\b(como|de|por)\s+(entrada|receita|gasto|despesa|sa[ií]da)\b/gi, ' ');
  d = d.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  d = d.replace(/^(no|na|do|da|de|com|em|pra|pro|o|a)\s+/i, '');     // 1 preposição inicial
  if (!d) return '';
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/**
 * @param {string} text  mensagem original do usuário
 * @param {{typeHint?: string}} [opts] typeHint = texto (ex: confirmação fabricada) p/ desambiguar tipo
 * @returns {null | {type:'income'|'expense', amount:number, description:string, account_name?:string, method?:string, confidence:'high'}}
 */
function detectRegisterIntent(text, opts = {}) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const raw = text.trim();
  const norm = normalize(raw);

  // Bail: query, parcela, transferência.
  if (RE_QUERY.test(norm)) return null;
  if (RE_INSTALLMENT.test(norm)) return null;
  if (RE_TRANSFER.test(norm)) return null;

  // Gate de intenção: precisa de um verbo de registro OU de ação (income/expense).
  const hasRegister = RE_REGISTER_VERB.test(norm);
  const isIncome = RE_INCOME.test(norm);
  const isExpense = RE_EXPENSE.test(norm);
  if (!hasRegister && !isIncome && !isExpense) return null;

  // Valor: exatamente UM (sem contar data/hora). 0 ou ≥2 → null.
  const cleaned = stripTemporal(norm);
  const tokens = cleaned.match(AMOUNT_RE) || [];
  // dedup por valor numérico (evita "300" e "300,00" contarem como 2)
  const seen = new Set();
  const amounts = [];
  for (const tk of tokens) {
    const v = parseAmount(tk);
    if (v === null || v <= 0) continue;
    if (seen.has(v)) continue;
    seen.add(v); amounts.push({ token: tk, value: v });
  }
  if (amounts.length !== 1) return null;
  const amount = amounts[0].value;

  // Tipo: verbo de ação > hint (texto fabricado) > default expense.
  let type;
  if (isIncome && !isExpense) type = 'income';
  else if (isExpense && !isIncome) type = 'expense';
  else {
    const hint = normalize(opts.typeHint || '');
    if (/\b(entrada|receita|receb|caiu|ganho|ganhei|entrou)\b/.test(hint)) type = 'income';
    else if (/\b(gasto|despesa|sa[ií]da|pago|gastou)\b/.test(hint)) type = 'expense';
    else if (isIncome) type = 'income';
    else type = 'expense';
  }

  // Método/fonte (best-effort; o handler resolve, lixo cai na conta principal).
  const out = { type, amount, description: buildDescription(raw, amounts[0].token), confidence: 'high' };
  if (RE_CASH.test(norm)) { out.account_name = 'dinheiro'; out.method = 'cash'; }
  else if (RE_CREDIT.test(norm)) { out.method = 'credit'; }
  else if (RE_DEBIT.test(norm)) { out.method = 'debit'; }
  else {
    const m = norm.match(RE_SOURCE_NAMED);
    if (m && m[1]) {
      const cand = m[1].trim();
      // ignora candidatos que claramente NÃO são fonte (preposições soltas / muito curtos)
      if (cand.length >= 3 && !/^(que|com|sem|por|pra|seu|sua|meu|minha)\b/.test(cand)) out.account_name = cand;
    }
  }
  return out;
}

module.exports = { detectRegisterIntent, looksLikeFinanceConfirmation, parseAmount };

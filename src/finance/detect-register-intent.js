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
//      confiança em caso simples (1 valor, sem parcela/transferência/pergunta);
//      senão null.
//
// O engine usa: se NENHUM marker de finança rodou no turno E looksLike...()==true,
// é fabricação → NÃO manda a mentira; tenta registrar de verdade via
// detectRegisterIntent (pipeline real, com insert) ou pede pra repetir.
//
// Endurecido por workflow adversarial (6 agentes, 145 casos, 07/06): bail em
// pergunta/dúvida, quantidade-vs-dinheiro, multi-item de valor igual, sinal misto,
// léxico income ampliado (gorjeta/cachê), ordem do strip temporal, typeHint receb\w*.
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

// Remove ruído temporal pra não contar data/hora como "valor". ORDEM IMPORTA:
// dd/mm ANTES de "dia N" (senão "dia 05/06" deixa o órfão "/06" virar 2º valor).
function stripTemporal(t) {
  return t
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')   // 05/06, 05/06/2026
    .replace(/\bdia\s+\d{1,2}\b/g, ' ')                    // dia 10
    .replace(/\b\d{1,2}h\d{0,2}\b/g, ' ')                  // 20h, 20h30
    .replace(/\b[àa]s\s+\d{1,2}\b/g, ' ');                 // às 8
}

// Token de valor monetário (após remover ruído temporal). Ordem na alternância importa.
const AMOUNT_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+)/g;

// Substantivo de CONTAGEM logo após o número → é quantidade, não dinheiro
// ("3 alunos", "2 cordas", "2 caras"). reais/conto/pila NÃO entram (são dinheiro).
const COUNT_NOUN_AFTER = /^\s*(alunos?|caras?|pessoas?|lugares?|cordas?|vezes|dias?|meses|m[êe]s|anos?|horas?|minutos?|itens|unidades?|amigos?|convidados?|semanas?|gols?|pontos?|faltas?)\b/;

// Verbos/sinais
const RE_REGISTER_VERB = /\b(lanc(?:a|ar|o|ei|e)?|anot(?:a|ar|e|ei)?|registr(?:a|ar|e|ei|o)?|adicion(?:a|ar|e|ei)?)\b/;
// income por VERBO (ação de entrada de caixa) vs por SUBSTANTIVO (natureza)
const RE_INCOME_VERB = /\b(entrou|entra|receb(?:i|ido|imento)|caiu|ganhei|ganho|vendi|rendeu|me deu|me deram)\b/;
const RE_INCOME_NOUN = /\b(entrada|receita|comiss[aã]o|sal[aá]rio|gorjeta|cach[eê]|b[ôo]nus|gratifica\w*|venda)\b/;
const RE_EXPENSE_VERB = /\b(gast(?:ei|o|ar|ando)|pag(?:uei|o|ar)|compr(?:ei|a|ar|inha)|torrei|custou|saiu)\b/;
const RE_EXPENSE_NOUN = /\b(despesa|sa[ií]da|gasto)\b/;

// Complexidade fora do escopo da rede determinística → bail.
const RE_INSTALLMENT = /\b\d+\s*x\b|\bparcel|\bvezes\b|\bem\s+\d+\s*(x|vezes|parcelas)\b/;
const RE_TRANSFER = /\btransfer/;
// Pergunta / dúvida / recall → não é comando de registro.
const RE_DOUBT = /\?|\bn[ãa]o lembro\b|\bacho que\b|\bsei l[áa]\b|\bser[áa] que\b|\bn[ée]\s*$|\bcerto\s*$|\bconfere\b|\bfoi isso\b|\btem certeza\b/;
// Intenção FUTURA (ainda não aconteceu) → não registra.
const RE_FUTURE = /\b(preciso|quero|vou|pretendo|tenho que|tenho de|bora)\b[^?.!]*\b(comprar|pagar|gastar|lan[çc]ar|guardar)\b/;
// Queries/consultas.
const RE_QUERY = /\b(qual|quais|quanto|quanta|cad[êe]|quando|extrato|fechamento|resumo|relat[óo]rio|saldo de|me manda|me mostra|mostra a[íi])\b/;

// Método/fonte explícitos.
const RE_CASH = /\b(em\s+)?dinheiro\b|\bespecie\b|\bcash\b/;
const RE_CREDIT = /\b(no\s+)?(cr[ée]dito|cart[ãa]o)\b/;
const RE_DEBIT = /\b(no\s+)?(d[ée]bito|pix)\b/;
const RE_SOURCE_NAMED = /\b(?:no|na|pelo|pela|via)\s+([a-z0-9][a-z0-9\s]{1,24}?)(?:\s*$|[,.;])/;

function looksLikeFinanceConfirmation(text) {
  if (!text || typeof text !== 'string') return false;
  const t = normalize(text);
  const hasRegistered = /\bregistrad[oa]\b/.test(t);          // "registrada"/"registrado" (NÃO "registrou")
  const hasMoneyOrBalance = /\bsaldo\b/.test(t) || /r\$\s*\d/.test(t);
  return hasRegistered && hasMoneyOrBalance;
}

// Extrai valores monetários, excluindo quantidades (nº + substantivo de contagem).
function extractAmounts(normCleaned) {
  const re = new RegExp(AMOUNT_RE.source, 'g');
  const out = [];
  let m;
  while ((m = re.exec(normCleaned)) !== null) {
    const token = m[0];
    const after = normCleaned.slice(m.index + token.length);
    if (COUNT_NOUN_AFTER.test(after)) continue;            // "3 alunos" → quantidade, pula
    const v = parseAmount(token);
    if (v === null || v <= 0) continue;
    out.push({ token, value: v });
  }
  return out;
}

// Limpa a descrição: tira filler, verbo, valor e palavras de tipo; mantém o "miolo".
function buildDescription(raw, amountToken) {
  let d = ' ' + raw + ' ';
  d = d.replace(/^\s*(e\s+outra\s+coisa|olha|[óo]|ent[ãa]o|ah|ei)\s*[,:]?\s*/i, ' ');
  d = d.replace(RE_REGISTER_VERB, ' ');
  d = d.replace(/\b(gast(?:ei|o|ando)|pag(?:uei|o)|compr(?:ei|a)|receb(?:i|ido)|entrou|caiu|ganhei|vendi|me deram|me deu)\b/i, ' ');
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

  // Bail: pergunta/dúvida, query, intenção futura, parcela, transferência.
  if (RE_DOUBT.test(norm)) return null;
  if (RE_QUERY.test(norm)) return null;
  if (RE_FUTURE.test(norm)) return null;
  if (RE_INSTALLMENT.test(norm)) return null;
  if (RE_TRANSFER.test(norm)) return null;

  // Sinais de tipo
  const incomeVerb = RE_INCOME_VERB.test(norm);
  const incomeNoun = RE_INCOME_NOUN.test(norm);
  const expenseVerb = RE_EXPENSE_VERB.test(norm);
  const expenseNoun = RE_EXPENSE_NOUN.test(norm);
  const hasRegister = RE_REGISTER_VERB.test(norm);

  // Gate de intenção: precisa de verbo de registro OU sinal income/expense.
  if (!hasRegister && !incomeVerb && !incomeNoun && !expenseVerb && !expenseNoun) return null;

  // Sinal MISTO genuíno (recebi X E paguei Y) → ambíguo demais p/ rede determinística.
  if (incomeVerb && expenseVerb) return null;

  // Valor: exatamente UM (sem contar data/hora/quantidade). 0 ou ≥2 → null.
  const amounts = extractAmounts(stripTemporal(norm));
  if (amounts.length !== 1) return null;
  const amount = amounts[0].value;

  // Tipo: verbo de gasto > verbo de receita > substantivo > hint > default expense.
  let type;
  if (expenseVerb) type = 'expense';
  else if (incomeVerb) type = 'income';
  else if (incomeNoun && !expenseNoun) type = 'income';
  else if (expenseNoun) type = 'expense';
  else {
    const hint = normalize(opts.typeHint || '');
    if (/(entrada|receita|receb\w*|caiu|ganho|ganhei|entrou|recebimento|gorjeta|cach[eê])/.test(hint)) type = 'income';
    else if (/(gasto|despesa|sa[ií]da|pag\w*|gastou)/.test(hint)) type = 'expense';
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
      if (cand.length >= 3 && !/^(que|com|sem|por|pra|seu|sua|meu|minha)\b/.test(cand)) out.account_name = cand;
    }
  }
  return out;
}

module.exports = { detectRegisterIntent, looksLikeFinanceConfirmation, parseAmount };

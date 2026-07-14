// src/finance/invoice-import.js — lógica PURA de import de fatura (sem I/O).
const BLOCK_RE = /\[FATURA_JSON\]\s*([\s\S]*?)\s*\[\/FATURA_JSON\]/i;

function parseInvoiceBlock(text, refYear) {
  if (!text || typeof text !== 'string') return { found: false, cleanText: text || '' };
  const m = BLOCK_RE.exec(text);
  if (!m) return { found: false, cleanText: text };
  const cleanText = text.replace(BLOCK_RE, '').trim();
  let json;
  try { json = JSON.parse(m[1].trim()); }
  catch { return { found: false, malformed: true, cleanText }; }
  if (!json || !Array.isArray(json.itens)) return { found: false, malformed: true, cleanText };
  const itens = normalizeItems(json.itens, refYear);
  // total = SOMA dos itens que SERÃO lançados (após filtrar saldo rolado/pagamentos). O total
  // declarado (json.total) inclui meta-linhas filtradas → mostrava R$16.645 com a lista somando
  // ~R$6.640 (Alf 14/06, OFX). O número exibido tem que bater com a lista.
  const total = itens.reduce((s, it) => s + Number(it.valor || 0), 0);
  return {
    found: true,
    cleanText,
    invoice: {
      emissor: String(json.emissor || '').trim(),
      vencimento: normInvoiceDate(json.vencimento, refYear) || null,
      total,
      itens,
    },
  };
}

// Linhas da fatura que NÃO são compras: saldo rolado da fatura anterior, pagamentos,
// créditos/estornos. Lançar como despesa DUPLICA a dívida e estoura o limite (caso Alf
// 14/06: "Saldo em atraso" R$10.004,71 virou compra → fatura inflou pra 408%). Encargos
// REAIS (multa de atraso, juros, IOF) NÃO casam aqui — são custos legítimos e seguem lançados.
const RE_NON_PURCHASE = /\bsaldo\s+(em\s+atraso|anterior|rotativo|restante|financiado|devedor|parcelado|da\s+fatura)\b|\bvalor\s+pendente\b|\b(saldo|valor)\s+(pendente\s+)?do\s+m[êe]s\s+anterior\b|\bpend[êe]ncia\s+(do\s+m[êe]s\s+)?anterior\b|\bpagamento\s+(recebido|efetuado|de\s+fatura|m[íi]nimo|fatura)\b|\bpgto\s+(recebido|fatura)\b|\bfatura\s+anterior\b|\bcr[ée]dito\s+de\s+(atraso|fatura)\b/i;
// Estorno/devolução/reembolso = CRÉDITO que ABATE a fatura (valor negativo) — NÃO é ruído nem despesa. (Rose 14/06)
const RE_REFUND = /\bestorn|\bdevolu[çc]|\breembols|\bchargeback/i;

function isPurchasableLine(descricao) {
  return !RE_NON_PURCHASE.test(String(descricao || ''));
}

function isRefundLine(descricao) {
  return RE_REFUND.test(String(descricao || ''));
}

// A "fatura-texto" é na verdade uma LISTA DE ESTORNOS? (todos os itens negativos ou com cara de estorno).
// Roteia pro card_refund determinístico em vez do import-compras. (regressão Rose 14/06)
function allItemsRefund(itens) {
  const arr = Array.isArray(itens) ? itens : [];
  if (!arr.length) return false;
  return arr.every((it) => Number(it.valor != null ? it.valor : it.value) < 0 || isRefundLine(it.descricao || it.description || ''));
}

// Competência (YYYY-MM-01) — espelha financeiro-service.competenciaFor (replicado aqui p/ manter
// este módulo PURO/testável, sem puxar o service que importa supabase). day <= fechamento → fatura
// do mês; senão a seguinte.
function _competenciaFor(baseDate, closingDay) {
  const y = baseDate.getUTCFullYear(), m = baseDate.getUTCMonth(), day = baseDate.getUTCDate();
  const off = day <= closingDay ? 0 : 1;
  return new Date(Date.UTC(y, m + off, 1)).toISOString().slice(0, 10);
}

// Parseia a data do estorno tolerando "YYYY-MM-DD", "DD/MM" e "DD/MM/YYYY", e CORRIGE ano
// implausível (o Gemini às vezes crava 2024) pro ano de referência. Retorna Date UTC ou null.
function parseRefundDate(raw, refYear) {
  if (!raw) return null;
  const s = String(raw).trim();
  let y, mo, d;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);            // YYYY-MM-DD
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);    // DD/MM[/YYYY]
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = m[3] ? +m[3] : refYear;
    if (y < 100) y += 2000;                                   // "24" → 2024
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!(y >= refYear - 1 && y <= refYear + 1)) y = refYear;   // ano-chute do Gemini → ano corrente
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Competência de um ESTORNO: deriva da DATA do estorno (a fatura onde a compra ORIGINAL caiu),
// NÃO da fatura aberta hoje. closing_day=7 + estorno de 14/05 → junho; usar a fatura corrente
// jogava em julho (Rose 14/06: "vc lançou na fatura de julho, é junho"). Se a data for
// inutilizável, cai na fatura corrente (today + closing). today e closingDay injetados (testável).
function refundCompetencia(rawDate, closingDay, today) {
  const ref = today.getUTCFullYear();
  const d = parseRefundDate(rawDate, ref) || today;
  return _competenciaFor(d, closingDay);
}

// Normaliza a data de UM item/vencimento da fatura pro formato 'YYYY-MM-DD', corrigindo o
// ano-chute do Gemini (ele crava 2024 quando a data vem "DD/MM" sem ano → compras e competência
// iam parar em 2024 e sumiam da fatura do ano corrente; caso Rose 15/06: "lança na fatura de
// JULHO" virou julho/2024). Sem refYear (chamadas legadas/testes antigos) NÃO mexe — retrocompat.
function normInvoiceDate(raw, refYear) {
  if (!raw) return raw || null;
  if (!Number.isFinite(refYear)) return raw;           // sem ano de referência → comportamento atual
  const d = parseRefundDate(raw, refYear);
  return d ? d.toISOString().slice(0, 10) : raw;        // não-parseável → preserva o cru (não regride)
}

function normalizeItems(itens, refYear) {
  if (!Array.isArray(itens)) return [];
  return itens
    .map((it) => {
      const descricao = String(it.descricao || it.description || 'Compra').trim();
      let valor = Number(it.valor) || 0;
      // estorno é crédito que abate a fatura: garante sinal negativo
      if (isRefundLine(descricao) && valor > 0) valor = -valor;
      return {
        descricao, valor,
        data: normInvoiceDate(it.data || it.date || null, refYear),
        parcela_atual: Number(it.parcela_atual) || 1,
        parcela_total: Number(it.parcela_total) || 1,
      };
    })
    .filter((it) => it.valor !== 0)
    .filter((it) => it.valor > 0 || isRefundLine(it.descricao)) // crédito só se for estorno (abate)
    .filter((it) => isPurchasableLine(it.descricao));            // saldo rolado/pagamento fora
}

function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildInvoicePreview({ emissor, vencimento, total, cardName, itens, dupWarning }) {
  const head = `📄 *Fatura ${emissor || ''}*${vencimento ? ` · vence ${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}` : ''}`;
  const linhas = itens.map((it, i) => {
    const parc = it.parcela_total > 1 ? ` · ${it.parcela_atual}/${it.parcela_total}` : '';
    const dia = it.data ? `${it.data.slice(8, 10)}/${it.data.slice(5, 7)} · ` : '';
    return `${i + 1}. ${dia}${it.descricao} · R$ ${brl(it.valor)}${parc} · ${it.categoria || 'outros'}`;
  });
  const somaItens = itens.reduce((s, it) => s + Number(it.valor), 0);
  const partes = [
    head, '', linhas.join('\n'), '',
    `Total: R$ ${brl(total || somaItens)} · ${itens.length} lançamentos`,
  ];
  if (dupWarning) partes.push('', dupWarning);
  partes.push('', `Lanço essas compras no *${cardName}*? Responde *lançar*, *anotações* (só salvar) ou *cancelar*.`);
  return partes.join('\n');
}

const RE_COMMIT_FIN = /\b(lan[çc]ar?|lan[çc]a|pode lan[çc]ar|pode ir|bora|manda ver|manda|segue|confirmo?|confirma|isso|pode ser|sim|ok|beleza)\b/i;
const RE_ANOTAR = /\b(anota[çc][õo]es?|anota|s[óo] salva|salva.*anota|guarda.*anota|nota)\b/i;
const RE_CANCEL = /\b(cancela|cancelar|n[ãa]o|esquece|para)(?![a-zA-ZÀ-ú])|deixa pra l[áa]/i;
// COMMIT só com AFIRMAÇÃO clara NO INÍCIO (não "lançar" no meio de frase). Caso Rose 22/06:
// "você vai lançar em cada mês?" (PERGUNTA) commitava o import sem OK (FIN-INVOICE-COMMIT-ON-QUESTION).
const RE_COMMIT_ANCHORED = /^(lan[çc]ar?|lan[çc]a\b|pode\s+lan[çc]ar|pode\s+ir|bora\b|manda(\s+ver)?\b|segue\b|confirmo?\b|confirmad[oa]\b|confirma\b|confirmar\b|isso\b|pode\s+ser|sim\b|ok\b|beleza\b|t[áa]\b|perfeito\b)/i;
const RE_CORRECTION = /\b(muda|troca|corrig|errad|tira\b|remove|n[ãa]o\s+(é|e|era|foi))\b/i;
// PEDIDO DE VER ≠ COMMIT (Rose 14/07): "me passa/mostra só o que falta lançar" começa com
// "Sim" (anchored) mas é pedido de VISUALIZAÇÃO — quer VER o que falta antes, não lançar. O
// "lançar" ali é complemento ("o que falta lançar"), não ordem. Regra de ouro: na dúvida entre
// lançar e ver, NÃO lança (espelha o "na dúvida não fecha"). Cai no LLM, que mostra/pergunta.
const RE_VIEW_REQUEST = /\bo\s+que\s+(falta|faltam|j[áa])\b|\bquais?\s+(falta|faltam)\b|\bme\s+(passa|mostra|manda|envia|diz)\b|\bquero\s+ver\b|\bdeixa\s+ver\b/i;

function detectInvoiceReply(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  // Pedido de ver (mostrar o que falta/já-tem) NUNCA commita nem cancela — mesmo começando com
  // "Sim" ou contendo "não" ("o que falta pra NÃO duplicar" não é cancelamento). Cai no LLM.
  if (RE_VIEW_REQUEST.test(t)) return null;
  if (RE_CANCEL.test(t) && !RE_COMMIT_FIN.test(t)) return 'cancel';
  if (RE_ANOTAR.test(t)) return 'commit_anotacoes';
  // Só commita afirmação curta, no início, sem "?" e sem palavra de correção.
  const isQuestion = /\?/.test(t);
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (RE_COMMIT_ANCHORED.test(t) && !isQuestion && !RE_CORRECTION.test(t) && wordCount <= 10) return 'commit_financeiro';
  return null;
}

// Heurística: a mensagem é uma FATURA colada como TEXTO (não PDF)? (Rose 14/06)
// Conservador: precisa de cara de fatura (header) + vários itens com valor. Lista de gastos
// crus (sem header de fatura) NÃO casa — segue no fluxo normal de markers.
function looksLikeInvoiceText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  if (t.length < 80) return false; // fatura tem corpo; msg curta não é
  const hasHeader = /\bfatura\b/.test(t) || (/\bvencimento\b/.test(t) && /\btotal\b/.test(t)) || /compras?\s*:/.test(t);
  if (!hasHeader) return false;
  // vários valores monetários (R$ 1.234,56 / 136,28 / R$ 30) → corpo de fatura, não menção solta
  const valueMatches = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}|R\$\s*\d/gi) || [];
  return valueMatches.length >= 4;
}

module.exports = { parseInvoiceBlock, normalizeItems, buildInvoicePreview, detectInvoiceReply, looksLikeInvoiceText, isPurchasableLine, isRefundLine, allItemsRefund, refundCompetencia, parseRefundDate, normInvoiceDate };

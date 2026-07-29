'use strict';

// Canonical finance categories (accent-insensitive matching)
const CANONICAL_CATEGORIES = new Set([
  'salario', 'comissao', 'extra', 'moradia', 'alimentacao',
  'transporte', 'saude', 'educacao', 'lazer', 'outros',
]);

// Strip diacritics: NFD + remove combining marks U+0300-U+036F
function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalize(str) {
  return stripAccents(str).toLowerCase();
}

// Parse a Brazilian-format number: "R$ 1.234,56" → 1234.56, "25" → 25
function parseAmount(raw) {
  let s = raw.replace(/R\$\s*/g, '').trim();
  // comma = decimal separator; dots = thousands separators
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── Regexes ──────────────────────────────────────────────────────────────────

// DELETE verbs (matched against normalized text)
const RE_DELETE_VERB = /^(exclui(r)?|apaga(r)?|deleta(r)?|remove(r)?)\b/;

// Finance anchors for delete
const RE_FINANCE_NOUN = /\b(lancamento|gasto|despesa|compra|transacao|fatura)\b/;
const RE_HAS_DIGIT    = /\d/;

// EDIT AMOUNT — correction verb at start of normalized text
// Covers: era | na verdade (era|foi|e) | corrige[r] [pra] | ajusta[r] [pra] | muda[r] o valor [pra]
const RE_EDIT_VERB = /^(era|na verdade\s+(era|foi|e)\s*|corrige(r)?\s*(pra\s*)?|ajusta(r)?\s*(pra\s*)?|(muda|altera)(r)?\s+o\s+valor\s*(pra\s*)?)/;

// Number extraction: optional "R$" then digits with optional thousands-dot and comma-decimal
const RE_NUMBER = /(R\$\s*)?([\d.]+,\d+|\d+)/;

// EDIT CATEGORY — change verb + "categoria" keyword
const RE_CAT_VERB = /\b(muda(r)?|troca(r)?|poe|coloca(r)?|classifica(r)?|corrig\w*|alter\w*|ajust\w*)\b/;
const RE_CAT_WORD = /\bcategoria\b/;

// Extract word after "pra"/"para"
const RE_AFTER_PRA = /\bpra\s+(\S+)|\bpara\s+(\S+)/;
// Fallback: extract word directly after "categoria"
const RE_AFTER_CAT = /\bcategoria\s+(\S+)/;

// Pronouns that form a pure pronoun-only delete (≤3 words total)
const DELETE_PRONOUNS = new Set(['essa', 'esse', 'isso', 'aquilo', 'aquela', 'aquele']);

// ── Main ─────────────────────────────────────────────────────────────────────

function detectCorrection(rawText) {
  if (typeof rawText !== 'string' || rawText.trim() === '') return null;

  const raw  = rawText.trim();
  const norm = normalize(raw);

  // ── 1. DELETE (highest precedence) ──────────────────────────────────────
  if (RE_DELETE_VERB.test(norm)) {
    const words = norm.split(/\s+/);

    // Pure pronoun-only delete: exactly 2 words (verb + pronoun)
    if (words.length === 2 && DELETE_PRONOUNS.has(words[1])) {
      return { op: 'delete', ref: raw.toLowerCase() };
    }

    // Finance anchor: digit present
    if (RE_HAS_DIGIT.test(norm)) {
      return { op: 'delete', ref: raw.toLowerCase() };
    }

    // Finance anchor: finance noun present (norm already strips accents, e.g. "lançamento"→"lancamento")
    if (RE_FINANCE_NOUN.test(norm)) {
      return { op: 'delete', ref: raw.toLowerCase() };
    }

    // No finance anchor → not a finance delete (could be task/event)
    return null;
  }

  // ── 2. EDIT AMOUNT ───────────────────────────────────────────────────────
  if (RE_EDIT_VERB.test(norm)) {
    const numMatch = RE_NUMBER.exec(norm);
    if (numMatch) {
      const amount = parseAmount(numMatch[0]);
      if (amount !== null) return { op: 'edit', amount };
    }
  }

  // ── 3. EDIT CATEGORY ────────────────────────────────────────────────────
  if (RE_CAT_WORD.test(norm) && RE_CAT_VERB.test(norm)) {
    // Find the target category: prefer word after pra/para, fallback after "categoria"
    let candidate = null;
    const praMatch = RE_AFTER_PRA.exec(norm);
    if (praMatch) {
      candidate = praMatch[1] || praMatch[2];
    } else {
      const catMatch = RE_AFTER_CAT.exec(norm);
      if (catMatch) candidate = catMatch[1];
    }

    if (candidate && CANONICAL_CATEGORIES.has(candidate)) {
      return { op: 'edit', category: candidate };
    }
    // category keyword found but candidate not canonical → null (let LLM handle)
    return null;
  }

  return null;
}

// ── detectFinanceEditIntent — intenção LOOSE de mexer numa TRANSAÇÃO (p/ o redirect honesto) ──
// Mais ampla que detectCorrection (que exige extração COMPLETA do alvo pra EXECUTAR). Aqui só
// reconhecemos "o usuário quer editar/apagar um LANÇAMENTO" — pro engine decidir o redirect honesto
// quando está FORA da janela (não precisa do alvo). Exige substantivo de TRANSAÇÃO (não "meta"/
// "conta"/"valor" sozinho) + verbo de edição/exclusão → evita falso-positivo. (Caminho 2 / Fatia 1)
const RE_TXN_NOUN_LOOSE = /\b(lancamento|lancamentos|gasto|gastos|despesa|despesas|compra|compras|transacao|transacoes)\b/;
const RE_DELETE_LOOSE = /\b(exclui\w*|apaga\w*|deleta\w*|remov\w*)\b/;
const RE_EDIT_LOOSE = /\b(era|corrig\w*|ajust\w*|alter\w*|muda\w*|troca\w*|edita\w*|p[õo]e|coloca\w*|classific\w*)\b/;
// FINEDIT-TRANSCRIPT-HIJACK (caso Alf 28/07) — comando de edição de lançamento é CURTO
// ("corrige pra 30", "muda a categoria daquela compra"). Transcrição de áudio, desabafo ou
// briefing NÃO é comando — mas casa por acidente, porque "compra" é ambíguo em PT (lançamento
// financeiro vs. ato de comprar algo) e os verbos do RE_EDIT_LOOSE são banais ("coloca*",
// "muda*", "troca*", "era"). Caso real: áudio de 1min sobre COMPRAR iluminação p/ o Sonoramente
// ("finalizar a compra" + "estamos colocando a marcenaria") virou "esse lançamento tá fora das
// ~2h que consigo editar" em 1 SEGUNDO — resposta determinística, sem passar pelo LLM.
// Mesmo guard do PROJECT-INTENT-TRANSCRIPT-HIJACK (09/07); 3ª vez que este detector sequestra
// turno alheio (ver também FINEDIT-QUOTE-SCAFFOLD-MISROUTE, 27/06).
const CMD_MAX_CHARS = 280;
const CMD_MAX_LINHAS = 5;

function detectFinanceEditIntent(rawText) {
  if (typeof rawText !== 'string' || rawText.trim() === '') return null;
  const _t = rawText.trim();
  if (_t.length > CMD_MAX_CHARS || _t.split('\n').length >= CMD_MAX_LINHAS) return null;
  const norm = normalize(rawText);
  if (!RE_TXN_NOUN_LOOSE.test(norm)) return null;     // precisa referenciar uma TRANSAÇÃO
  if (RE_DELETE_LOOSE.test(norm)) return { op: 'delete' };
  if (RE_EDIT_LOOSE.test(norm)) return { op: 'edit' };
  return null;
}

module.exports = { detectCorrection, detectFinanceEditIntent };

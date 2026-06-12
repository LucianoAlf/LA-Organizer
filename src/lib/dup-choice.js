'use strict';

// AUDIT-OPTIMISTIC-CONFIRM sub-caso 3 (Juliana 10/06) — desambiguação resolvida.
//
// Quando o TOM pergunta a duplicata ("1️⃣ mesma situação / 2️⃣ outro caso / 3️⃣
// cancela") e o user responde em LINGUAGEM NATURAL ("São duas tarefas diferentes"),
// o regex antigo `^[123]` não casava → caía no LLM → o gate de dup disparava de
// novo → menu re-exibido + "✅ criado" falso no mesmo turno.
//
// classifyDupChoice reconhece tanto o dígito quanto a resposta em texto, pra que
// o engine resolva o dup ANTES de chamar o LLM (tryDupBypass) e não re-exiba o menu.
// Só age quando há um dup pendente (gate no caller) → falso-positivo é inócuo.
//
// Retorna '1' (mesma situação) | '2' (outro caso, cria) | '3' (cancela) | null.

const NL_MAXLEN = 50; // respostas de escolha são curtas; descrições longas não casam.

// Dígito puro no início: "2", "2.", "2)", "2 - cria mesmo", "1, é a mesma".
const DIGIT_RE = /^([123])(?:[.)\-\s]|$)/;

// Opção 3 — cancelar/reformular.
const CHOICE3_RE = /\bcancela(r)?\b|vou\s+reformular|\breformular\b|deixa\s+pra\s+l[áa]/i;

// Opção 2 — outro caso / são diferentes / cria mesmo assim.
const CHOICE2_RE =
  /\bdiferentes?\b|\bdistint[oa]s?\b|outr[oa]\s+(caso|coisa|tarefa|assunto|compromisso)\b|s[ãa]o\s+(duas|dois)\b|cria(r)?\s+(separad|a\s+nova|nova|essa|mesmo)|\bsepar(ad[oa]?|o)\b|n[ãa]o\s+[ée]\s+(a\s+)?mesma|pode\s+criar|cria\s+mesmo|mesmo\s+assim/i;

// Opção 1 — mesma situação / já coberta.
const CHOICE1_RE =
  /\bmesm[ao]\b|\bigual\b|j[áa]\s+(t[áa]|est[áa])\s+(cobert|criad|anotad|na\s+agenda|feit)|j[áa]\s+(existe|tem)|deixa\s+(assim|como\s+t[áa])|mant[ée]m|pode\s+(deixar|manter)/i;

function classifyDupChoice(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (!t) return null;

  const digit = t.match(DIGIT_RE);
  if (digit) return digit[1];

  // Linguagem natural só em respostas curtas (evita tratar descrição de tarefa
  // nova como escolha de dup).
  if (t.length > NL_MAXLEN) return null;

  if (CHOICE3_RE.test(t)) return '3';
  if (CHOICE2_RE.test(t)) return '2'; // checa 2 antes de 1: "não é a mesma" = opção 2
  if (CHOICE1_RE.test(t)) return '1';
  return null;
}

module.exports = { classifyDupChoice };

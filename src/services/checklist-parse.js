'use strict';
// Backstop determinístico anti-confab (CHECKLIST-CREATE-CONFAB-NOSUBTASKS, 28/06): quando o user
// pede uma tarefa "com os itens: A, B, C" mas o LLM emite create SEM o array subtasks, o engine
// deriva os itens da FALA — assim "criei N itens" vira verdade, não confabulação. Conservador:
// exige gatilho explícito + dois-pontos + >=2 itens (match errado = item fantasma).

// "com [os/as/<n>] (itens|passos|subtarefas|subitens|checklist|etapas):"
const TRIGGER_RE = /\bcom\s+(?:os\s+|as\s+|\d+\s+)?(?:itens|ítens|passos|sub-?tarefas|subitens|checklist|check-list|etapas)\s*:\s*/i;
// fallback mais fraco: "com: A, B, C"
const TRIGGER_COLON_RE = /\bcom\s*:\s*/i;

function parseInlineChecklist(userText) {
  const text = String(userText == null ? '' : userText);
  if (!text.trim()) return [];
  const m = TRIGGER_RE.exec(text) || TRIGGER_COLON_RE.exec(text);
  if (!m) return [];
  const tail = text.slice(m.index + m[0].length).trim();
  if (!tail) return [];
  // separadores: vírgula, ponto-e-vírgula, quebra de linha, " e " (pt), barra
  const parts = tail
    .split(/\s*[;,\n]\s*|\s+e\s+|\s*\/\s*/i)
    .map((s) => s.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()) // tira bullet/numeração de lista
    .filter(Boolean)
    .filter((s) => s.length <= 80);
  const items = parts.slice(0, 15);
  return items.length >= 2 ? items : []; // <2 itens = não trato como checklist
}

module.exports = { parseInlineChecklist };

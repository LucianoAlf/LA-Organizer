'use strict';
// Resolução anti-confab de um item de checklist (filha via parent_task_id) por TÍTULO, quando o
// TOM diz "fiz o item X" pelo WhatsApp. Match errado = marcar o item ERRADO = confabulação. Regra:
//   match exato único > match parcial único; 0 ou 2+ candidatos → null (TOM pergunta, NÃO adivinha).
// Acento-insensível e case-insensível (o LLM varia "matrícula"/"matricula"). O TOM deve emitir o
// título canônico do contexto; o parcial é só rede de segurança quando a fala envolve o item.

function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (combining marks)
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveChildByTitle(children, query) {
  const q = normalize(query);
  if (!q) return null;
  const list = (children || []).filter((c) => c && c.status !== 'cancelled');
  if (!list.length) return null;
  // 1) match exato (normalizado) — único vence; 2+ exatos = ambíguo → null
  const exact = list.filter((c) => normalize(c.title) === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // 2) parcial: título contém a query OU a query contém o título — único vence; 0/2+ → null
  const partial = list.filter((c) => {
    const t = normalize(c.title);
    return t.includes(q) || q.includes(t);
  });
  if (partial.length === 1) return partial[0];
  return null; // não chuta
}

module.exports = { resolveChildByTitle, normalize };

// Guardrail anti-bomba (Bug BULK-RECUR 29/05 — Jhonatan): bloqueia lote com
// muitas tarefas de título idêntico. Rotina repetida deve ser 1 tarefa
// recorrente + lembretes, não N tarefas avulsas. Conta SÓ action=create,
// agrupando por título normalizado. Grupos com mais de `cap` itens são
// bloqueados inteiros; o resto passa.
function splitBulkIdenticalCreates(actions, cap = 10) {
  const groups = new Map();
  for (const a of actions) {
    if (!a || a.action !== 'create' || typeof a.title !== 'string') continue;
    const key = a.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const blockedSet = new Set();
  for (const [, group] of groups) {
    if (group.length > cap) group.forEach(a => blockedSet.add(a));
  }
  return {
    allowed: actions.filter(a => !blockedSet.has(a)),
    blocked: actions.filter(a => blockedSet.has(a)),
  };
}

module.exports = { splitBulkIdenticalCreates };

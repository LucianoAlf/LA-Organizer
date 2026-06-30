// web/src/lib/taskWatchers.ts
// Quem está "em cópia" de uma tarefa (acompanha e cobra, não conclui).
// Função PURA — testável sem rede. O IO fica em hooks/useTaskWatchers.ts.

/** Delta entre a lista atual de watchers e a próxima. Idempotente e sem duplicatas. */
export function diffWatchers(current: string[], next: string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current);
  const nxt = new Set(next);
  const add = [...nxt].filter(id => !cur.has(id));
  const remove = [...cur].filter(id => !nxt.has(id));
  return { add, remove };
}

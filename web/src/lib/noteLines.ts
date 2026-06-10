// Módulo Anotações — split de linhas pro "⚡ Virar tarefas" (spec 2026-06-10).
// REGRA: linha vazia e linha-header (terminada em ':') não viram tarefa; o resto
// vira, com bullet (•/-/·/*/número.) removido do título proposto.
export interface NoteLine {
  lineNo: number;
  text: string;
  actionable: boolean;
}

export function splitNoteLines(body: string): NoteLine[] {
  return String(body || '').split('\n').map((raw, i) => {
    const t = raw.trim();
    const isHeader = /:\s*$/.test(t);
    const text = t.replace(/^[•\-·*]\s*|^\d+[.)]\s*/, '').trim();
    return { lineNo: i, text, actionable: !!text && !isHeader };
  });
}

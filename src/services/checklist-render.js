'use strict';
// Espelho EXATO do helper do PWA (web/src/lib/taskChecklist.ts) pro engine montar o mesmo bloco
// de progresso de checklist. Paridade byte-a-byte travada por checklist-render.test.js.
// O bloco é DADO determinístico injetado nas mensagens (alerta de atrasada / briefing) — não muda a voz do TOM.

// assigneeName: nome a exibir no label — o delegador vê o nome do executor; o próprio executor vê sem nome.
// Barra: 1 segmento por item até 10; acima disso escala proporcional (cap 10). O label X/N é a fonte de verdade.
function renderChecklistBlock(children, opts = {}) {
  const counted = (children || []).filter((c) => c && c.status !== 'cancelled');
  const total = counted.length;
  if (total === 0) return '';
  const done = counted.filter((c) => c.status === 'done').length;
  const segments = Math.min(total, 10);
  const filled = Math.round((done / total) * segments);
  const bar = '▓'.repeat(filled) + '░'.repeat(segments - filled);
  const label = opts.assigneeName ? `*Checklist* ${opts.assigneeName}:` : '*Checklist:*';
  const header = `${label} ${done}/${total} ${bar}`;
  const sorted = [...counted].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0));
  const lines = sorted.map((c) => `${c.status === 'done' ? '✅' : '⬜'} ${c.title}`);
  return [header, ...lines].join('\n');
}

// Cascade: o pai deve auto-concluir sse tem itens (não-cancelados) e TODOS estão done.
function shouldAutocompleteParent(children) {
  const counted = (children || []).filter((c) => c && c.status !== 'cancelled');
  if (counted.length === 0) return false;
  return counted.every((c) => c.status === 'done');
}

module.exports = { renderChecklistBlock, shouldAutocompleteParent };

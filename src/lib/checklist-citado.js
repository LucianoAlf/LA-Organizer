'use strict';
// checklist-citado.js — CHECKLIST-POR-CITACAO (Quintela 06/07 — finding 50443ed4).
//
// Quintela citou o alerta "🟠 *Tentativa de Retenção - Maria Uebe* tá parada… Checklist 0/4" e disse
// "a única coisa que ficou faltando é a resposta da família, no caso o primeiro item, o resto já coloque
// como feito". O TOM respondeu "itens 2, 3 e 4 você já fechou pelo app" (falso) e não marcou nada. Com o
// alerta hoje vinculado à tarefa, o TASKDONE por citação fecharia a MÃE inteira (o detector lê "feito"
// como sim) com o item 1 aberto. Aqui a fala vira QUAIS itens marcar, pela ordem em que o alerta mostrou
// o checklist. Na dúvida devolve null: nada é marcado e a mãe não fecha (o LLM pergunta). PURO.

const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Só formas masculinas ("o primeiro item"): "quarta"/"quinta"/"sexta" são dia da semana.
const ORD = { primeir: 1, segund: 2, terceir: 3, quart: 4, quint: 5, sext: 6, setim: 7, oitav: 8, non: 9, decim: 10 };
const ORD_QUALQUER_RE = /\d|\b(primeir|segund|terceir|quart|quint|sext|setim|oitav|non[oa]|decim)/;
const FEITO_RE = /\b(feit[oa]s?|fiz|fizemos|fizeram|conclu\w*|pront[oa]s?|resolvid[oa]s?|fechad[oa]s?|marca\w*|baixa)\b/;
const RESTO_RE = /\b(o resto|o restante|os restantes|os outros|os demais|tudo menos|todos menos|exceto|fora o)\b/;
const FALTA_RE = /\b(s[oó] falt\w*|falt\w* s[oó]|unica coisa que (?:ficou )?falt\w*|ficou faltando|ficou pendente|ainda falt\w*)\b/;
const NEG_RE = /\b(nao|nem)\b/;
const _positiva = (c) => FEITO_RE.test(c) && !NEG_RE.test(c);

/** Posições (1-based) citadas: "o primeiro item", "itens 2, 3 e 4", "o 1º e o 4º". */
function ordinaisCitados(texto) {
  const t = _norm(texto);
  const pos = new Set();
  for (const [raiz, n] of Object.entries(ORD)) if (new RegExp(`\\b${raiz}os?\\b`).test(t)) pos.add(n);
  for (const m of t.match(/\bite(?:m|ns)\s*(?:n[o°º]?\s*)?\d+(?:\s*(?:,|e|\/|&)\s*\d+)*/g) || []) {
    for (const d of m.match(/\d+/g)) pos.add(Number(d));
  }
  for (const m of t.matchAll(/\b(\d+)[º°o](?!\w)/g)) pos.add(Number(m[1]));
  return pos;
}

/** O checklist na ordem em que o alerta mostrou (a do renderChecklistBlock). */
function ordenadas(filhas) {
  return (filhas || []).filter((c) => c && c.status !== 'cancelled')
    .sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0));
}

/**
 * planoDaCitacao({ userText, filhas, confirmou }) → { marcar, faltam } | null.
 * confirmou = o detector de conclusão disse "sim" (só vale pro "feito" curto, sem item citado).
 */
function planoDaCitacao({ userText, filhas, confirmou }) {
  const lista = ordenadas(filhas);
  const pend = lista.filter((c) => c.status !== 'done');
  if (!pend.length) return null;
  const t = _norm(userText);
  const clausulas = t.split(/[,.;!?\n]|\s+mas\s+/);
  const pos = ordinaisCitados(t);
  for (const p of pos) if (p < 1 || p > lista.length) return null; // item que não existe: não chuta
  const citados = [...pos].map((p) => lista[p - 1]);
  const temResto = RESTO_RE.test(t);
  const restoPositivo = clausulas.some((c) => RESTO_RE.test(c) && _positiva(c));
  const faltaComFeito = FALTA_RE.test(t) && clausulas.some(_positiva);
  if (temResto && !restoPositivo) return null; // "o primeiro fiz, o resto não" — não inverte
  if (restoPositivo || faltaComFeito) {
    if (!pos.size) return null; // "o resto feito" sem dizer qual falta: pergunta
    const marcar = pend.filter((c) => !citados.includes(c));
    return marcar.length ? { marcar, faltam: pend.filter((c) => citados.includes(c)) } : null;
  }
  if (pos.size) {
    if (NEG_RE.test(t) || !FEITO_RE.test(t)) return null; // "o item 2 ainda não, o 3 fiz": não adivinha
    const marcar = citados.filter((c) => c.status !== 'done');
    return marcar.length ? { marcar, faltam: pend.filter((c) => !marcar.includes(c)) } : null;
  }
  // "feito" curto, sem item nem número: fecha o checklist todo (a mãe fecha pelo cascade do mark-item).
  const palavras = t.split(/\s+/).filter(Boolean).length;
  if (confirmou && !NEG_RE.test(t) && palavras <= 6 && !ORD_QUALQUER_RE.test(t) && !FALTA_RE.test(t)) {
    return { marcar: pend, faltam: [] };
  }
  return null;
}

function textoChecklistMarcado({ titulo, marcados, bloco, avisos }) {
  const n = marcados;
  const cab = `✅ Marquei ${n === 1 ? '1 item' : `${n} itens`} do checklist de *${titulo}*.`;
  return [cab, bloco, ...(avisos || [])].filter(Boolean).join('\n\n');
}

/** Pista pro LLM quando a fala não deu pra ler com segurança: os itens com id, e o que não fazer. */
function pistaChecklist(parentId, filhas) {
  const pid = String(parentId).slice(0, 8);
  const linhas = ordenadas(filhas).map((c, i) => `${i + 1}. item_id ${String(c.id).slice(0, 8)} — ${c.status === 'done' ? '✅' : '⬜'} ${c.title}`);
  return '\n\n[CHECKLIST DA TAREFA CITADA — não verbalize ids]\n' + linhas.join('\n')
    + `\nSe ele disse que fez itens desse checklist, emita um mark-item por item feito: <<TASK_UPDATE>>[{"action":"mark-item","parent_id":"${pid}","item_id":"<item_id>","done":true}]<<END>>. `
    + 'NÃO conclua a tarefa inteira enquanto houver item ⬜, e não afirme que ele já marcou pelo app — o estado é o da lista acima.';
}

module.exports = { planoDaCitacao, ordinaisCitados, textoChecklistMarcado, pistaChecklist };

'use strict';
// memoria-remocao.js — MEMORIA-APAGAR-PELO-CHAT (Anne Susan, 12/09/2026 — achado 84d9581f).
//
// Ela respondeu ao briefing: "Tom não existe essa prova de clínica psicanalítica. Pode tirar da lista
// de lembretes". O TOM respondeu "Entendido, Anne! Tiro isso agora." e NADA saiu: o marcador que ele
// emitiu (<<MEMORY_SAVE>> action:"delete") morria em dois pontos — `persistMemoryRows` ignora
// `action` (não existe caminho de remoção) e o conteúdo vinha na chave `fact`, fora da lista aceita.
// Resultado: promessa cumprida por ninguém, e a memória de 31/05 seguiu ativa e sendo anunciada.
//
// Aqui mora a DECISÃO de qual anotação sai. Regra anti-confab: só remove quando o alvo é ÚNICO
// (igual, ou contém/contida, ou 2+ palavras significativas com vencedor sem empate). Na dúvida
// devolve null — o TOM diz que não achou em vez de apagar a anotação errada. PURO.

const ACOES_REMOCAO = new Set(['delete', 'remove', 'remover', 'apagar', 'esquecer', 'forget', 'tirar', 'excluir']);
const _norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim();
const STOP = new Set(['para', 'pra', 'com', 'sem', 'sobre', 'esse', 'essa', 'isso', 'aquele', 'aquela',
  'que', 'nao', 'uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'pelo', 'pela', 'lista', 'lembrete', 'lembretes']);

/** A linha do marcador pede REMOÇÃO (action delete/remove/apagar/esquecer/...)? */
function ehRemocao(row) {
  if (!row || typeof row !== 'object') return false;
  return ACOES_REMOCAO.has(_norm(row.action));
}

/**
 * escolherMemoriaParaRemover(conteudo, memorias) → a memória ÚNICA que casa, ou null.
 * memorias: [{ id, content }] ativas do próprio colaborador.
 */
function escolherMemoriaParaRemover(conteudo, memorias) {
  const q = _norm(conteudo);
  const lista = (memorias || []).filter((m) => m && m.id && typeof m.content === 'string');
  if (!lista.length) return null;

  const exatas = lista.filter((m) => _norm(m.content) === q);
  if (exatas.length) return exatas.length === 1 ? exatas[0] : null;

  // Daqui pra baixo exige 2+ palavras significativas: "briefing" sozinho casa por substring e
  // apagaria a anotação errada com cara de acerto (medido no teste do lote 39).
  const toks = [...new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
  if (toks.length < 2) return null;

  const contem = lista.filter((m) => {
    const c = _norm(m.content);
    return c.includes(q) || q.includes(c);
  });
  if (contem.length) return contem.length === 1 ? contem[0] : null;

  let melhor = null;
  let melhorN = 0;
  let empate = false;
  for (const m of lista) {
    const c = _norm(m.content);
    const n = toks.filter((t) => c.includes(t)).length;
    if (n > melhorN) { melhor = m; melhorN = n; empate = false; } else if (n === melhorN && n > 0) { empate = true; }
  }
  return (melhor && melhorN >= 2 && !empate) ? melhor : null;
}

const _curto = (t) => (String(t || '').length > 70 ? `${String(t).slice(0, 70)}…` : String(t || ''));

/** O que o TOM ANEXA depois de executar: só o que saiu de verdade, e o que não achou. */
function textoRemocao({ removidas = [], naoAchadas = [] } = {}) {
  const linhas = [];
  if (removidas.length) linhas.push(`🗑️ Tirei da sua lista: ${removidas.map((t) => `*${_curto(t)}*`).join(', ')}.`);
  if (naoAchadas.length) linhas.push('Não achei essa anotação aqui — me manda uma frase que apareça nela que eu tiro.');
  return linhas.join('\n');
}

module.exports = { ehRemocao, escolherMemoriaParaRemover, textoRemocao, ACOES_REMOCAO };

'use strict';
// TASK-TITLE-FUZZY-RESOLVE — fallback puro de resolução de tarefa por título.
//
// Contexto: os handlers de complete/cancel/reschedule (engine.js) resolvem a tarefa por
// SUBSTRING (`ilike '%titulo%'`). Quando o TOM abrevia/reordena o título, as palavras não são
// contíguas e o substring volta vazio → a ação some (dor #1 do audit 27/07, TASK_UPDATE ~14%).
//
// Este helper é o FALLBACK: recebe o título pedido + o pool de tarefas abertas do usuário (já
// buscado pelo caller) e devolve o alvo SÓ quando há um único candidato cujos tokens cobrem os
// do pedido. Se ≥2 servem, devolve `ambiguous` — o caller pergunta em vez de fechar a errada
// (guard contra os 60% de títulos duplicados). Puro, sem I/O, nunca lança.
//
// Sinal = CONTAINMENT (tokens do pedido ⊆ tokens da tarefa). Modela abreviação melhor que o
// Jaccard puro, que penaliza os tokens extras do título completo. `sim` (Jaccard) segue no
// `scored` só para telemetria/medição.

// Mesma lista do dedup do grupo (src/services/group-chat-tasks.js) — fonte única, sem drift.
const _STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'para', 'pra', 'pro', 'que', 'esse', 'essa', 'esses', 'essas', 'um', 'uma', 'no', 'na', 'em', 'com', 'ao', 'aos', 'à', 'às', 'the']);

// Fração mínima dos tokens do pedido que precisa estar contida no candidato (1.0 = todos).
// Configurável por env só para medição; default conservador.
const CONTAIN_MIN = Number(process.env.TOM_FUZZY_CONTAIN_MIN || '1') || 1;

// Conjunto de tokens normalizados (minúsculo, sem acento, sem pontuação, sem stopword).
function _tokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos combinantes
      .replace(/[^a-z0-9\s]/g, ' ')                     // pontuação → espaço
      .split(/\s+/)
      .filter((w) => w && !_STOPWORDS.has(w)),
  );
}

function _jaccard(A, B) {
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// resolveByTitleFuzzy(requestedTitle, candidates, opts)
//   candidates: [{ id, title, ... }]  (pool de abertas do usuário, já buscado pelo caller)
//   opts.containMin: sobrepõe CONTAIN_MIN (0..1)
//   → { match: <candidato|null>, ambiguous: <bool>, scored: [{ c, contain, sim }] }
function resolveByTitleFuzzy(requestedTitle, candidates, opts = {}) {
  const containMin = typeof opts.containMin === 'number' ? opts.containMin : CONTAIN_MIN;
  const req = _tokens(requestedTitle);
  const rows = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.title);
  // Guard: pedido com <2 tokens úteis é ambíguo demais pra auto-resolver (1 token ⊆ quase tudo).
  if (req.size < 2 || rows.length === 0) return { match: null, ambiguous: false, scored: [] };

  const scored = rows.map((c) => {
    const t = _tokens(c.title);
    let inter = 0;
    for (const w of req) if (t.has(w)) inter++;
    return { c, contain: inter / req.size, sim: _jaccard(req, t) };
  }).sort((x, y) => (y.contain - x.contain) || (y.sim - x.sim));

  const qualif = scored.filter((s) => s.contain >= containMin);
  if (qualif.length === 0) return { match: null, ambiguous: false, scored };
  if (qualif.length === 1) return { match: qualif[0].c, ambiguous: false, scored };
  // ≥2 servem — NÃO chuta: o caller pergunta.
  return { match: null, ambiguous: true, scored };
}

module.exports = { resolveByTitleFuzzy, _tokens };

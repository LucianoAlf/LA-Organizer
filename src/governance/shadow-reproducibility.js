'use strict';
// v1 conservador: só aceita turno curto encenável. Na dúvida, ok:false (a sombra não
// finge cobrir cron/grupo/multi-turno — esses caem no gate determinístico via inconclusivo).
const CATS_OK = new Set(['confabulation', 'dropped_request']);
// Sinais de cenário caro/irreproduzível no texto do finding.
const MULTITURNO_RE = /fatura|parte\s*[1-9]|cruzamento|cobran[çc]a|lote|di[áa]ri[ao]|todos os dias|parcial|em lote|menu.*dup|reply-quote/i;

function isReproducible(finding) {
  const f = finding || {};
  if (f.group_id) return { ok: false, motivo: 'grupo (v1 não encena chat de grupo)' };
  if (!CATS_OK.has(f.category)) return { ok: false, motivo: `categoria ${f.category || '?'} fora do escopo v1` };
  const txt = String(f.evidence || f.summary || '').trim();
  if (!txt) return { ok: false, motivo: 'sem evidência aferível' };
  if (MULTITURNO_RE.test(txt)) return { ok: false, motivo: 'cenário cron/multi-turno' };
  return { ok: true, motivo: 'turno curto encenável' };
}

module.exports = { isReproducible };

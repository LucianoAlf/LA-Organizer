'use strict';

// #2D1 — fechar instâncias HOMÔNIMAS de evento de uma vez. Caso Leo "Entre Teclas" (26 e
// 27): o usuário disse que o show já aconteceu e quis dar baixa nos DOIS, mas o LLM emitiu
// 1 EVENT_UPDATE (fechou 1). Este helper PURO escolhe os irmãos homônimos que devem fechar
// junto com o evento já resolvido.
//
// ESCOPO APERTADO (a voz/dados são sagrados — não fechar evento errado):
//   - mesmo título normalizado, status ABERTO (≠ done/cancelled), id ≠ o já resolvido;
//   - o resolvido E o irmão AMBOS no PASSADO (start < now) — completar evento que já
//     aconteceu é benigno/esperado; nunca fecha evento futuro por tabela;
//   - |Δstart| <= WINDOW_DAYS do resolvido → evita pegar instâncias de RECORRÊNCIA semanal
//     ("completa a aula de hoje" NÃO fecha as aulas de semanas atrás);
//   - cap MAX p/ não desbocar.
// Só roda no action 'complete' (caller). Reschedule/cancel/update NÃO fazem fan-out.

const WINDOW_DAYS = 3;
const MAX_SIBLINGS = 4;

function _norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
const _isOpen = (st) => st !== 'done' && st !== 'cancelled';

/** resolved: {id,title,status,start_at}; candidates: lista do MESMO dono. Retorna ids p/ fechar. */
function pickHomonymSiblingsToComplete(resolved, candidates, nowMs, opts = {}) {
  if (!resolved || !resolved.id || !resolved.start_at) return [];
  const win = (opts.windowDays != null ? opts.windowDays : WINDOW_DAYS) * 86400000;
  const max = opts.max != null ? opts.max : MAX_SIBLINGS;
  const rStart = Date.parse(resolved.start_at);
  if (!Number.isFinite(rStart) || rStart >= nowMs) return []; // fan-out só de evento PASSADO
  const title = _norm(resolved.title);
  if (!title) return [];
  const out = [];
  for (const c of (candidates || [])) {
    if (!c || !c.id || c.id === resolved.id) continue;
    if (_norm(c.title) !== title) continue;
    if (!_isOpen(c.status)) continue;
    if (!c.start_at) continue;
    const cs = Date.parse(c.start_at);
    if (!Number.isFinite(cs) || cs >= nowMs) continue;       // irmão também tem que ser passado
    if (Math.abs(cs - rStart) > win) continue;               // dentro da janela do resolvido
    out.push(c.id);
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { pickHomonymSiblingsToComplete, WINDOW_DAYS, MAX_SIBLINGS };

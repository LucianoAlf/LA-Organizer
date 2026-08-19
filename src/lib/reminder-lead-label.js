'use strict';
// src/lib/reminder-lead-label.js
// EVENT-REMINDER-DUPLO-SEM-ETIQUETA (Alf 19/08) — etiqueta de antecedência de um lembrete,
// computada do par (remind_at, start_at) na hora do ENVIO. Dois lembretes propositais do mesmo
// evento (2h antes + 1h antes) saíam byte-idênticos porque `event_reminders.label` vinha null
// nos dois — pro usuário parecia mensagem duplicada/bugada. Computar aqui (um ponto só, o
// dispatcher) conserta o passado inteiro: nenhuma linha do banco precisa de backfill.
// PURA. Arredonda ao minuto (jitter de segundos não vira "59min"). Lead ≤ 0 → null (sem
// etiqueta: lembrete "na hora" não precisa se explicar).

function leadLabel(remindAtIso, startAtIso) {
  const r = Date.parse(remindAtIso);
  const s = Date.parse(startAtIso);
  if (!Number.isFinite(r) || !Number.isFinite(s)) return null;
  const min = Math.round((s - r) / 60000);
  if (min <= 0) return null;
  if (min < 60) return `${min}min antes`;
  if (min % 1440 === 0) {
    const d = min / 1440;
    return d === 1 ? '1 dia antes' : `${d} dias antes`;
  }
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h}h antes` : `${h}h${String(rest).padStart(2, '0')} antes`;
}

module.exports = { leadLabel };

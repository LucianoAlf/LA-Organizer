'use strict';
// horarios-do-chip.js — os horários de lembrete GRAVADOS numa tarefa, como o chip do grupo mostra. PURO.
// DOIS-HORARIOS-UM-LEMBRETE (Kailane, Barra 22/09): o chip dizia só "atualizada" quando o 2º horário
// sobrescrevia o 1º. Agora mostra o que ficou no banco: "🔔 29/09 09h e 15h". Um horário só → ''
// (o chip de sempre não muda).
function _brt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return { dia: `${p.day}/${p.month}`, hora: p.minute === '00' ? `${p.hour}h` : `${p.hour}h${p.minute}` };
}

function horariosDoChip(lista) {
  const hs = (Array.isArray(lista) ? lista : []).map(_brt).filter(Boolean);
  if (hs.length < 2) return '';
  const mesmoDia = hs.every((h) => h.dia === hs[0].dia);
  const partes = mesmoDia ? hs.map((h) => h.hora) : hs.map((h) => `${h.dia} ${h.hora}`);
  const juntos = partes.length === 2 ? partes.join(' e ') : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
  return `🔔 ${mesmoDia ? hs[0].dia + ' ' : ''}${juntos}`;
}

module.exports = { horariosDoChip };

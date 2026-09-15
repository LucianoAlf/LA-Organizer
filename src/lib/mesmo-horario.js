'use strict';
// mesmo-horario.js — EVENTO-PARECIDO-EM-OUTRO-DIA (Alf 14/09, decisão dele em 15/09).
//
// Ele marcou "Mentoria com Levi" pra sexta 9h e, logo depois, "Mentoria com Kennedy" pra quinta 9h.
// O TOM travou três vezes: "Parece que já existe um compromisso parecido na agenda", depois o menu
// "Achei um compromisso parecido já criado: Mentoria com Levi" — e só gravou no terceiro pedido.
// Dia diferente, pessoa diferente. A busca de duplicata olhava ±48h e pontuava por título: o prefixo
// "Mentoria com" dava similaridade alta e "Mentoria" (maiúscula) contava como palavra distintiva.
//
// Regra do Alf: "só se for no mesmo horário — aí ele fala: tu já tem um compromisso nesse horário".
// Quarta, quinta e sexta com mentoria às 9h são três compromissos, não um. PURO.

const HORA = 3600000;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function _diaBRT(ms) {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

/** {ini, fim} em ms; sem fim assume 1h. null se não tiver início legível. */
function intervalo(ev) {
  const ini = ev && ev.start_at ? Date.parse(ev.start_at) : NaN;
  if (!Number.isFinite(ini)) return null;
  const fimLido = ev.end_at ? Date.parse(ev.end_at) : NaN;
  const fim = Number.isFinite(fimLido) && fimLido > ini ? fimLido : ini + HORA;
  return { ini, fim };
}

/** Horários que se sobrepõem — é a única situação em que dois compromissos colidem (inclusive os que
 *  atravessam a meia-noite, por isso a regra é o intervalo e não "o mesmo dia"). */
function mesmoHorario(a, b) {
  const x = intervalo(a);
  const y = intervalo(b);
  if (!x || !y) return false;
  return x.ini < y.fim && y.ini < x.fim;
}

function _hm(ms) {
  const [h, m] = new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).split(':');
  return Number(m) === 0 ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

/** "qui 17/09, 9h–10h" — como a pessoa lê o horário que já está ocupado. */
function rotuloHorario(ev) {
  const x = intervalo(ev);
  if (!x) return '';
  const [, mm, dd] = _diaBRT(x.ini).split('-');
  const dow = DIAS[new Date(`${_diaBRT(x.ini)}T12:00:00-03:00`).getUTCDay()];
  return `${dow} ${dd}/${mm}, ${_hm(x.ini)}–${_hm(x.fim)}`;
}

module.exports = { mesmoHorario, rotuloHorario, intervalo };

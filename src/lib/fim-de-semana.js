'use strict';
// fim-de-semana.js — FIM-DE-SEMANA-EMPURRA-SEGUNDA (decisão do Alf, 11/09/2026 — aaf37e2b).
//
// Rose 15/08, grupo: "2 dias após o fechamento; se cair sábado ou domingo, empurra pra segunda".
// O pacote mensal "Pedir fatura…" gravou filhas em 01/08 e 29/08 (sábado) e 20/09 (domingo) —
// nenhuma linha do motor de recorrência olhava o dia da semana. Decisão: rotina que CAI no fim de
// semana vai pra segunda. Escopo: só regra MENSAL/ANUAL — nela o dia da semana é acaso do
// calendário. Diária e semanal já dizem o dia de propósito (e as unidades têm aula no sábado).
function empurraFimDeSemana(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd == null ? '' : ymd));
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dow = d.getUTCDay();
  const soma = dow === 6 ? 2 : (dow === 0 ? 1 : 0);
  if (!soma) return ymd;
  d.setUTCDate(d.getUTCDate() + soma);
  return d.toISOString().slice(0, 10);
}

function ehRegraMensal(rule) {
  return /FREQ=(MONTHLY|YEARLY)\b/i.test(String(rule == null ? '' : rule));
}

module.exports = { empurraFimDeSemana, ehRegraMensal };

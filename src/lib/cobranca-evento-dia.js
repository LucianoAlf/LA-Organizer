'use strict';

// COBRANCA-ONTEM-ERRADO (Alf 07/10 08:14 BRT). A cobrança das 08:00 (checkOverdueWorkEvents)
// mandou "🔵 Luciano, como foi *Mentoria Levi* ontem?" — o evento era de 05/10, anteontem. O
// dia vinha de floor((agora − FIM do evento) / 24h): 05/10 10:00 → 07/10 08:14 são 46h, que
// dão 1 → "ontem". Hora decorrida não é dia de calendário: tudo que acabou entre 08:00 e 23:59
// de anteontem caía em "ontem". Agora o dia é a diferença de DATAS no fuso de SP entre o dia do
// INÍCIO do evento e hoje, e a palavra sai dessa data: hoje cedo / ontem / anteontem / no dia DD/MM.
// A régua de cor (🔵 ≤1d, 🟠 2–3d, 🚨 4+d) segue a mesma, só que medida em dias de calendário.

const FUSO = 'America/Sao_Paulo';
const _ymd = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

function _utcDia(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function diasCorridos(startIso, hojeYmd) {
  const diaEv = _ymd.format(new Date(startIso));
  return Math.max(0, Math.round((_utcDia(hojeYmd) - _utcDia(diaEv)) / 86400000));
}

function quandoFoi(startIso, hojeYmd) {
  const dias = diasCorridos(startIso, hojeYmd);
  if (dias === 0) return 'hoje cedo';
  if (dias === 1) return 'ontem';
  if (dias === 2) return 'anteontem';
  const [, mm, dd] = _ymd.format(new Date(startIso)).split('-');
  return `no dia ${dd}/${mm}`;
}

function textoCobranca({ nome, titulo, startIso, hojeYmd }) {
  const dias = diasCorridos(startIso, hojeYmd);
  const quando = quandoFoi(startIso, hojeYmd);
  if (dias <= 1) {
    return { dias, kind: 'closure_check', texto: `🔵 ${nome}, como foi *${titulo}* ${quando}? Me diz "feito" pra fechar, ou conta o que rolou.` };
  }
  if (dias <= 3) {
    return { dias, kind: 'overdue_check', texto: `🟠 ${nome}, *${titulo}* (${quando}) ficou aberta. Já rolou? Manda "feito" ou me conta — texto/áudio.` };
  }
  return { dias, kind: 'staleness_check', texto: `🚨 ${nome}, *${titulo}* (${quando}, há ${dias} dias) sem fechamento. Fecha ou reagenda? Não dá pra ignorar — qualquer resposta serve.` };
}

module.exports = { diasCorridos, quandoFoi, textoCobranca };

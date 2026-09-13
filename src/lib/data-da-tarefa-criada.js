'use strict';
// data-da-tarefa-criada.js — DATA-DA-TAREFA-NAO-DITA (Yuri 12/09/2026, auditoria cruzada 13/09).
//
// Ele escreveu "Tom segunda feira tarefa pra mim agendar as entrevistas do drums connections do ano
// passado". A tarefa nasceu CERTA (due 14/09, segunda) e a confirmação foi "Anotado, Yuri. 🔔 Lembro
// às 14h." — o DIA não aparece em lugar nenhum. Quem pediu "pra segunda" fica sem saber se ficou pra
// segunda; e o único jeito de conferir é abrir o app.
//
// É exatamente o buraco que a Fatia 6 fechou pra HORA (utils/reminder-notice.js): o dado está certo
// no banco e some na fala. Aqui é a DATA, com a mesma regra — só anexa quando a fala NÃO cita, e na
// dúvida prefere anexar a esconder. PURO.

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function _partes(ymd) {
  const m = YMD_RE.exec(String(ymd == null ? '' : ymd).slice(0, 10));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
const _utc = (p) => Date.UTC(p.y, p.m - 1, p.d);
const _ddmm = (p) => `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;

/** Dias de diferença entre duas datas YMD (positivo = futuro). */
function diasDeDiferenca(ymd, hojeYmd) {
  const a = _partes(ymd);
  const b = _partes(hojeYmd);
  if (!a || !b) return null;
  return Math.round((_utc(a) - _utc(b)) / 86400000);
}

/** Como a pessoa chamaria essa data: "hoje", "amanhã (14/09)", "segunda, 14/09", "14/09". */
function rotuloDaData(ymd, hojeYmd) {
  const p = _partes(ymd);
  if (!p) return null;
  const diff = diasDeDiferenca(ymd, hojeYmd);
  if (diff === 0) return 'hoje';
  if (diff === 1) return `amanhã (${_ddmm(p)})`;
  if (diff !== null && diff > 1 && diff <= 6) return `${DIAS[new Date(_utc(p)).getUTCDay()]}, ${_ddmm(p)}`;
  return _ddmm(p);
}

/** A fala já diz essa data? (dd/mm, d/m, o nome do dia da semana, "amanhã" ou "hoje"). */
function falaCitaData(fala, ymd, hojeYmd) {
  const p = _partes(ymd);
  if (!p) return true; // sem data pra conferir: não anexa nada
  const s = String(fala || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const diff = diasDeDiferenca(ymd, hojeYmd);
  if (diff === 0 && /\bhoje\b/.test(s)) return true;
  if (diff === 1 && /\bamanha\b/.test(s)) return true;
  if (diff !== null && diff > 1 && diff <= 6) {
    const dia = DIAS[new Date(_utc(p)).getUTCDay()].normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (new RegExp(`\\b${dia}(-feira)?\\b`).test(s)) return true;
  }
  const d = String(p.d);
  const m = String(p.m);
  return new RegExp(`(?<!\\d)0?${d}\\s*/\\s*0?${m}(?!\\d)`).test(s);
}

/**
 * A primeira tarefa criada cuja DATA não aparece na fala. Tarefa de hoje não conta (o "hoje" é o
 * padrão e dizer isso em toda confirmação vira ruído). null = a fala está completa.
 */
function faltaDataNaFala(fala, criadas, hojeYmd) {
  for (const c of (Array.isArray(criadas) ? criadas : [])) {
    if (!c || !_partes(c.due_date)) continue;
    if (diasDeDiferenca(c.due_date, hojeYmd) === 0) continue;
    if (falaCitaData(fala, c.due_date, hojeYmd)) continue;
    return { title: c.title || null, due_date: String(c.due_date).slice(0, 10) };
  }
  return null;
}

function textoDataCriada(alvo, hojeYmd) {
  const rot = alvo && rotuloDaData(alvo.due_date, hojeYmd);
  return rot ? `📅 Fica para *${rot}*.` : '';
}

module.exports = { faltaDataNaFala, textoDataCriada, rotuloDaData, falaCitaData, diasDeDiferenca };

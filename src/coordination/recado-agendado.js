'use strict';
// recado-agendado.js — RECADO-AGENDADO (decisão do Alf, 11/09/2026 — finding 03f2c79b).
//
// Clayton 14/07 19:43: "Manda mensagem pro Luciano amanhã lembrando ele do notebook." Não existia
// recado com data — o TOM só tinha lembrete, trocou por "TE lembro às 9h" e o Luciano nunca soube.
// Agora o <<COORDINATION_REQUEST>> aceita `send_at`: o engine grava status 'scheduled' e o
// despachante envia no horário pelo MESMO executor do recado imediato.
// PURO: quem grava é o engine; quem envia é o despachante.

const TZ = 'America/Sao_Paulo';
const JANELA_AGORA_MS = 2 * 60 * 1000;          // até 2 min à frente = "agora"
const MAX_FUTURO_MS = 60 * 24 * 3600 * 1000;    // 60 dias
const ALIASES = ['send_at', 'enviar_em', 'scheduled_at', 'send_time'];
const CANCELA = new Set(['cancel_scheduled', 'cancelar_agendado', 'cancel', 'cancelar']);
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** @returns {{sendAt: string|null} | {erro: 'send_at_invalido'|'send_at_passado'|'send_at_longe'}} */
function lerEnvioAgendado(obj, agoraMs = Date.now()) {
  const bruto = ALIASES.map((k) => obj && obj[k]).find((v) => v !== undefined && v !== null && v !== '');
  if (bruto === undefined) return { sendAt: null };
  if (typeof bruto !== 'string') return { erro: 'send_at_invalido' };
  let s = bruto.trim();
  // sem fuso → horário de Brasília (é como a casa fala)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) s += '-03:00';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return { erro: 'send_at_invalido' };
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return { erro: 'send_at_invalido' };
  if (ms < agoraMs - JANELA_AGORA_MS) return { erro: 'send_at_passado' };
  if (ms <= agoraMs + JANELA_AGORA_MS) return { sendAt: null };
  if (ms > agoraMs + MAX_FUTURO_MS) return { erro: 'send_at_longe' };
  return { sendAt: new Date(ms).toISOString() };
}

/** Horário ainda à frente (fora da janela de "agora")? Se passou enquanto a pessoa confirmava, vai já. */
function aindaAgendavel(iso, agoraMs = Date.now()) {
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) && ms > agoraMs + JANELA_AGORA_MS;
}

function ehCancelamentoAgendado(obj) {
  return !!obj && CANCELA.has(String(obj.action || '').trim().toLowerCase());
}

const _ymd = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ });
function _hm(ms) {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const h = Number(p.find((x) => x.type === 'hour').value);
  const m = p.find((x) => x.type === 'minute').value;
  return m === '00' ? `${h}h` : `${h}h${m}`;
}

/** "hoje às 15h30" · "amanhã (15/07) às 9h" · "ter 15/09 às 9h" */
function quandoLegivel(iso, agoraMs = Date.now()) {
  const ms = Date.parse(iso);
  const dia = _ymd(ms);
  const dm = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  let d;
  if (dia === _ymd(agoraMs)) d = 'hoje';
  else if (dia === _ymd(agoraMs + 86400e3)) d = `amanhã (${dm})`;
  else d = `${SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${dm}`;
  return `${d} às ${_hm(ms)}`;
}

function textoAgendado(nome, iso, agoraMs, shortId) {
  return `🕘 Combinado — mando pra *${nome}* ${quandoLegivel(iso, agoraMs)}. [ID: ${shortId}]`;
}

const _trecho = (b) => { const s = String(b || '').replace(/\s+/g, ' ').trim(); return s.length > 80 ? `${s.slice(0, 79)}…` : s; };

function textoAvisoSolicitante(nome, corpo, ok) {
  return ok
    ? `📨 Mandei pra *${nome}* o recado que você agendou: _"${_trecho(corpo)}"_`
    : `⚠️ Não consegui mandar pra *${nome}* o recado agendado (_"${_trecho(corpo)}"_). Quer que eu tente de novo?`;
}

function textoCancelado(nome, n) {
  if (!n) return `Não achei recado agendado pra *${nome}* — nada pra cancelar.`;
  return `🗑️ Cancelei ${n === 1 ? 'o recado agendado' : `os ${n} recados agendados`} pra *${nome}*.`;
}

function textoErroHorario(erro, nome) {
  if (erro === 'send_at_passado') return `Esse horário já passou — mando pra *${nome}* agora ou em outro horário?`;
  if (erro === 'send_at_longe') return `Isso é daqui a mais de 60 dias — me confirma a data certinha pra mandar pra *${nome}*?`;
  return `Não entendi o horário pra mandar pra *${nome}* — que dia e hora?`;
}

module.exports = {
  lerEnvioAgendado, aindaAgendavel, ehCancelamentoAgendado, quandoLegivel,
  textoAgendado, textoAvisoSolicitante, textoCancelado, textoErroHorario,
};

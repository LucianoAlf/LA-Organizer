'use strict';

// EVENTO-CRIADO-NO-PASSADO (Alf 05/10 19:14 BRT). "Mentoria Levi" (d898903f) foi criada pelo
// app com início 05/10 09:00 — dez horas ANTES do momento da criação — e nada perguntou. Ele
// queria 07/10 09:00. O formulário abre com hoje 09:00 de padrão; quem não mexe na data cria no
// passado sem perceber. Nenhum caminho de criação (app nem TOM) olhava isso: um compromisso que
// começa no passado não vai ser lembrado, não entra no bom dia e vira cobrança "como foi?" de
// algo que ainda não aconteceu.
//
// Regra (gêmea de web/src/lib/eventStartGuard.ts — mudam juntas): início mais de GRACA_MIN
// minutos antes de agora = pergunta antes de criar. A folga existe porque "tô numa reunião que
// começou agora, anota aí" é legítimo e perguntar ali é atrito sem ganho.
//
// No TOM, a pergunta, o intent e as flags (passado + conflito, um "sim" só) moram em
// lib/confirmacao-evento.js; aqui fica só a regra do "já passou" e o rótulo.

const GRACA_MIN = 15;
const FLAG_CONFIRMADO = '_passado_confirmado';
const FUSO = 'America/Sao_Paulo';

function inicioJaPassou(startIso, agoraMs = Date.now(), gracaMin = GRACA_MIN) {
  if (!startIso) return false;
  const t = new Date(startIso).getTime();
  if (!Number.isFinite(t)) return false;
  return t < agoraMs - gracaMin * 60_000;
}

const _fmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
function rotuloInicio(startIso) {
  const parts = Object.fromEntries(_fmt.formatToParts(new Date(startIso)).map((x) => [x.type, x.value]));
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

module.exports = {
  GRACA_MIN,
  FLAG_CONFIRMADO,
  inicioJaPassou,
  rotuloInicio,
};

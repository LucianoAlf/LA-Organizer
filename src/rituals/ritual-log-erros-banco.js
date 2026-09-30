'use strict';
// src/rituals/ritual-log-erros-banco.js — PURO. Acha erro de BANCO repetido em logs/rituals.log
// (saída do dispatcher, que roda por cron). CHECKLISTS-PESSOAIS-PARADOS (30/09/2026): o cron das
// listas pessoais falhou ~1120× com "column ... does not exist" e o laudo não viu, porque
// recurring_errors só lê tom-error.log. O rituals.log não tem timestamp por linha: a hora vem do
// marcador "[Dispatcher] now=YYYY-MM-DD HH:MM" (BRT) que abre cada rodada.

const MARCADOR_RE = /^\[Dispatcher\] now=(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})\b/;
// Só erro de banco/schema — o que não se cura sozinho e costuma ficar mudo por meses.
const ERRO_BANCO_RE = /does not exist|in the schema cache|permission denied for|violates [a-z ]*constraint|invalid input syntax for type/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function horaDoMarcador(linha) {
  const m = MARCADOR_RE.exec(linha);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00-03:00`);
  return Number.isNaN(ms) ? null : ms;
}

// Devolve [[mensagem normalizada, contagem], ...] das últimas `janelaH` horas, maior primeiro.
function contarErrosDeBancoNoRitualLog(linhas, agoraMs = Date.now(), { janelaH = 24, max = 5 } = {}) {
  if (!Array.isArray(linhas)) return [];
  const corte = agoraMs - janelaH * 3600_000;
  let horaRodada = null; // antes do 1º marcador (ou marcador torto) a hora é desconhecida → não conta
  const tally = new Map();
  for (const bruta of linhas) {
    const linha = String(bruta || '');
    if (linha.startsWith('[Dispatcher] now=')) {
      horaRodada = horaDoMarcador(linha);
      continue;
    }
    if (horaRodada === null || horaRodada < corte) continue;
    if (!ERRO_BANCO_RE.test(linha)) continue;
    const msg = linha.trim().replace(UUID_RE, '<uuid>').replace(/\b\d{4,}\b/g, '<n>').slice(0, 200);
    tally.set(msg, (tally.get(msg) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
}

module.exports = { contarErrosDeBancoNoRitualLog, ERRO_BANCO_RE };

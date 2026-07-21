// src/rituals/claude-relogin-reminder.js
// LEMBRETE PROATIVO DE RE-LOGIN — camada PREDITIVA sobre a Sentinela reativa
// (claude-sentinel.js). O token da Max morre ~mensal; se cai de madrugada o TOM
// roda horas no Codex. Aqui a gente cutuca o dono pra re-logar ANTES (em horário
// comercial), a cada ~25d. Estado = 2 marker files no box (sem banco/migration).
// Funções puras (decide/message) testadas isoladas.
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  ownerPhone: '5521981278047',            // Alf — override por TOM_OWNER_ALERT_PHONE
  thresholdDays: 25,                       // override por TOM_RELOGIN_REMIND_DAYS
  startHour: 9,                            // 9h BRT inclusivo
  endHour: 18,                             // 18h BRT EXCLUSIVO
  tz: 'America/Sao_Paulo',
  stampDir: '/opt/LA-Organizer/.claude-tom',
};

const RELOGIN_HINT = [
  'Renova agora — do teu terminal:',
  'ssh -t tom "bash /opt/LA-Organizer/scripts/tom-relogin.sh"',
  '(se já estiver dentro do box: bash /opt/LA-Organizer/scripts/tom-relogin.sh)',
].join('\n');

// hora (0-23) e data 'YYYY-MM-DD' no fuso — determinístico dado ms.
function _brtParts(ms, tz = DEFAULTS.tz) {
  const d = new Date(ms);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return { hour, date };
}

// ─── DECISÃO (pura) ──────────────────────────────────────────────────────────
function decideReloginReminder({
  lastReloginMs, lastReminderMs, nowMs,
  thresholdDays = DEFAULTS.thresholdDays,
  startHour = DEFAULTS.startHour, endHour = DEFAULTS.endHour, tz = DEFAULTS.tz,
} = {}) {
  if (lastReloginMs == null || !Number.isFinite(lastReloginMs)) {
    return { remind: false, daysSince: null, reason: 'no-stamp' };
  }
  const ageDays = (nowMs - lastReloginMs) / 86400000;
  const daysSince = Math.floor(ageDays);
  if (ageDays < thresholdDays) return { remind: false, daysSince, reason: 'fresh' };

  const nowParts = _brtParts(nowMs, tz);
  if (nowParts.hour < startHour || nowParts.hour >= endHour) {
    return { remind: false, daysSince, reason: 'off-hours' };
  }
  if (lastReminderMs != null && Number.isFinite(lastReminderMs)) {
    if (_brtParts(lastReminderMs, tz).date === nowParts.date) {
      return { remind: false, daysSince, reason: 'already-today' };
    }
  }
  return { remind: true, daysSince, reason: 'due' };
}

// ─── MENSAGEM (pura) ─────────────────────────────────────────────────────────
function buildReminderMessage({ daysSince } = {}) {
  return [
    '🔑 *TOM — renova o login do Claude (2 min)*',
    `Faz ${daysSince} dias do último re-login. O token da Max vive ~30 dias e, se passar, morre de madrugada e o TOM cai no Codex (degradado) até alguém re-logar.`,
    '',
    RELOGIN_HINT,
  ].join('\n');
}

// ─── ORQUESTRADOR (I/O) ──────────────────────────────────────────────────────
// Lê os markers, decide, e se cutuca manda no WhatsApp do dono + carimba o
// reminder (dedup 1x/dia). NUNCA propaga erro (o tick do dispatcher não pode
// quebrar por causa daqui).
function _readStamp(file) {
  try {
    const ms = Date.parse(String(fs.readFileSync(file, 'utf8')).trim());
    return Number.isFinite(ms) ? ms : null;
  } catch (_) { return null; }
}

async function runReloginReminder({ sendMessage, now = new Date(), env = process.env, stampDir = DEFAULTS.stampDir } = {}) {
  const enabled = String(env.TOM_RELOGIN_REMINDER_ENABLED ?? '1') !== '0';
  if (!enabled) return { skipped: 'disabled' };

  const ownerPhone = env.TOM_OWNER_ALERT_PHONE || DEFAULTS.ownerPhone;
  const thresholdDays = Number(env.TOM_RELOGIN_REMIND_DAYS) || DEFAULTS.thresholdDays;
  const nowMs = now.getTime();
  const reloginFile = path.join(stampDir, '.last-relogin');
  const reminderFile = path.join(stampDir, '.last-relogin-reminder');

  const lastReloginMs = _readStamp(reloginFile);
  const lastReminderMs = _readStamp(reminderFile);
  const decision = decideReloginReminder({ lastReloginMs, lastReminderMs, nowMs, thresholdDays });

  if (decision.remind) {
    try {
      await sendMessage(ownerPhone, buildReminderMessage({ daysSince: decision.daysSince }));
      fs.writeFileSync(reminderFile, now.toISOString());
    } catch (e) {
      console.error('[ReloginReminder] envio/carimbo falhou:', e.message);
    }
  }
  const age = lastReloginMs ? Math.floor((nowMs - lastReloginMs) / 86400000) + 'd' : 'sem-carimbo';
  console.log(`[ReloginReminder] relogin=${age} → ${decision.reason}${decision.remind ? ' (nag)' : ''}`);
  return { decision };
}

module.exports = { runReloginReminder, decideReloginReminder, buildReminderMessage, _brtParts, DEFAULTS };

'use strict';
// reminder-notice.js — Fatia 6 (#1 confirmação: surface determinístico da hora do lembrete).
//
// A tarefa nasce com remind_at CERTO (medido: "me lembra 07h" → remind_at=07h BRT) e o lembrete
// dispara — mas a confirmação do TOM às vezes omite a hora ("Anotado — até 12/08"), e a pessoa
// acha que a hora sumiu. Este helper devolve "🔔 Lembro às HHh" pra ANEXAR à resposta QUANDO ela
// não cita a hora (dedup contra a fala do LLM, pra não repetir). Puro (sem I/O).

function _brtHM(iso) {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const hh = parts.find((p) => p.type === 'hour');
    const mm = parts.find((p) => p.type === 'minute');
    if (!hh || !mm) return null;
    // '24' (meia-noite em alguns ICUs) → 0.
    const h = Number(hh.value) % 24;
    const m = Number(mm.value);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return { h, m };
  } catch (_) { return null; }
}

function _label({ h, m }) {
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

// A fala já cita ESTA hora? (dígito adjacente a h/: OU após "às"). Conservador: na dúvida NÃO
// considera citada (prefere anexar a esconder a hora).
function _falaCitaHora(reply, h) {
  const s = String(reply || '');
  const hh = String(h);
  const re = new RegExp(`(?<!\\d)0?${hh}\\s*(?:h|:)|\\b[àa]s?\\s+0?${hh}\\b`, 'i');
  return re.test(s);
}

function buildReminderNotice(remindIsos, replyText) {
  const list = (Array.isArray(remindIsos) ? remindIsos : [remindIsos]).filter((x) => typeof x === 'string' && x.trim());
  if (!list.length) return null;
  const hms = list.map(_brtHM).filter(Boolean);
  if (!hms.length) return null;
  // Mais cedo primeiro (por minuto absoluto do dia).
  hms.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));
  const alvo = hms[0];
  if (_falaCitaHora(replyText, alvo.h)) return null;
  return `🔔 Lembro às ${_label(alvo)}.`;
}

module.exports = { buildReminderNotice };

// src/services/cobranca.js
// Cobrança MANUAL disparada do Dashboard de time (botão "Cobrar agora"): o líder/CEO
// pede pro TOM dar um toque no responsável de uma tarefa atrasada, na hora. Aqui mora só
// a MENSAGEM (função pura, testável); o envio fica no endpoint /internal/task-cobrar.
'use strict';

// 'YYYY-MM-DD' → 'DD/MM'.
function ddmm(ymd) {
  if (!ymd) return '';
  const [, m, d] = String(ymd).split('-');
  return d && m ? `${d}/${m}` : '';
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Dias de atraso (>0) de due relativo a today, ambos 'YYYY-MM-DD'. Hoje/futuro/sem prazo → null.
function daysOverdue(dueYmd, todayYmd) {
  if (!dueYmd || !todayYmd) return null;
  const [y1, m1, d1] = String(todayYmd).split('-').map(Number);
  const [y2, m2, d2] = String(dueYmd).split('-').map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => Number.isNaN(n))) return null;
  const diff = Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
  return diff > 0 ? diff : null;
}

// Monta a mensagem de cobrança pro responsável. requesterName = líder que cobrou (opcional;
// dá peso à cobrança). Mantém a voz do TOM, tom leve, sem culpar — pede retorno.
function buildCobrancaMessage({ assigneeName, taskTitle, dueYmd, todayYmd, requesterName } = {}) {
  const nome = firstName(assigneeName);
  const saud = nome ? `Oi, ${nome}!` : 'Oi!';
  const od = daysOverdue(dueYmd, todayYmd);
  let prazo = '';
  if (dueYmd) {
    prazo = od ? `📅 venceu ${ddmm(dueYmd)} (${od} dia${od > 1 ? 's' : ''} atrás)` : `📅 prazo ${ddmm(dueYmd)}`;
  }
  const quem = firstName(requesterName);
  const porQuem = quem ? ` O ${quem} pediu um retorno.` : '';

  const lines = [`👋 ${saud} Passando pra cobrar uma tarefa:`, ''];
  lines.push(`*${String(taskTitle || '').trim()}*`);
  if (prazo) lines.push(prazo);
  lines.push('');
  lines.push(`Consegue tocar${od ? ' hoje' : ''}?${porQuem} Se já resolveu ou travou em algo, me dá um retorno aqui. 🙏`);
  return lines.join('\n');
}

module.exports = { buildCobrancaMessage, ddmm, firstName, daysOverdue };

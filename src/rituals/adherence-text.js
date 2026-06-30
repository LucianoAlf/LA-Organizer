'use strict';
// Builder PURO do texto do "balanço de aderência" (dispatcher 19h). Extraído pra ser
// testável sem o supabase client (dispatcher.js requer ../supabase/client, só na VPS),
// espelhando o padrão de adherence-projects.js (classificador puro).
const { ymdDaysBetween } = require('../utils/adherence-projects');

const ADHERENCE_MIN_OVERDUE = 2;
const ADHERENCE_MAX_OVERDUE_LIST = 5;
const ADHERENCE_MAX_PROJECTS_LIST = 5;

function buildAdherenceText(collab, signals, ymdToday) {
  const { overdueTasks, pausedProjects } = signals;
  const readyProjects = signals.readyProjects || [];
  const hasSignal = overdueTasks.length >= ADHERENCE_MIN_OVERDUE || pausedProjects.length >= 1 || readyProjects.length >= 1;
  if (!hasSignal) return null;

  const nick = collab.full_name === 'Luciano Alf' ? 'Alf' : (collab.full_name || '').split(' ')[0] || 'amigo';
  const lines = [`${nick}, balanço de aderência... 🌒`, ''];

  if (overdueTasks.length) {
    lines.push('⏰ *Atrasadas:*');
    for (const t of overdueTasks.slice(0, ADHERENCE_MAX_OVERDUE_LIST)) {
      const days = ymdDaysBetween(ymdToday, t.due_date);
      const lateLabel = days === 0 ? 'vencia hoje'
        : days === 1 ? 'vencia ontem'
        : `vencia há ${days}d`;
      lines.push(`• *${t.title}* (${lateLabel})`);
    }
    if (overdueTasks.length > ADHERENCE_MAX_OVERDUE_LIST) {
      lines.push(`_...e mais ${overdueTasks.length - ADHERENCE_MAX_OVERDUE_LIST}_`);
    }
    lines.push('');
  }

  if (pausedProjects.length) {
    lines.push('📁 *Projetos parados:*');
    for (const p of pausedProjects.slice(0, ADHERENCE_MAX_PROJECTS_LIST)) {
      lines.push(`• *${p.name}* — sem mexer há ${p.days_since}d`);
    }
    lines.push('');
  }

  if (readyProjects.length) {
    // KRISSYA-PROJECT-CLOSE-NO-HANDLER (auditoria 30/06): NÃO oferecer "Fecho? 🚀" —
    // não existe handler de fechar projeto pelo zap (só PROJECT_CREATE/APPROVE/REJECT).
    // O TOM oferecia e o usuário respondia "Fecha o X" → pedido largado (cheque sem fundo).
    // Interim: só INFORMA o status; o fechar-projeto-por-chat é capacidade nova (brainstorm).
    lines.push('✅ *Tarefas feitas nesses projetos:*');
    for (const p of readyProjects.slice(0, ADHERENCE_MAX_PROJECTS_LIST)) {
      lines.push(`• *${p.name}* — suas tarefas já tão concluídas 🎉`);
    }
    lines.push('');
  }

  // "Reagenda? Cancela?" só faz sentido com atrasada/parado. Se SÓ há projeto pronto pra
  // fechar, não há ação que o TOM execute aqui — fecha leve.
  if (overdueTasks.length || pausedProjects.length) {
    lines.push('Reagenda? Cancela? Me diz o que rolou.');
  } else {
    lines.push('Me diz aí! 👽');
  }
  return lines.join('\n');
}

module.exports = { buildAdherenceText, ADHERENCE_MIN_OVERDUE, ADHERENCE_MAX_OVERDUE_LIST, ADHERENCE_MAX_PROJECTS_LIST };

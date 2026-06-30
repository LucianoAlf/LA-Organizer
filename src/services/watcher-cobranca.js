'use strict';
// Mensagem de cobrança pra quem está EM CÓPIA de uma tarefa. O observador
// acompanha e cobra o executor — NUNCA é instruído a executar. Função pura.

function buildWatcherReminderText(executorFirstName, title, kind) {
  const who = executorFirstName || 'a pessoa';
  switch (kind) {
    case 'overdue1':
      return `👀 Você está em cópia: *${title}* (de ${who}) atrasou 1 dia. Dá um toque em ${who}?`;
    case 'overdueN':
      return `👀 Em cópia: *${title}* (de ${who}) está parada há alguns dias. Vale cobrar ${who}.`;
    case 'overdueOld':
      return `👀 Em cópia: *${title}* (de ${who}) está há vários dias sem mexer. Bom puxar ${who}.`;
    case 'deadline':
    default:
      return `👀 Você está em cópia: *${title}* (de ${who}) vence amanhã. Fica de olho e, se puder, lembra ${who}.`;
  }
}

module.exports = { buildWatcherReminderText };

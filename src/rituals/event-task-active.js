'use strict';
// Predicado puro: a tarefa de preparo (school_event_id) ainda deve ser lembrada/cobrada?
//
// Bug Alf 24/06: "Show de Encerramento do Semestre" cancelado seguia cobrando as 7 tarefas
// de preparo (ensaio/repertório/divulgar...). remindEventTasks (dispatcher) puxava por
// school_event_id + status pending SEM olhar o status do evento-pai → cobrança fantasma.
//
// Regra: só o evento CANCELADO exclui. Evento ausente (deletado → FK SET NULL, ou null no
// join) também exclui, defensivo. Qualquer outro status (active/completed/etc.) → lembra.
function isEventTaskActive(task) {
  const ev = task && task.event;
  if (!ev) return false;
  return ev.status !== 'cancelled';
}

module.exports = { isEventTaskActive };

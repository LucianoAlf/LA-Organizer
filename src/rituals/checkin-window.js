'use strict';
// checkin-window.js — janela do check-in de tarefas ("⏰ Check das Xh — Ainda pendente").
//
// Audit 08/07 (Matheus A): checkTaskCheckins listava tudo que vencia em ATÉ 7 DIAS
// (due_date <= next7) → cobrava tarefa reagendada pro FUTURO. Prova: task_checkin_17:00
// (07/07 20:01) cobrou a tarefa do Matheus já em 13/07 ("já remarquei pra segunda,
// você mesmo remarcou"). O check só deve cobrar o que VENCE HOJE ou está ATRASADO.
//
// ⚠️ MUDA COMPORTAMENTO de um ritual que afeta TODOS → Alf valida no gate de deploy.
//
// due_date é DATE ('YYYY-MM-DD') → comparação lexicográfica == cronológica. Tarefa sem
// prazo (due_date null) NÃO entra (não se cobra no check o que ninguém datou).
function isDueForCheckin(dueDate, todayYmd) {
  if (!dueDate || typeof dueDate !== 'string') return false;
  return dueDate <= String(todayYmd);
}

module.exports = { isDueForCheckin };

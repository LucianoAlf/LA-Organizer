'use strict';
// rearma-lembrete.js — REMARCOU-E-NAO-TOCOU (30/09). PURO.
//
// O checkReminders só dispara tarefa com `reminded_at IS NULL`. O reschedule por marker
// ("muda pra 20h") gravava o remind_at novo e deixava o `reminded_at` do lembrete que JÁ tinha
// disparado: o horário novo nunca tocava. Os ramos de deslocamento (prazo mudou → remind_at
// desloca junto) faziam o contrário: zeravam SEMPRE, e um horário deslocado que caía no passado
// era reenviado na varredura seguinte — lembrete velho.
// Regra única: re-arma (reminded_at = null) só quando o horário novo é FUTURO; passado não mexe.
function rearmaAoRemarcar(novoRemindAt, now = new Date()) {
  const t = Date.parse(novoRemindAt);
  if (!Number.isFinite(t)) return {};
  return t > now.getTime() ? { reminded_at: null } : {};
}

// Cooldown de 6h do checkReminders ("não dispara 2x na mesma janela", Carol 23/05): aviso
// enviado ANTES do horário atual é do agendamento anterior e não pode segurar o remarcado
// ("me lembra de novo às 14h" depois do das 12h). Piso = o mais tarde entre o corte de 6h e
// (remind_at − 1 min). Tarefa reaberta por bug sem remind_at novo segue travada (o aviso dela
// é posterior ao remind_at).
function pisoDoCooldown(cooldownCutoffIso, remindAtIso) {
  const c = Date.parse(cooldownCutoffIso);
  const r = Date.parse(remindAtIso);
  if (!Number.isFinite(r)) return cooldownCutoffIso;
  if (!Number.isFinite(c)) return new Date(r - 60000).toISOString();
  return new Date(Math.max(c, r - 60000)).toISOString();
}

module.exports = { rearmaAoRemarcar, pisoDoCooldown };

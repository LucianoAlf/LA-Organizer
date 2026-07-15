-- 2026-07-15 — habilita staged reschedule (i). Trap A: kind no CHECK ANTES do código.
-- Verificado contra o banco vivo (catraca): a lista atual é superset-safe — só ACRESCENTA
-- 'reschedule_confirm', não estreita nenhum kind existente.
alter table pending_intents drop constraint pending_intents_kind_check;
alter table pending_intents add constraint pending_intents_kind_check
  check (kind = any (array[
    'task_creation','event_creation','approval_pending','confirmation',
    'finance_source','invoice_import','reschedule_confirm'
  ]));

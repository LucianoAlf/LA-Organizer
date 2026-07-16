-- 2026-07-16 — EVENT-CREATE-CONFIRM-NOOP: staging determinístico da criação de compromisso.
-- Adiciona o kind event_create_confirm (proposta guarda a ação; o "isso" cria via resume).
--
-- ⚠️ TRAP A TEM DUAS PORTAS: este CHECK **não basta**. O kind também precisa estar em
-- VALID_KINDS (src/services/pending-intents.js:19) — openIntent LANÇA `invalid kind` se faltar.
-- Em 15/07 o reschedule_confirm entrou só aqui e o staging ficou 24h armado pra virar NOOP.
-- Ver known-issue PENDINGINTENT-KIND-WHITELIST-TRAP. APLICADA via MCP em 16/07.
alter table pending_intents drop constraint pending_intents_kind_check;
alter table pending_intents add constraint pending_intents_kind_check
  check (kind = any (array[
    'task_creation','event_creation','approval_pending','confirmation',
    'finance_source','invoice_import','reschedule_confirm','event_create_confirm'
  ]));

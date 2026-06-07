-- Fatia G (RITUAL-NO-RETRY): claim atômico idempotente para os rituais da família
-- briefing (briefing/fechamento/planejamento), espelhando notifications_alert_daily_uq.
--
-- PROBLEMA: fireRitual (dispatcher) usava check-then-act — enviava PRIMEIRO e gravava
-- o anchor 'sent' DEPOIS. Em erro transitório sustentado por mais de um slot de 15min,
-- o ritual do dia era PERDIDO sem retry. Não havia unique em ritual_logs (engine.js
-- dizia "UNIQUE constraint dropped" para permitir linhas de observabilidade por evento).
--
-- FIX: índice único PARCIAL que garante 1 linha 'sent' por (collaborator_id,
-- ritual_type, reference_date) — porém SÓ para os 4 tipos da família briefing, que são
-- legitimamente 1x/dia/tipo. O dispatcher passa a fazer claim-antes-de-enviar contra
-- esse índice (e rollback no erro transitório). engine.sendRitual ganha opts.skipLog
-- para não regravar 'sent' nesse caminho.
--
-- ESCOPO PROPOSITAL (NÃO ampliar): alertas por-tarefa/evento (alerta_prazo,
-- alerta_atraso, checkpoint_deadline, event_overdue, auto_archive_stale), daily_dream e
-- relatórios CEO gravam VÁRIAS linhas 'sent'/dia legitimamente (chave de tipo fixa,
-- 1 por tarefa/evento) — ficam de FORA do índice. O claim atômico DELES já vive em
-- `notifications` (notifications_alert_daily_uq); a linha em ritual_logs é só observabilidade.

-- 1) Dedup: mantém a linha 'sent' MAIS ANTIGA por (collab, tipo, dia), só para os 4
--    tipos no escopo do índice — senão o CREATE UNIQUE INDEX falharia em duplicatas legadas.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY collaborator_id, ritual_type, reference_date
           ORDER BY created_at
         ) AS rn
  FROM ritual_logs
  WHERE status = 'sent'
    AND ritual_type IN ('daily_briefing', 'personal_briefing', 'daily_closing', 'weekly_planning')
)
DELETE FROM ritual_logs r
USING ranked k
WHERE r.id = k.id AND k.rn > 1;

-- 2) Garantia estrutural: no máximo 1 'sent' por (colaborador, tipo, dia) na família briefing.
CREATE UNIQUE INDEX IF NOT EXISTS ritual_logs_sent_daily_uq
  ON ritual_logs (collaborator_id, ritual_type, reference_date)
  WHERE status = 'sent'
    AND ritual_type IN ('daily_briefing', 'personal_briefing', 'daily_closing', 'weekly_planning');

-- Fatia G fase 2 (parte 1): estende o claim atômico idempotente aos rituais
-- financeiros pessoais — lembrete_conta (diário 8h), financeiro_mensal (dia 10) e
-- relatorio_financeiro_mensal (dia 1). Todos gravam 1 linha 'sent' por
-- (colaborador, tipo, dia) — mesma cardinalidade da família briefing, logo claim-safe.
--
-- Motivo: essas funções usavam check-then-act (alreadySent + logRitualEvent('sent')
-- DEPOIS do envio). Em erro transitório o ritual do dia era perdido sem retry — e como
-- financeiro_mensal/relatorio rodam 1x/mês, a perda era do MÊS INTEIRO.
--
-- FIX: o dispatcher passa a fazer claim-antes-de-enviar (claimRitualSend) contra este
-- índice parcial, com rollback no erro transitório. Recria o índice com a lista ampliada.
-- NÃO inclui card_due/card_limit (gravam N 'sent'/dia, 1 por cartão → precisam de claim
-- por-referência, fora deste escopo).

-- 1) Dedup defensivo dos 3 tipos novos antes de entrar no índice único.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY collaborator_id, ritual_type, reference_date ORDER BY created_at
  ) AS rn
  FROM ritual_logs
  WHERE status = 'sent'
    AND ritual_type IN ('lembrete_conta','financeiro_mensal','relatorio_financeiro_mensal')
)
DELETE FROM ritual_logs r USING ranked k WHERE r.id = k.id AND k.rn > 1;

-- 2) Recria o índice parcial com a família briefing + os 3 financeiros.
DROP INDEX IF EXISTS ritual_logs_sent_daily_uq;
CREATE UNIQUE INDEX ritual_logs_sent_daily_uq
  ON ritual_logs (collaborator_id, ritual_type, reference_date)
  WHERE status = 'sent'
    AND ritual_type IN (
      'daily_briefing','personal_briefing','daily_closing','weekly_planning',
      'lembrete_conta','financeiro_mensal','relatorio_financeiro_mensal'
    );

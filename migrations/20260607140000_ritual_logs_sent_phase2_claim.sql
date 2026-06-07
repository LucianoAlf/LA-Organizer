-- Fatia G fase 2 (final): estende ritual_logs_sent_daily_uq aos rituais claim-safe
-- restantes — mensais (+intro), relatórios CEO/líderes e os 2 LA EDUCA por-mentor.
-- Todos gravam 1 'sent' por (colaborador, tipo, período). N/dia (cartões; pendente/
-- atrasado/pronto/escalation LA EDUCA) NÃO entram (claim por-referência em
-- notifications/la_educa_lembretes_log). Aplicada via MCP em 2026-06-07.
--
-- Dual-type mensal: o ramo show_intro claima sob *_intro p/ não colidir com a máquina
-- de estado do getRitualIntroDecision (que lê o tipo base e decide por status='sent').

-- 1) Dedup defensivo dos tipos novos antes de entrar no índice único
--    (dados 07/06: ceo_team_unclosed_events 1 dup, ceo_team_unclosed_tasks 2 dups).
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY collaborator_id, ritual_type, reference_date ORDER BY created_at
  ) AS rn
  FROM ritual_logs
  WHERE status = 'sent'
    AND ritual_type IN (
      'monthly_planning','monthly_planning_intro','monthly_closing','monthly_closing_intro',
      'ceo_team_unclosed_events','ceo_team_unclosed_tasks','leader_unclosed_tasks',
      'leader_engagement_weekly','la_educa_resumo_mentor','la_educa_briefing_sexta'
    )
)
DELETE FROM ritual_logs r USING ranked k WHERE r.id = k.id AND k.rn > 1;

-- 2) Recria o índice parcial com os 7 tipos da fase 1 + os 10 novos (17 no total).
DROP INDEX IF EXISTS ritual_logs_sent_daily_uq;
CREATE UNIQUE INDEX ritual_logs_sent_daily_uq
  ON ritual_logs (collaborator_id, ritual_type, reference_date)
  WHERE status = 'sent'
    AND ritual_type IN (
      'daily_briefing','personal_briefing','daily_closing','weekly_planning',
      'lembrete_conta','financeiro_mensal','relatorio_financeiro_mensal',
      'monthly_planning','monthly_planning_intro','monthly_closing','monthly_closing_intro',
      'ceo_team_unclosed_events','ceo_team_unclosed_tasks','leader_unclosed_tasks',
      'leader_engagement_weekly','la_educa_resumo_mentor','la_educa_briefing_sexta'
    );

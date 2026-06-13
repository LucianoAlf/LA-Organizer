-- FIN-CARTAO-CASHFLOW-VENCIMENTO (Rose 13/06)
-- Regime de caixa: o gasto do cartão conta no mês em que a fatura VENCE/é paga (competência + 1 mês),
-- NÃO no mês de fechamento (competência). Substitui a 1ª versão (cashflow = competência) — a Rose
-- pediu "por data de vencimento (regime de caixa)" e foi implementado por competência por engano.
-- Mantém o NOME da coluna (cashflow_competencia) pra não tocar nos 6 consumidores (PWA listTransactions/
-- listTransactionMonths + backend monthCategoryTotal/querySummary/monthlyReport/monthCategoryBreakdown).
-- competencia só é não-nula em cartão → caixa cai no mês do transaction_date; cartão na fatura+1.
-- (competencia + interval '1 month')::date é IMMUTABLE (date+interval = timestamp sem tz). Já aplicada
-- via Supabase MCP em 2026-06-13; este arquivo é o registro no repo.
DROP INDEX IF EXISTS idx_pf_tx_cashflow_comp;
ALTER TABLE pf_transactions DROP COLUMN IF EXISTS cashflow_competencia;
ALTER TABLE pf_transactions
  ADD COLUMN cashflow_competencia date
  GENERATED ALWAYS AS (
    COALESCE(
      (competencia + interval '1 month')::date,
      make_date(EXTRACT(YEAR FROM transaction_date)::int, EXTRACT(MONTH FROM transaction_date)::int, 1)
    )
  ) STORED;
CREATE INDEX idx_pf_tx_cashflow_comp ON pf_transactions (collaborator_id, cashflow_competencia);

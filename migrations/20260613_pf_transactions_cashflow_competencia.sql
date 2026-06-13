-- FIN-CARTAO-CASHFLOW-COMPETENCIA (Rose 13/06)
-- Mês de fluxo de caixa: cartão conta pela COMPETÊNCIA (fatura); caixa pelo mês do transaction_date.
-- competencia só é preenchida em transações de cartão (caixa = NULL), então o COALESCE basta.
-- make_date é IMMUTABLE (date_trunc resolve p/ a versão timestamptz, que é STABLE → quebra generated column).
-- Já aplicada via Supabase MCP em 2026-06-13; este arquivo é só o registro no repo.
ALTER TABLE pf_transactions
  ADD COLUMN IF NOT EXISTS cashflow_competencia date
  GENERATED ALWAYS AS (
    COALESCE(
      competencia,
      make_date(EXTRACT(YEAR FROM transaction_date)::int, EXTRACT(MONTH FROM transaction_date)::int, 1)
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_pf_tx_cashflow_comp
  ON pf_transactions (collaborator_id, cashflow_competencia);

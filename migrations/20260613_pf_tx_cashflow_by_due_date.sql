-- FIN-CARTAO-CASHFLOW-DUEDATE
-- Corrige o regime de caixa do cartão: a despesa cai no mês do VENCIMENTO REAL da fatura,
-- que depende do cartão (não é sempre competência+1).
--
-- REGRA: a fatura fecha no dia `closing_day` do mês da competência e vence no dia `due_day`.
--   - due_day >= closing_day  -> vence no MESMO mês da competência (fecha dia 4, vence dia 10)  -> offset 0
--   - due_day <  closing_day  -> vence no mês SEGUINTE (fecha dia 30, vence dia 6)               -> offset 1
-- vencimento_competencia = competencia + offset meses.
--
-- Por que trigger (e não coluna gerada): a regra precisa de closing_day/due_day de pf_cards,
-- e uma GENERATED column só enxerga colunas da própria linha. O fix anterior
-- (FIN-CARTAO-CASHFLOW-VENCIMENTO, 13/06) cravou competencia+1 pra TODOS -> errado p/ 5 dos 6
-- cartões da Rose (vencem no mesmo mês). Caso Rose 13/06: "fatura de julho deveria vencer em julho".
--
-- O NOME da coluna (cashflow_competencia) é mantido para não tocar os 6 consumidores
-- (PWA listTransactions/listTransactionMonths + backend monthCategoryTotal/querySummary/
--  monthlyReport/monthCategoryBreakdown).

-- 1) Solta o índice e a coluna gerada
DROP INDEX IF EXISTS idx_pf_tx_cashflow_comp;
ALTER TABLE pf_transactions DROP COLUMN IF EXISTS cashflow_competencia;

-- 2) Recria como coluna normal (preenchida por trigger)
ALTER TABLE pf_transactions ADD COLUMN cashflow_competencia date;

-- 3) Função pura de cálculo do mês de fluxo de caixa
CREATE OR REPLACE FUNCTION pf_tx_compute_cashflow(
  p_card_id uuid, p_competencia date, p_transaction_date date
) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_close int; v_due int; v_offset int;
BEGIN
  -- Caixa (sem cartão) ou cartão sem competência: cai no mês do transaction_date.
  IF p_card_id IS NULL OR p_competencia IS NULL THEN
    RETURN make_date(EXTRACT(YEAR FROM p_transaction_date)::int,
                     EXTRACT(MONTH FROM p_transaction_date)::int, 1);
  END IF;
  SELECT closing_day, due_day INTO v_close, v_due FROM pf_cards WHERE id = p_card_id;
  IF v_close IS NULL OR v_due IS NULL THEN
    RETURN p_competencia; -- cartão não encontrado: fallback conservador
  END IF;
  v_offset := CASE WHEN v_due >= v_close THEN 0 ELSE 1 END;
  RETURN (p_competencia + (v_offset * interval '1 month'))::date;
END;
$$;

-- 4) Trigger BEFORE INSERT/UPDATE: recalcula quando muda competência, data ou cartão
CREATE OR REPLACE FUNCTION pf_tx_set_cashflow() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.cashflow_competencia := pf_tx_compute_cashflow(NEW.card_id, NEW.competencia, NEW.transaction_date);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pf_tx_set_cashflow ON pf_transactions;
CREATE TRIGGER trg_pf_tx_set_cashflow
  BEFORE INSERT OR UPDATE OF competencia, transaction_date, card_id
  ON pf_transactions FOR EACH ROW EXECUTE FUNCTION pf_tx_set_cashflow();

-- 5) Backfill: recalcula todas as linhas existentes (não dispara o trigger pois não muda as colunas OF)
UPDATE pf_transactions
  SET cashflow_competencia = pf_tx_compute_cashflow(card_id, competencia, transaction_date);

-- 6) Recria o índice
CREATE INDEX idx_pf_tx_cashflow_comp ON pf_transactions (collaborator_id, cashflow_competencia);

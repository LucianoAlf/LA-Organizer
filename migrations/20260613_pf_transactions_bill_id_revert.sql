-- FIN-BILL-DELETE-REVERT (Rose 13/06)
-- Vínculo transação→conta + reverter o status da conta ao DELETAR a transação que a pagou.
-- Antes: pf_transactions sem bill_id; deletar o lançamento de pagamento não mexia em
-- pf_bills.last_paid_at → deriveBillStatus seguia "paga" (status é dado morto; fonte de
-- verdade = last_paid_at). Caso Rose: "Condomínio Firenze" e "Terapia" ficaram PAGA sem
-- nenhuma transação correspondente (ela deletou o lançamento e a conta não reverteu).
-- Já aplicada via Supabase MCP em 2026-06-13; este arquivo é o registro no repo.

-- 1) Coluna de vínculo (paga-qual-conta). ON DELETE SET NULL: se a CONTA some, o lançamento
--    de gasto sobrevive sem vínculo (não apaga histórico financeiro).
ALTER TABLE pf_transactions
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES pf_bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pf_tx_bill
  ON pf_transactions (bill_id) WHERE bill_id IS NOT NULL;

-- 2) AFTER DELETE: recalcula o pagamento da conta a partir das transações vinculadas que
--    sobraram. last_paid_at = transaction_date da mais recente (proxy da quitação — não
--    guardamos paidAt na transação), ou NULL se não sobrou nenhuma → conta volta a pendente.
--    Guarda collaborator_id: o trigger nunca toca a conta de outro usuário.
--    SECURITY DEFINER pra rodar igual no caminho RLS (PWA/JWT) e service_role (TOM).
CREATE OR REPLACE FUNCTION pf_bill_revert_on_tx_delete() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  last_paid date;
BEGIN
  IF OLD.bill_id IS NULL THEN
    RETURN OLD;
  END IF;
  SELECT max(transaction_date) INTO last_paid
    FROM pf_transactions
    WHERE bill_id = OLD.bill_id AND collaborator_id = OLD.collaborator_id;
  UPDATE pf_bills
    SET last_paid_at = last_paid,
        status = CASE WHEN last_paid IS NULL THEN 'pending' ELSE 'paid' END
    WHERE id = OLD.bill_id AND collaborator_id = OLD.collaborator_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pf_bill_revert_on_tx_delete ON pf_transactions;
CREATE TRIGGER trg_pf_bill_revert_on_tx_delete
  AFTER DELETE ON pf_transactions
  FOR EACH ROW EXECUTE FUNCTION pf_bill_revert_on_tx_delete();

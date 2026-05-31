-- Conta Única (vencimento em data cheia) vs Recorrente (todo mês no due_day).
ALTER TABLE pf_bills
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS due_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pf_bills_recurrence_chk'
  ) THEN
    ALTER TABLE pf_bills
      ADD CONSTRAINT pf_bills_recurrence_chk CHECK (recurrence IN ('monthly','once'));
  END IF;
END $$;

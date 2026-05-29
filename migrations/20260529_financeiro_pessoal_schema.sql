-- Migration: Finanças Pessoais (Sprint 27, Fase A)
-- Projeto: cesnbnrynvxvgdhfmaua (LA Organizer)
-- 5 tabelas pf_* + RLS owner-only + indexes + 2 triggers (dono + saldo)

-- pf_accounts
CREATE TABLE pf_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'checking'
    CHECK (type IN ('checking','savings','wallet','investment')),
  balance numeric(12,2) NOT NULL DEFAULT 0,
  goal_monthly numeric(12,2),
  icon text DEFAULT '🏦',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- pf_transactions
CREATE TABLE pf_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  account_id uuid REFERENCES pf_accounts(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income','expense')),
  category text NOT NULL CHECK (category IN (
    'salario','comissao','extra',
    'moradia','alimentacao','transporte',
    'saude','educacao','lazer','outros'
  )),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  description text,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  via text DEFAULT 'tom',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pf_transactions_collab_date
  ON pf_transactions(collaborator_id, transaction_date DESC);
-- cast ::timestamp torna date_trunc IMMUTABLE (exigido em indice; date_trunc(text,date) e STABLE)
CREATE INDEX idx_pf_transactions_collab_month
  ON pf_transactions(collaborator_id, (date_trunc('month', transaction_date::timestamp)));

-- pf_bills
CREATE TABLE pf_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(12,2) NOT NULL,
  due_day int NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  category text NOT NULL,
  type text NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue')),
  remind_days_before int NOT NULL DEFAULT 2,
  last_paid_at date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- pf_goals
CREATE TABLE pf_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(12,2) NOT NULL,
  current_amount numeric(12,2) NOT NULL DEFAULT 0,
  monthly_contribution numeric(12,2),
  deadline date,
  icon text DEFAULT '🎯',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- pf_budgets
CREATE TABLE pf_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  category text NOT NULL,
  monthly_limit numeric(12,2) NOT NULL,
  month_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collaborator_id, category, month_year)
);

-- RLS owner-only (caminho PWA/JWT)
ALTER TABLE pf_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY pf_accounts_owner ON pf_accounts FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_transactions_owner ON pf_transactions FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_bills_owner ON pf_bills FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_goals_owner ON pf_goals FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_budgets_owner ON pf_budgets FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());

-- Trigger 1: checagem de dono (BEFORE) — rejeita account_id de outro colaborador (spec §6.1, opção a)
CREATE OR REPLACE FUNCTION pf_check_account_owner() RETURNS trigger AS $$
DECLARE acct_owner uuid;
BEGIN
  IF NEW.account_id IS NOT NULL THEN
    SELECT collaborator_id INTO acct_owner FROM pf_accounts WHERE id = NEW.account_id;
    IF acct_owner IS NULL THEN
      RAISE EXCEPTION 'pf_transactions.account_id % nao existe', NEW.account_id;
    END IF;
    IF acct_owner <> NEW.collaborator_id THEN
      RAISE EXCEPTION 'pf_transactions.account_id % pertence a outro colaborador', NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pf_check_account_owner
  BEFORE INSERT OR UPDATE ON pf_transactions
  FOR EACH ROW EXECUTE FUNCTION pf_check_account_owner();

-- Trigger 2: sync de saldo (AFTER) — mantem pf_accounts.balance (PRD §4.6.1)
CREATE OR REPLACE FUNCTION pf_sync_account_balance() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.account_id IS NOT NULL THEN
    UPDATE pf_accounts
       SET balance = balance - (CASE WHEN OLD.type = 'income' THEN OLD.amount ELSE -OLD.amount END),
           updated_at = now()
     WHERE id = OLD.account_id;
  END IF;
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.account_id IS NOT NULL THEN
    UPDATE pf_accounts
       SET balance = balance + (CASE WHEN NEW.type = 'income' THEN NEW.amount ELSE -NEW.amount END),
           updated_at = now()
     WHERE id = NEW.account_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_pf_sync_balance
  AFTER INSERT OR UPDATE OR DELETE ON pf_transactions
  FOR EACH ROW EXECUTE FUNCTION pf_sync_account_balance();

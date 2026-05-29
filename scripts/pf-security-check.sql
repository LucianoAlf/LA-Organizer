-- Asserts de seguranca dos triggers (rodar via MCP execute_sql, dentro de transacao descartavel).
-- Substitua COLLAB_A / COLLAB_B pelos ids reais antes de rodar.
--   COLLAB_A = 0576f4b6-183d-4cf1-980e-5c8d5da0177f (Luciano Alf)
--   COLLAB_B = bfd77b2c-3303-47fe-abe1-e73a2d8da0e1 (Quintela)
BEGIN;
INSERT INTO pf_accounts (id, collaborator_id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','0576f4b6-183d-4cf1-980e-5c8d5da0177f','Conta A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfd77b2c-3303-47fe-abe1-e73a2d8da0e1','Conta B');

-- 1) transacao legitima do A na conta do A: saldo deve virar -50 (expense)
INSERT INTO pf_transactions (collaborator_id, account_id, type, category, amount)
  VALUES ('0576f4b6-183d-4cf1-980e-5c8d5da0177f','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','expense','alimentacao',50);
DO $$ DECLARE b numeric; BEGIN
  SELECT balance INTO b FROM pf_accounts WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  ASSERT b = -50, 'saldo do A deveria ser -50, veio '||b;
END $$;

-- 2) transacao do A apontando pra conta do B (account_id forjado): DEVE falhar
DO $$ BEGIN
  BEGIN
    INSERT INTO pf_transactions (collaborator_id, account_id, type, category, amount)
      VALUES ('0576f4b6-183d-4cf1-980e-5c8d5da0177f','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','expense','alimentacao',999);
    RAISE EXCEPTION 'FALHA DE SEGURANCA: insert cross-owner foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%pertence a outro colaborador%' THEN
      RAISE NOTICE 'OK: insert cross-owner rejeitado';
    ELSE RAISE; END IF;
  END;
END $$;

-- 3) saldo da conta do B intacto (0)
DO $$ DECLARE b numeric; BEGIN
  SELECT balance INTO b FROM pf_accounts WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ASSERT b = 0, 'saldo do B deveria ser 0, veio '||b;
END $$;
ROLLBACK;

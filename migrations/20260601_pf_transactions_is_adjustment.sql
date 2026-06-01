-- Marca transações que são acerto de caixa (saldo inicial / ajuste de saldo).
-- Continuam contando no saldo (trigger não muda), mas saem dos relatórios.
ALTER TABLE pf_transactions
  ADD COLUMN IF NOT EXISTS is_adjustment boolean NOT NULL DEFAULT false;

-- Backfill: os ajustes já criados pelo AccountSheet usam estas descrições + categoria 'outros'.
UPDATE pf_transactions
   SET is_adjustment = true
 WHERE is_adjustment = false
   AND category = 'outros'
   AND description IN ('Saldo inicial', 'Ajuste de saldo');

-- Migration: loja_mov_tipo_transferencia
-- Adiciona saida_transferencia e entrada_transferencia no CHECK constraint de tipo
-- Amplia VARCHAR(20) -> VARCHAR(30) para acomodar 'entrada_transferencia' (21 chars)

ALTER TABLE loja_movimentacoes_estoque
  ALTER COLUMN tipo TYPE VARCHAR(30);

ALTER TABLE loja_movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS loja_movimentacoes_estoque_tipo_check;

ALTER TABLE loja_movimentacoes_estoque
  ADD CONSTRAINT loja_movimentacoes_estoque_tipo_check
  CHECK (tipo IN ('entrada','venda','estorno','ajuste','saida_transferencia','entrada_transferencia'));

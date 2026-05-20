-- Migration: loja_sp_transferir_estoque
-- Cria stored procedure atômica de transferência de estoque entre unidades
-- Tipos reais: produto_id INT, variacao_id INT, unidade_id UUID
-- loja_movimentacoes_estoque: campo observacoes (TEXT), saldo_apos NOT NULL

CREATE OR REPLACE FUNCTION transferir_estoque(
  p_produto_id      INT,
  p_variacao_id     INT,
  p_unidade_origem  UUID,
  p_unidade_destino UUID,
  p_quantidade      INT,
  p_motivo          TEXT,
  p_via_audit       TEXT
)
RETURNS TABLE (saldo_origem INT, saldo_destino INT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo_origem_antes   INT;
  v_saldo_destino_antes  INT;
  v_saldo_origem_depois  INT;
  v_saldo_destino_depois INT;
BEGIN
  -- Validações básicas
  IF p_quantidade <= 0 THEN
    RAISE EXCEPTION 'quantidade deve ser maior que zero';
  END IF;
  IF p_unidade_origem = p_unidade_destino THEN
    RAISE EXCEPTION 'unidade_origem e unidade_destino não podem ser iguais';
  END IF;
  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RAISE EXCEPTION 'motivo é obrigatório';
  END IF;
  IF p_via_audit IS NULL OR trim(p_via_audit) = '' THEN
    RAISE EXCEPTION 'via_audit é obrigatório';
  END IF;

  -- Lock do estoque de origem FOR UPDATE
  IF p_variacao_id IS NULL THEN
    SELECT quantidade INTO v_saldo_origem_antes
      FROM loja_estoque
     WHERE produto_id = p_produto_id
       AND unidade_id = p_unidade_origem
       AND variacao_id IS NULL
     FOR UPDATE;
  ELSE
    SELECT quantidade INTO v_saldo_origem_antes
      FROM loja_estoque
     WHERE produto_id = p_produto_id
       AND variacao_id = p_variacao_id
       AND unidade_id = p_unidade_origem
     FOR UPDATE;
  END IF;

  -- Verifica saldo suficiente
  IF v_saldo_origem_antes IS NULL OR v_saldo_origem_antes < p_quantidade THEN
    RAISE EXCEPTION 'saldo insuficiente na origem: disponível %, solicitado %',
      COALESCE(v_saldo_origem_antes, 0), p_quantidade;
  END IF;

  -- Lê saldo destino antes
  IF p_variacao_id IS NULL THEN
    SELECT COALESCE(quantidade, 0) INTO v_saldo_destino_antes
      FROM loja_estoque
     WHERE produto_id = p_produto_id
       AND unidade_id = p_unidade_destino
       AND variacao_id IS NULL;
  ELSE
    SELECT COALESCE(quantidade, 0) INTO v_saldo_destino_antes
      FROM loja_estoque
     WHERE produto_id = p_produto_id
       AND variacao_id = p_variacao_id
       AND unidade_id = p_unidade_destino;
  END IF;
  IF v_saldo_destino_antes IS NULL THEN
    v_saldo_destino_antes := 0;
  END IF;

  -- Calcula saldos finais
  v_saldo_origem_depois  := v_saldo_origem_antes  - p_quantidade;
  v_saldo_destino_depois := v_saldo_destino_antes + p_quantidade;

  -- Decrementa estoque origem
  IF p_variacao_id IS NULL THEN
    UPDATE loja_estoque
       SET quantidade = quantidade - p_quantidade,
           updated_at = now()
     WHERE produto_id = p_produto_id
       AND unidade_id = p_unidade_origem
       AND variacao_id IS NULL;
  ELSE
    UPDATE loja_estoque
       SET quantidade = quantidade - p_quantidade,
           updated_at = now()
     WHERE produto_id = p_produto_id
       AND variacao_id = p_variacao_id
       AND unidade_id = p_unidade_origem;
  END IF;

  -- Upsert estoque destino
  IF p_variacao_id IS NULL THEN
    INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade)
      VALUES (p_produto_id, NULL, p_unidade_destino, p_quantidade)
    ON CONFLICT (produto_id, unidade_id) WHERE variacao_id IS NULL
    DO UPDATE SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade,
                  updated_at = now();
  ELSE
    INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade)
      VALUES (p_produto_id, p_variacao_id, p_unidade_destino, p_quantidade)
    ON CONFLICT (produto_id, variacao_id, unidade_id) WHERE variacao_id IS NOT NULL
    DO UPDATE SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade,
                  updated_at = now();
  END IF;

  -- Registra movimentação saida_transferencia na origem (inclui saldo_apos NOT NULL)
  INSERT INTO loja_movimentacoes_estoque
    (produto_id, variacao_id, unidade_id, tipo, quantidade, saldo_apos, observacoes)
  VALUES
    (p_produto_id, p_variacao_id, p_unidade_origem,
     'saida_transferencia', p_quantidade, v_saldo_origem_depois,
     p_motivo || ' | via: ' || p_via_audit || ' | transferência para unidade ' || p_unidade_destino::TEXT);

  -- Registra movimentação entrada_transferencia no destino (inclui saldo_apos NOT NULL)
  INSERT INTO loja_movimentacoes_estoque
    (produto_id, variacao_id, unidade_id, tipo, quantidade, saldo_apos, observacoes)
  VALUES
    (p_produto_id, p_variacao_id, p_unidade_destino,
     'entrada_transferencia', p_quantidade, v_saldo_destino_depois,
     p_motivo || ' | via: ' || p_via_audit || ' | transferência de unidade ' || p_unidade_origem::TEXT);

  RETURN QUERY SELECT v_saldo_origem_depois, v_saldo_destino_depois;
END;
$$;

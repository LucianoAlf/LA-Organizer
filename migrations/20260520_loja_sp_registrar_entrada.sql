-- ============================================================
-- 20260520_loja_sp_registrar_entrada
-- Sprint Fase B — entrada de estoque (compra, recebimento).
-- Upsert em loja_estoque (incrementa se existe, cria se não) +
-- movimentação. Usa UNIQUE index existente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_entrada_estoque(
  p_produto_id  INT,
  p_unidade_id  UUID,
  p_quantidade  INT,
  p_via_audit   TEXT,
  p_variacao_id INT DEFAULT NULL,
  p_observacoes TEXT DEFAULT NULL
) RETURNS TABLE (saldo_apos INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_saldo INT;
BEGIN
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'quantidade_deve_ser_positiva: %', p_quantidade;
  END IF;
  IF p_via_audit IS NULL OR LENGTH(TRIM(p_via_audit)) = 0 THEN
    RAISE EXCEPTION 'via_audit_obrigatorio';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loja_produtos WHERE id = p_produto_id AND ativo = TRUE) THEN
    RAISE EXCEPTION 'produto_inexistente_ou_inativo: %', p_produto_id;
  END IF;

  -- Upsert estoque. ON CONFLICT usa a MESMA expressão do unique index existente:
  --   loja_estoque_produto_unidade_variacao_uq ON (produto_id, unidade_id, COALESCE(variacao_id, 0))
  INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade, updated_at)
  VALUES (p_produto_id, p_variacao_id, p_unidade_id, p_quantidade, NOW())
  ON CONFLICT (produto_id, unidade_id, COALESCE(variacao_id, 0)) DO UPDATE
    SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade,
        updated_at = NOW()
  RETURNING quantidade INTO v_saldo;

  INSERT INTO loja_movimentacoes_estoque (
    produto_id, variacao_id, unidade_id, tipo,
    quantidade, saldo_apos, colaborador_id, observacoes
  ) VALUES (
    p_produto_id, p_variacao_id, p_unidade_id, 'entrada',
    p_quantidade, v_saldo, NULL,
    CONCAT_WS(' — ', NULLIF(p_observacoes, ''), p_via_audit)
  );

  RETURN QUERY SELECT v_saldo;
END;
$$;

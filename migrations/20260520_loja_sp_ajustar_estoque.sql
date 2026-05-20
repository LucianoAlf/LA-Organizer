-- ============================================================
-- 20260520_loja_sp_ajustar_estoque
-- Sprint Fase B — ajuste manual (positivo OU negativo).
-- Usado pra correções (perda, sobra contada, transferência sem
-- documentação). Audit-trail completo nas observações.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ajustar_estoque_manual(
  p_produto_id  INT,
  p_unidade_id  UUID,
  p_delta       INT,        -- pode ser positivo OU negativo
  p_motivo      TEXT,       -- obrigatório (audit)
  p_via_audit   TEXT,
  p_variacao_id INT DEFAULT NULL
) RETURNS TABLE (saldo_apos INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_saldo_atual INT; v_saldo_novo INT;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta_deve_ser_diferente_de_zero';
  END IF;
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'motivo_obrigatorio_pra_ajuste';
  END IF;
  IF p_via_audit IS NULL OR LENGTH(TRIM(p_via_audit)) = 0 THEN
    RAISE EXCEPTION 'via_audit_obrigatorio';
  END IF;

  SELECT quantidade INTO v_saldo_atual FROM loja_estoque
    WHERE produto_id = p_produto_id
      AND unidade_id = p_unidade_id
      AND (variacao_id IS NOT DISTINCT FROM p_variacao_id)
    FOR UPDATE;
  IF v_saldo_atual IS NULL THEN
    -- Permite criar registro de estoque mesmo via ajuste positivo
    IF p_delta < 0 THEN
      RAISE EXCEPTION 'estoque_inexistente_e_delta_negativo';
    END IF;
    INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade, updated_at)
    VALUES (p_produto_id, p_variacao_id, p_unidade_id, p_delta, NOW())
    RETURNING quantidade INTO v_saldo_novo;
  ELSE
    v_saldo_novo := v_saldo_atual + p_delta;
    IF v_saldo_novo < 0 THEN
      RAISE EXCEPTION 'estoque_ficaria_negativo: atual=%, delta=%', v_saldo_atual, p_delta;
    END IF;
    UPDATE loja_estoque SET quantidade = v_saldo_novo, updated_at = NOW()
      WHERE produto_id = p_produto_id
        AND unidade_id = p_unidade_id
        AND (variacao_id IS NOT DISTINCT FROM p_variacao_id);
  END IF;

  INSERT INTO loja_movimentacoes_estoque (
    produto_id, variacao_id, unidade_id, tipo,
    quantidade, saldo_apos, colaborador_id, observacoes
  ) VALUES (
    p_produto_id, p_variacao_id, p_unidade_id, 'ajuste',
    p_delta, v_saldo_novo, NULL,
    CONCAT(p_motivo, ' — ', p_via_audit)
  );

  RETURN QUERY SELECT v_saldo_novo;
END;
$$;

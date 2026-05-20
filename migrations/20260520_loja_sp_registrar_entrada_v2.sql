-- ============================================================
-- 20260520_loja_sp_registrar_entrada_v2
-- SP nova multi-item para entrada de estoque com NF e custo.
-- ON CONFLICT usa índices parciais auditados em 20/05/2026:
--   sem variacao: (produto_id, unidade_id) WHERE variacao_id IS NULL
--   com variacao: (produto_id, variacao_id, unidade_id) WHERE variacao_id IS NOT NULL
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_entrada_estoque_v2(
  p_unidade_id  UUID,
  p_itens       JSONB,  -- [{produto_id, variacao_id?, quantidade, custo_unitario?}]
  p_via_audit   TEXT,
  p_nf          TEXT DEFAULT NULL,
  p_fornecedor  TEXT DEFAULT NULL,
  p_observacoes TEXT DEFAULT NULL
) RETURNS TABLE (itens_resultado JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_item JSONB;
  v_produto_id INT;
  v_variacao_id INT;
  v_qtd INT;
  v_custo NUMERIC;
  v_saldo INT;
  v_result JSONB := '[]'::JSONB;
  v_obs_completa TEXT;
BEGIN
  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'itens_vazios';
  END IF;
  IF p_via_audit IS NULL OR LENGTH(TRIM(p_via_audit)) = 0 THEN
    RAISE EXCEPTION 'via_audit_obrigatorio';
  END IF;

  v_obs_completa := CONCAT_WS(' — ',
    NULLIF(p_observacoes, ''),
    CASE WHEN p_nf IS NOT NULL THEN 'NF: ' || p_nf END,
    CASE WHEN p_fornecedor IS NOT NULL THEN 'Fornecedor: ' || p_fornecedor END,
    p_via_audit);

  FOR v_item IN SELECT jsonb_array_elements(p_itens) LOOP
    v_produto_id := (v_item->>'produto_id')::INT;
    v_variacao_id := NULLIF(v_item->>'variacao_id', '')::INT;
    v_qtd := (v_item->>'quantidade')::INT;
    v_custo := NULLIF(v_item->>'custo_unitario', '')::NUMERIC;

    IF v_qtd IS NULL OR v_qtd <= 0 THEN
      RAISE EXCEPTION 'quantidade_invalida: produto=%', v_produto_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM loja_produtos WHERE id = v_produto_id AND ativo = TRUE) THEN
      RAISE EXCEPTION 'produto_inexistente_ou_inativo: %', v_produto_id;
    END IF;

    -- Upsert estoque com índices parciais auditados
    IF v_variacao_id IS NULL THEN
      INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade, updated_at)
      VALUES (v_produto_id, NULL, p_unidade_id, v_qtd, NOW())
      ON CONFLICT (produto_id, unidade_id) WHERE variacao_id IS NULL
      DO UPDATE SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade,
                    updated_at = NOW()
      RETURNING quantidade INTO v_saldo;
    ELSE
      INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade, updated_at)
      VALUES (v_produto_id, v_variacao_id, p_unidade_id, v_qtd, NOW())
      ON CONFLICT (produto_id, variacao_id, unidade_id) WHERE variacao_id IS NOT NULL
      DO UPDATE SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade,
                    updated_at = NOW()
      RETURNING quantidade INTO v_saldo;
    END IF;

    INSERT INTO loja_movimentacoes_estoque (
      produto_id, variacao_id, unidade_id, tipo,
      quantidade, saldo_apos, colaborador_id, observacoes
    ) VALUES (
      v_produto_id, v_variacao_id, p_unidade_id, 'entrada',
      v_qtd, v_saldo, NULL,
      CONCAT_WS(' — ',
        CASE WHEN v_custo IS NOT NULL THEN 'Custo: R$' || v_custo::TEXT END,
        v_obs_completa)
    );

    v_result := v_result || jsonb_build_object(
      'produto_id', v_produto_id,
      'variacao_id', v_variacao_id,
      'quantidade', v_qtd,
      'saldo_apos', v_saldo
    );
  END LOOP;

  RETURN QUERY SELECT v_result;
END;
$$;

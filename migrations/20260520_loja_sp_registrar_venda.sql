-- ============================================================
-- 20260520_loja_sp_registrar_venda
-- Sprint Fase B — Lojinha Bidirecional
-- SP atômica que registra venda completa: vendas + itens + estoque
-- + movimentação + comissão professor indicador (se houver).
-- Comissão de farmer fica CALCULADA mas NÃO creditada (sem mapping
-- cross-project entre collaborators.id UUID e loja_*.colaborador_id INT).
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_venda(
  p_produto_id      INT,
  p_unidade_id      UUID,
  p_quantidade      INT,
  p_forma_pagamento VARCHAR,
  p_via_audit       TEXT,
  p_variacao_id     INT DEFAULT NULL,
  p_tipo_cliente    VARCHAR DEFAULT 'avulso',
  p_cliente_nome    VARCHAR DEFAULT NULL,
  p_aluno_id        INT DEFAULT NULL,
  p_professor_indicador_id INT DEFAULT NULL,
  p_desconto        NUMERIC DEFAULT 0,
  p_parcelas        INT DEFAULT 1,
  p_observacoes     TEXT DEFAULT NULL
) RETURNS TABLE (venda_id INT, saldo_apos INT, comissao_farmer NUMERIC, comissao_professor NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_preco_unit NUMERIC; v_produto_nome VARCHAR; v_variacao_nome VARCHAR;
  v_subtotal NUMERIC; v_total NUMERIC;
  v_saldo_atual INT; v_saldo_novo INT;
  v_venda_id INT;
  v_comissao_farmer_pct NUMERIC; v_comissao_prof_pct NUMERIC;
  v_comissao_farmer NUMERIC := 0; v_comissao_prof NUMERIC := 0;
  v_carteira_id INT;
BEGIN
  -- Validações básicas
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'quantidade_deve_ser_positiva: %', p_quantidade;
  END IF;
  IF p_forma_pagamento NOT IN ('pix','credito','debito','dinheiro') THEN
    RAISE EXCEPTION 'forma_pagamento_invalida: %', p_forma_pagamento;
  END IF;
  IF p_via_audit IS NULL OR LENGTH(TRIM(p_via_audit)) = 0 THEN
    RAISE EXCEPTION 'via_audit_obrigatorio';
  END IF;

  -- 1. Lê preço e nome do produto (ou variação)
  IF p_variacao_id IS NOT NULL THEN
    SELECT preco, nome INTO v_preco_unit, v_variacao_nome
      FROM loja_variacoes WHERE id = p_variacao_id AND ativo = TRUE;
    IF v_preco_unit IS NULL THEN
      RAISE EXCEPTION 'variacao_inexistente_ou_inativa: %', p_variacao_id;
    END IF;
  END IF;
  IF v_preco_unit IS NULL THEN
    SELECT preco, nome INTO v_preco_unit, v_produto_nome
      FROM loja_produtos WHERE id = p_produto_id AND ativo = TRUE;
    IF v_preco_unit IS NULL THEN
      RAISE EXCEPTION 'produto_inexistente_ou_inativo: %', p_produto_id;
    END IF;
  ELSE
    SELECT nome INTO v_produto_nome FROM loja_produtos WHERE id = p_produto_id;
  END IF;

  -- 2. Lock e checa estoque suficiente
  SELECT quantidade INTO v_saldo_atual FROM loja_estoque
    WHERE produto_id = p_produto_id
      AND unidade_id = p_unidade_id
      AND (variacao_id IS NOT DISTINCT FROM p_variacao_id)
    FOR UPDATE;
  IF v_saldo_atual IS NULL THEN
    RAISE EXCEPTION 'estoque_inexistente_pra_unidade';
  END IF;
  IF v_saldo_atual < p_quantidade THEN
    RAISE EXCEPTION 'estoque_insuficiente: tem %, pediu %', v_saldo_atual, p_quantidade;
  END IF;
  v_saldo_novo := v_saldo_atual - p_quantidade;

  -- 3. Totais
  v_subtotal := v_preco_unit * p_quantidade;
  v_total := v_subtotal - COALESCE(p_desconto, 0);

  -- 4. INSERT loja_vendas
  INSERT INTO loja_vendas (
    unidade_id, data_venda, tipo_cliente, cliente_nome, aluno_id, professor_indicador_id,
    subtotal, desconto, total, forma_pagamento, parcelas, observacoes, status, vendedor_id
  ) VALUES (
    p_unidade_id, NOW(), p_tipo_cliente, p_cliente_nome, p_aluno_id, p_professor_indicador_id,
    v_subtotal, COALESCE(p_desconto, 0), v_total, p_forma_pagamento, p_parcelas,
    CONCAT_WS(' — ', NULLIF(p_observacoes, ''), p_via_audit), 'concluida', NULL
  ) RETURNING id INTO v_venda_id;

  -- 5. INSERT loja_vendas_itens
  INSERT INTO loja_vendas_itens (
    venda_id, produto_id, variacao_id, produto_nome, variacao_nome,
    quantidade, preco_unitario, subtotal
  ) VALUES (
    v_venda_id, p_produto_id, p_variacao_id, v_produto_nome, v_variacao_nome,
    p_quantidade, v_preco_unit, v_subtotal
  );

  -- 6. UPDATE loja_estoque
  UPDATE loja_estoque SET quantidade = v_saldo_novo, updated_at = NOW()
    WHERE produto_id = p_produto_id
      AND unidade_id = p_unidade_id
      AND (variacao_id IS NOT DISTINCT FROM p_variacao_id);

  -- 7. INSERT loja_movimentacoes_estoque
  INSERT INTO loja_movimentacoes_estoque (
    produto_id, variacao_id, unidade_id, tipo, quantidade,
    saldo_apos, referencia_id, colaborador_id, observacoes
  ) VALUES (
    p_produto_id, p_variacao_id, p_unidade_id, 'venda', -p_quantidade,
    v_saldo_novo, v_venda_id, NULL, p_via_audit
  );

  -- 8. Comissões
  SELECT (valor::numeric) / 100 INTO v_comissao_farmer_pct
    FROM loja_configuracoes WHERE chave = 'comissao_farmer_padrao';
  SELECT (valor::numeric) / 100 INTO v_comissao_prof_pct
    FROM loja_configuracoes WHERE chave = 'comissao_professor_indicacao';
  v_comissao_farmer_pct := COALESCE(v_comissao_farmer_pct, 0.05);
  v_comissao_prof_pct   := COALESCE(v_comissao_prof_pct,   0.05);

  -- Farmer: calculado mas NÃO creditado (sem mapping cross-project, ver spec §11)
  v_comissao_farmer := v_total * v_comissao_farmer_pct;

  -- Professor indicador: credita carteira se vier ID
  IF p_professor_indicador_id IS NOT NULL THEN
    v_comissao_prof := v_total * v_comissao_prof_pct;
    SELECT id INTO v_carteira_id FROM loja_carteira
      WHERE tipo_titular = 'professor'
        AND professor_id = p_professor_indicador_id
        AND unidade_id = p_unidade_id;
    IF v_carteira_id IS NULL THEN
      INSERT INTO loja_carteira (tipo_titular, professor_id, unidade_id, saldo, moedas_la)
      VALUES ('professor', p_professor_indicador_id, p_unidade_id, v_comissao_prof, 0)
      RETURNING id INTO v_carteira_id;
    ELSE
      UPDATE loja_carteira SET saldo = saldo + v_comissao_prof WHERE id = v_carteira_id;
    END IF;
    INSERT INTO loja_carteira_movimentacoes (
      carteira_id, tipo, valor, saldo_apos, referencia_tipo, referencia_id, descricao
    ) VALUES (
      v_carteira_id, 'credito', v_comissao_prof,
      (SELECT saldo FROM loja_carteira WHERE id = v_carteira_id),
      'venda', v_venda_id,
      CONCAT('Indicação venda #', v_venda_id, ' — ', p_via_audit)
    );
  END IF;

  RETURN QUERY SELECT v_venda_id, v_saldo_novo, v_comissao_farmer, v_comissao_prof;
END;
$$;

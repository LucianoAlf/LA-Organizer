-- ============================================================
-- 20260520_loja_sp_registrar_venda_v2
-- Substitui registrar_venda (single-item) por versão atômica
-- multi-item. SP antiga vira registrar_venda_legacy por 1 sprint.
-- CHECK constraints reais aplicados (auditados em 20/05/2026):
--   desconto_tipo: 'valor'|'percentual' (NÃO 'reais')
--   forma_pagamento: pix|dinheiro|debito|credito|folha|saldo
--   tipo_cliente: aluno|colaborador|avulso
-- ============================================================

-- Renomeia a SP antiga (assinatura auditada em 20/05/2026)
ALTER FUNCTION public.registrar_venda(
  p_produto_id integer,
  p_unidade_id uuid,
  p_quantidade integer,
  p_forma_pagamento character varying,
  p_via_audit text,
  p_variacao_id integer,
  p_tipo_cliente character varying,
  p_cliente_nome character varying,
  p_aluno_id integer,
  p_professor_indicador_id integer,
  p_desconto numeric,
  p_parcelas integer,
  p_observacoes text
) RENAME TO registrar_venda_legacy;

-- Cria SP v2 (multi-item)
CREATE OR REPLACE FUNCTION public.registrar_venda_v2(
  p_unidade_id      UUID,
  p_itens           JSONB,    -- [{produto_id, variacao_id?, quantidade, preco_unitario_override?}]
  p_forma_pagamento VARCHAR,
  p_via_audit       TEXT,
  p_tipo_cliente    VARCHAR DEFAULT 'avulso',
  p_cliente_nome    VARCHAR DEFAULT NULL,
  p_aluno_id        INT DEFAULT NULL,
  p_colaborador_cliente_id INT DEFAULT NULL,
  p_professor_indicador_id INT DEFAULT NULL,
  p_desconto        NUMERIC DEFAULT 0,
  p_desconto_tipo   VARCHAR DEFAULT 'valor',
  p_parcelas        INT DEFAULT 1,
  p_observacoes     TEXT DEFAULT NULL
) RETURNS TABLE (
  venda_id INT,
  total NUMERIC,
  itens_resultado JSONB,
  comissao_professor NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_item JSONB;
  v_produto_id INT;
  v_variacao_id INT;
  v_qtd INT;
  v_preco_unit NUMERIC;
  v_preco_override NUMERIC;
  v_produto_nome VARCHAR;
  v_variacao_nome VARCHAR;
  v_subtotal NUMERIC := 0;
  v_subtotal_item NUMERIC;
  v_saldo_atual INT;
  v_saldo_novo INT;
  v_total NUMERIC;
  v_desconto_calc NUMERIC := 0;
  v_venda_id INT;
  v_itens_result JSONB := '[]'::JSONB;
  v_comissao_prof_pct NUMERIC;
  v_comissao_prof NUMERIC := 0;
  v_carteira_id INT;
BEGIN
  -- Validações
  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'itens_vazios';
  END IF;
  IF p_forma_pagamento NOT IN ('pix','dinheiro','debito','credito','folha','saldo') THEN
    RAISE EXCEPTION 'forma_pagamento_invalida: %', p_forma_pagamento;
  END IF;
  IF p_tipo_cliente NOT IN ('aluno','colaborador','avulso') THEN
    RAISE EXCEPTION 'tipo_cliente_invalido: %', p_tipo_cliente;
  END IF;
  IF p_desconto_tipo NOT IN ('valor','percentual') THEN
    RAISE EXCEPTION 'desconto_tipo_invalido: %', p_desconto_tipo;
  END IF;
  IF p_via_audit IS NULL OR LENGTH(TRIM(p_via_audit)) = 0 THEN
    RAISE EXCEPTION 'via_audit_obrigatorio';
  END IF;

  -- LOOP 1: lock + checa saldo de cada item, acumula subtotal
  FOR v_item IN SELECT jsonb_array_elements(p_itens) LOOP
    v_produto_id := (v_item->>'produto_id')::INT;
    v_variacao_id := NULLIF(v_item->>'variacao_id', '')::INT;
    v_qtd := (v_item->>'quantidade')::INT;
    v_preco_override := NULLIF(v_item->>'preco_unitario_override', '')::NUMERIC;

    IF v_qtd IS NULL OR v_qtd <= 0 THEN
      RAISE EXCEPTION 'quantidade_invalida_item: produto=%', v_produto_id;
    END IF;

    -- Lê preço atual do produto (ou override do payload)
    IF v_preco_override IS NOT NULL THEN
      v_preco_unit := v_preco_override;
      SELECT nome INTO v_produto_nome FROM loja_produtos WHERE id = v_produto_id;
    ELSIF v_variacao_id IS NOT NULL THEN
      SELECT preco, nome INTO v_preco_unit, v_variacao_nome
        FROM loja_variacoes WHERE id = v_variacao_id AND ativo = TRUE;
      IF v_preco_unit IS NULL THEN
        RAISE EXCEPTION 'variacao_inexistente_ou_inativa: %', v_variacao_id;
      END IF;
      SELECT nome INTO v_produto_nome FROM loja_produtos WHERE id = v_produto_id;
    ELSE
      SELECT preco, nome INTO v_preco_unit, v_produto_nome
        FROM loja_produtos WHERE id = v_produto_id AND ativo = TRUE;
      IF v_preco_unit IS NULL THEN
        RAISE EXCEPTION 'produto_inexistente_ou_inativo: %', v_produto_id;
      END IF;
    END IF;

    -- Lock estoque
    SELECT quantidade INTO v_saldo_atual FROM loja_estoque
      WHERE produto_id = v_produto_id
        AND unidade_id = p_unidade_id
        AND (variacao_id IS NOT DISTINCT FROM v_variacao_id)
      FOR UPDATE;
    IF v_saldo_atual IS NULL THEN
      RAISE EXCEPTION 'estoque_inexistente_pra_unidade: produto=%', v_produto_id;
    END IF;
    IF v_saldo_atual < v_qtd THEN
      RAISE EXCEPTION 'estoque_insuficiente: produto=%, tem=%, pediu=%',
        v_produto_id, v_saldo_atual, v_qtd;
    END IF;

    v_subtotal_item := v_preco_unit * v_qtd;
    v_subtotal := v_subtotal + v_subtotal_item;
  END LOOP;

  -- Desconto
  IF p_desconto_tipo = 'percentual' THEN
    v_desconto_calc := v_subtotal * (p_desconto / 100.0);
  ELSE
    v_desconto_calc := p_desconto;
  END IF;
  v_total := v_subtotal - v_desconto_calc;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'desconto_maior_que_subtotal';
  END IF;

  -- INSERT loja_vendas (1 row)
  INSERT INTO loja_vendas (
    unidade_id, data_venda, tipo_cliente, cliente_nome, aluno_id,
    colaborador_cliente_id, professor_indicador_id,
    subtotal, desconto, desconto_tipo, total,
    forma_pagamento, parcelas, observacoes, status, vendedor_id
  ) VALUES (
    p_unidade_id, NOW(), p_tipo_cliente, p_cliente_nome, p_aluno_id,
    p_colaborador_cliente_id, p_professor_indicador_id,
    v_subtotal, v_desconto_calc, p_desconto_tipo, v_total,
    p_forma_pagamento, p_parcelas,
    CONCAT_WS(' — ', NULLIF(p_observacoes, ''), p_via_audit),
    'concluida', NULL
  ) RETURNING id INTO v_venda_id;

  -- LOOP 2: insere itens + atualiza estoque + cria movimentações
  FOR v_item IN SELECT jsonb_array_elements(p_itens) LOOP
    v_produto_id := (v_item->>'produto_id')::INT;
    v_variacao_id := NULLIF(v_item->>'variacao_id', '')::INT;
    v_qtd := (v_item->>'quantidade')::INT;
    v_preco_override := NULLIF(v_item->>'preco_unitario_override', '')::NUMERIC;

    -- Re-lê preço (consistência com loop 1)
    IF v_preco_override IS NOT NULL THEN
      v_preco_unit := v_preco_override;
    ELSIF v_variacao_id IS NOT NULL THEN
      SELECT preco INTO v_preco_unit FROM loja_variacoes WHERE id = v_variacao_id;
    ELSE
      SELECT preco INTO v_preco_unit FROM loja_produtos WHERE id = v_produto_id;
    END IF;
    SELECT nome INTO v_produto_nome FROM loja_produtos WHERE id = v_produto_id;
    v_variacao_nome := NULL;
    IF v_variacao_id IS NOT NULL THEN
      SELECT nome INTO v_variacao_nome FROM loja_variacoes WHERE id = v_variacao_id;
    END IF;

    v_subtotal_item := v_preco_unit * v_qtd;

    -- INSERT loja_vendas_itens
    INSERT INTO loja_vendas_itens (
      venda_id, produto_id, variacao_id, produto_nome, variacao_nome,
      quantidade, preco_unitario, subtotal
    ) VALUES (
      v_venda_id, v_produto_id, v_variacao_id, v_produto_nome, v_variacao_nome,
      v_qtd, v_preco_unit, v_subtotal_item
    );

    -- UPDATE loja_estoque
    UPDATE loja_estoque SET quantidade = quantidade - v_qtd, updated_at = NOW()
      WHERE produto_id = v_produto_id
        AND unidade_id = p_unidade_id
        AND (variacao_id IS NOT DISTINCT FROM v_variacao_id)
      RETURNING quantidade INTO v_saldo_novo;

    -- INSERT movimentação
    INSERT INTO loja_movimentacoes_estoque (
      produto_id, variacao_id, unidade_id, tipo,
      quantidade, saldo_apos, referencia_id, colaborador_id, observacoes
    ) VALUES (
      v_produto_id, v_variacao_id, p_unidade_id, 'venda',
      -v_qtd, v_saldo_novo, v_venda_id, NULL, p_via_audit
    );

    -- Acumula resultado
    v_itens_result := v_itens_result || jsonb_build_object(
      'produto_id', v_produto_id,
      'variacao_id', v_variacao_id,
      'quantidade', v_qtd,
      'saldo_apos', v_saldo_novo
    );
  END LOOP;

  -- Comissão professor indicador
  IF p_professor_indicador_id IS NOT NULL THEN
    SELECT (valor::numeric) / 100 INTO v_comissao_prof_pct
      FROM loja_configuracoes WHERE chave = 'comissao_professor_indicacao';
    v_comissao_prof_pct := COALESCE(v_comissao_prof_pct, 0.05);
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

  RETURN QUERY SELECT v_venda_id, v_total, v_itens_result, v_comissao_prof;
END;
$$;

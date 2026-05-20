-- Task 21: SP estornar_venda — atomicamente reverte estoque + debita carteira professor
CREATE OR REPLACE FUNCTION public.estornar_venda(
  p_venda_id     INT,
  p_motivo       TEXT,
  p_via_audit    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_venda          loja_vendas%ROWTYPE;
  v_item           RECORD;
  v_saldo_atual    INT;
  v_saldo_apos     INT;
  v_total_venda    NUMERIC;
  v_perc_comissao  NUMERIC := 0.05;
  v_comissao       NUMERIC := 0;
  v_itens_json     JSONB   := '[]'::JSONB;
  v_item_json      JSONB;
BEGIN
  -- Validações básicas
  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    RAISE EXCEPTION 'motivo_obrigatorio' USING HINT = 'O motivo do estorno não pode ser vazio';
  END IF;

  IF p_via_audit IS NULL OR TRIM(p_via_audit) = '' THEN
    RAISE EXCEPTION 'via_audit_obrigatorio' USING HINT = 'via_audit não pode ser vazio';
  END IF;

  -- Lock na venda
  SELECT * INTO v_venda FROM loja_vendas WHERE id = p_venda_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'venda_nao_encontrada' USING HINT = 'Venda não existe';
  END IF;

  IF v_venda.status = 'estornada' THEN
    RAISE EXCEPTION 'venda_ja_estornada' USING HINT = 'A venda já foi estornada anteriormente';
  END IF;

  v_total_venda := v_venda.total;

  -- Loop pelos itens da venda
  FOR v_item IN
    SELECT vi.produto_id, vi.variacao_id, vi.quantidade, vi.preco_unitario,
           p.nome AS produto_nome
    FROM loja_vendas_itens vi
    JOIN loja_produtos p ON p.id = vi.produto_id
    WHERE vi.venda_id = p_venda_id
  LOOP
    -- Busca saldo atual no estoque (ou 0 se não existir)
    SELECT COALESCE(quantidade, 0) INTO v_saldo_atual
    FROM loja_estoque
    WHERE produto_id = v_item.produto_id
      AND unidade_id = v_venda.unidade_id
      AND (variacao_id IS NOT DISTINCT FROM v_item.variacao_id);

    v_saldo_apos := v_saldo_atual + v_item.quantidade;

    -- Atualiza ou insere no estoque
    UPDATE loja_estoque
    SET quantidade = v_saldo_apos,
        updated_at = NOW()
    WHERE produto_id = v_item.produto_id
      AND unidade_id = v_venda.unidade_id
      AND (variacao_id IS NOT DISTINCT FROM v_item.variacao_id);

    IF NOT FOUND THEN
      INSERT INTO loja_estoque (produto_id, unidade_id, variacao_id, quantidade, updated_at)
      VALUES (v_item.produto_id, v_venda.unidade_id, v_item.variacao_id, v_item.quantidade, NOW());
      v_saldo_apos := v_item.quantidade;
    END IF;

    -- Movimentação de estorno
    INSERT INTO loja_movimentacoes_estoque (
      produto_id, variacao_id, unidade_id,
      tipo, quantidade, saldo_apos,
      referencia_id, observacoes, created_at
    ) VALUES (
      v_item.produto_id, v_item.variacao_id, v_venda.unidade_id,
      'estorno', v_item.quantidade, v_saldo_apos,
      p_venda_id, 'Estorno venda #' || p_venda_id || ' - ' || p_motivo, NOW()
    );

    -- Acumula JSON dos itens revertidos
    v_item_json := jsonb_build_object(
      'produto_id',    v_item.produto_id,
      'produto_nome',  v_item.produto_nome,
      'variacao_id',   v_item.variacao_id,
      'quantidade',    v_item.quantidade,
      'saldo_apos',    v_saldo_apos
    );
    v_itens_json := v_itens_json || jsonb_build_array(v_item_json);
  END LOOP;

  -- Comissão do professor indicador (se houver)
  IF v_venda.professor_indicador_id IS NOT NULL AND v_total_venda > 0 THEN
    -- Lê percentual de loja_configuracoes (chave 'comissao_professor_pct'), senão usa 5%
    SELECT COALESCE(valor::NUMERIC / 100, 0.05) INTO v_perc_comissao
    FROM loja_configuracoes
    WHERE chave = 'comissao_professor_pct'
    LIMIT 1;

    v_comissao := ROUND(v_total_venda * v_perc_comissao, 2);

    IF v_comissao > 0 THEN
      -- Debita carteira do professor
      UPDATE loja_carteira
      SET saldo = saldo - v_comissao,
          updated_at = NOW()
      WHERE professor_id = v_venda.professor_indicador_id;

      -- Registra movimentação de débito
      INSERT INTO loja_carteira_movimentacoes (
        professor_id, tipo, valor, referencia_id,
        descricao, created_at
      ) VALUES (
        v_venda.professor_indicador_id,
        'debito',
        v_comissao,
        p_venda_id,
        'Estorno de comissão — venda #' || p_venda_id,
        NOW()
      );
    END IF;
  END IF;

  -- Marca venda como estornada
  UPDATE loja_vendas
  SET status          = 'estornada',
      estornada_em    = NOW(),
      motivo_estorno  = p_motivo,
      observacoes     = COALESCE(observacoes, '') || ' | ESTORNADA por ' || p_via_audit || ': ' || p_motivo
  WHERE id = p_venda_id;

  -- Retorna resumo
  RETURN jsonb_build_object(
    'venda_id',           p_venda_id,
    'itens_revertidos',   v_itens_json,
    'comissao_debitada',  v_comissao,
    'estornada_em',       NOW()
  );
END;
$$;

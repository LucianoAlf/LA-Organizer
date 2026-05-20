-- Task 20: buscar_produto_fuzzy v2 — usa estoque_disponivel() quando unidade_id fornecida
CREATE OR REPLACE FUNCTION public.buscar_produto_fuzzy(
  p_termo TEXT, p_unidade_id UUID DEFAULT NULL
) RETURNS TABLE (id INT, nome VARCHAR, sku VARCHAR, preco NUMERIC, estoque INT, score REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.nome, p.sku, p.preco,
    CASE WHEN p_unidade_id IS NOT NULL
      THEN estoque_disponivel(p.id, p_unidade_id, NULL)
      ELSE COALESCE((SELECT SUM(quantidade) FROM loja_estoque e WHERE e.produto_id = p.id), 0)::INT
    END AS estoque,
    similarity(p.nome, p_termo) AS score
  FROM loja_produtos p
  WHERE p.ativo = TRUE
    AND (p.nome ILIKE '%' || p_termo || '%' OR similarity(p.nome, p_termo) > 0.2)
  ORDER BY score DESC, p.nome ASC LIMIT 5;
$$;

-- ============================================================
-- 20260520_loja_sp_buscar_produto_fuzzy
-- Sprint Fase B — helper de fuzzy match (TOM + autocomplete PWA).
-- Combina ILIKE + similarity (pg_trgm) com score pra ranking.
-- Requer: extensão pg_trgm (✅ já habilitada).
-- ============================================================

CREATE OR REPLACE FUNCTION public.buscar_produto_fuzzy(
  p_termo      TEXT,
  p_unidade_id UUID DEFAULT NULL
) RETURNS TABLE (
  id INT, nome VARCHAR, sku VARCHAR, preco NUMERIC,
  estoque INT, score REAL
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    p.id, p.nome, p.sku, p.preco,
    COALESCE(
      (SELECT quantidade FROM loja_estoque e
        WHERE e.produto_id = p.id
          AND (p_unidade_id IS NULL OR e.unidade_id = p_unidade_id)
        LIMIT 1),
      0
    )::INT AS estoque,
    similarity(p.nome, p_termo) AS score
  FROM loja_produtos p
  WHERE p.ativo = TRUE
    AND (p.nome ILIKE '%' || p_termo || '%' OR similarity(p.nome, p_termo) > 0.2)
  ORDER BY score DESC, p.nome ASC
  LIMIT 5;
$$;

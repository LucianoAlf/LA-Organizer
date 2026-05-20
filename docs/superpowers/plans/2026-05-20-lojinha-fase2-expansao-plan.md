# Lojinha Fase 2 — Expansão (Venda Rica + CRUD + Operações Avançadas)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar a UX da lojinha no PWA ao nível da UI rica do LA Report, mantendo bidirecional, e cobrir operações avançadas (CRUD produto, transferência, estorno, reserva).

**Architecture:** 3 sub-fases sequenciais (2.1 → 2.2 → 2.3). SPs PL/pgSQL no LA Report (`ouqwbbermlzqqvtqwlul`) garantem atomicidade. PWA usa stepper de 3 passos, autocompletes server-side e tabs (Produtos/Histórico/Reservas). TOM ganha bypass e handlers pras novas operações.

**Tech Stack:** PL/pgSQL · Vercel serverless (TypeScript) · React 18 + TanStack Query · Node 20 · Supabase RPC + Realtime.

**Spec:** `docs/superpowers/specs/2026-05-20-lojinha-fase2-expansao-design.md`

---

## Constantes do banco (referência rápida)

**Unidades (UUIDs):**
- Barra: `368d47f5-2d88-4475-bc14-ba084a9a348e`
- Campo Grande: `2ec861f6-023f-4d7b-9927-3960ad8c2a92`
- Recreio: `95553e96-971b-4590-a6eb-0201d013c14d`

**CHECK constraints reais (auditados):**
- `loja_vendas.tipo_cliente`: `'aluno' | 'colaborador' | 'avulso'`
- `loja_vendas.desconto_tipo`: `'valor' | 'percentual'` (NÃO `'reais'`)
- `loja_vendas.forma_pagamento`: `'pix' | 'dinheiro' | 'debito' | 'credito' | 'folha' | 'saldo'` (6 opções)
- `loja_movimentacoes_estoque.tipo`: `'entrada' | 'venda' | 'estorno' | 'ajuste'` → vai adicionar `'saida_transferencia'` e `'entrada_transferencia'` na Fase 2.2. `'estorno'` JÁ existe.

**UNIQUE indexes em `loja_estoque`:**
- `loja_estoque_produto_unidade_variacao_uq` em `(produto_id, unidade_id, COALESCE(variacao_id, 0))`
- `loja_estoque_sem_variacao_idx` em `(produto_id, unidade_id) WHERE variacao_id IS NULL`
- `loja_estoque_com_variacao_idx` em `(produto_id, variacao_id, unidade_id) WHERE variacao_id IS NOT NULL`

Para upsert sem variação, usar: `ON CONFLICT (produto_id, unidade_id) WHERE variacao_id IS NULL`.

---

## File Map

### Fase 2.1 — Venda Rica + Entrada Rica
**Criar:**
- `migrations/20260520_loja_sp_registrar_venda_v2.sql` (Task 1)
- `migrations/20260520_loja_sp_registrar_entrada_v2.sql` (Task 2)
- `web/api/lareport/loja/buscar-cliente.ts` (Task 3)
- `web/api/lareport/loja/buscar-professor.ts` (Task 4)
- `web/src/components/ClienteAutocomplete.tsx` (Task 5)
- `web/src/components/ProfessorAutocomplete.tsx` (Task 5)
- `web/src/screens/inventario/components/VendaWizardSheet.tsx` (Task 7)
- `web/src/screens/inventario/components/EntradaRicaSheet.tsx` (Task 8)

**Modificar:**
- `web/api/lareport/loja/venda.ts` (Task 6) — multi-item via SP v2
- `web/api/lareport/loja/entrada.ts` (Task 6) — multi-item via SP v2
- `web/src/lib/lareport-mutations.ts` (Task 6) — `registrarVendaMulti`, `registrarEntradaMulti`, `buscarCliente`, `buscarProfessor`
- `web/src/screens/inventario/LojaPage.tsx` (Task 9) — troca `VendaSheet` → `VendaWizardSheet`, troca `EntradaEstoqueSheet` → `EntradaRicaSheet`

### Fase 2.2 — CRUD Produto + Transferência
**Criar:**
- `migrations/20260520_loja_mov_tipo_transferencia.sql` (Task 10)
- `migrations/20260520_loja_sp_transferir_estoque.sql` (Task 11)
- `web/api/lareport/loja/produto/upsert.ts` (Task 12)
- `web/api/lareport/loja/produto/desativar.ts` (Task 13)
- `web/api/lareport/loja/produto/similar.ts` (Task 14)
- `web/api/lareport/loja/transferencia.ts` (Task 15)
- `web/src/screens/inventario/components/ProdutoFormSheet.tsx` (Task 16)
- `web/src/screens/inventario/components/TransferenciaSheet.tsx` (Task 17)

**Modificar:**
- `web/src/lib/lareport-mutations.ts` (Task 18) — adicionar 4 mutations
- `web/src/screens/inventario/LojaPage.tsx` (Task 18) — FAB ganha 3ª ação
- `web/src/screens/inventario/components/ProdutoCard.tsx` (Task 18) — botão "Editar" e "Desativar"

### Fase 2.3 — Estorno + Reserva + Histórico
**Criar:**
- `migrations/20260520_loja_reservas_table.sql` (Task 19)
- `migrations/20260520_loja_fn_estoque_disponivel.sql` (Task 20)
- `migrations/20260520_loja_buscar_produto_fuzzy_v2.sql` (Task 20)
- `migrations/20260520_loja_sp_estornar_venda.sql` (Task 21)
- `migrations/20260520_loja_sp_expirar_reservas.sql` (Task 25)
- `web/api/lareport/loja/historico-vendas.ts` (Task 22)
- `web/api/lareport/loja/estorno.ts` (Task 23)
- `web/api/lareport/loja/reserva.ts` (Task 24)
- `web/api/lareport/loja/reserva/cancelar.ts` (Task 24)
- `web/api/lareport/loja/reserva/finalizar.ts` (Task 24)
- `web/src/screens/inventario/components/HistoricoVendasView.tsx` (Task 26)
- `web/src/screens/inventario/components/EstornoConfirmSheet.tsx` (Task 26)
- `web/src/screens/inventario/components/ReservaSheet.tsx` (Task 26)
- `web/src/screens/inventario/components/ReservasView.tsx` (Task 26)

**Modificar:**
- `web/src/screens/inventario/LojaPage.tsx` (Task 26) — 3 tabs (Produtos/Histórico/Reservas), FAB ganha "📌 Reservar"
- `web/src/hooks/useLaReport.ts` (Task 26) — `useReportLoja` retorna `estoque_disponivel`, novos hooks `useHistoricoVendas`, `useReservas`
- `web/src/lib/lareport-mutations.ts` (Task 26) — `estornarVenda`, `criarReserva`, `cancelarReserva`, `finalizarReservaComoVenda`
- `src/rituals/dispatcher.js` (Task 25) — cron diário 9h `expirarReservasVencidas`
- `src/engine.js` (Task 27) — handlers TOM `shop_transfer`, `shop_estorno`, `shop_reserve` + bypass patterns
- `skills/lojinha.md` (Task 27) — descreve novas actions

---

## Notas globais de execução

- **Deploy backend (TOM):** após editar `src/*.js` ou `skills/*.md`, SCP imediato + `pm2 restart tom`. Parent agent rota — subagents devem **NÃO** rodar SCP/SSH.
- **Migrations:** aplicar via `mcp__4c04bb52-...__apply_migration` em `project_id="ouqwbbermlzqqvtqwlul"`.
- **Smoke test SQL:** via `mcp__4c04bb52-...__execute_sql` no mesmo project.
- **Validação TS:** `cd D:/la-organizer/_remote/web && npx tsc --noEmit`
- **Validação JS:** `node --check D:/la-organizer/_remote/src/...js`
- **Estoque populado pra teste:** Barra 112 itens, CG 142, Recreio 79. Não precisa popular.
- **Pré-reqs já aplicados:** `pg_trgm` + UNIQUE index em `loja_estoque`.

---

# FASE 2.1 — Venda Rica + Entrada Rica

## Task 1: SP `registrar_venda_v2` (multi-item)

**Files:**
- Create: `migrations/20260520_loja_sp_registrar_venda_v2.sql`
- Apply via MCP em `ouqwbbermlzqqvtqwlul`

- [ ] **Step 1: Escrever migration file**

```sql
-- ============================================================
-- 20260520_loja_sp_registrar_venda_v2
-- Substitui registrar_venda (single-item) por versão atômica
-- multi-item. SP antiga vira registrar_venda_legacy por 1 sprint.
-- CHECK constraints reais aplicados (auditados em 20/05/2026):
--   desconto_tipo: 'valor'|'percentual' (NÃO 'reais')
--   forma_pagamento: pix|dinheiro|debito|credito|folha|saldo
--   tipo_cliente: aluno|colaborador|avulso
-- ============================================================

-- Renomeia a SP antiga
ALTER FUNCTION public.registrar_venda(
  INT, UUID, INT, VARCHAR, TEXT, INT, VARCHAR, VARCHAR, INT, INT, NUMERIC, INT, TEXT
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
```

- [ ] **Step 2: Aplicar migration via MCP**

`apply_migration` no `ouqwbbermlzqqvtqwlul` com `name="loja_sp_registrar_venda_v2"` e o SQL acima.

- [ ] **Step 3: Smoke test multi-item OK**

`execute_sql`:
```sql
DO $$
DECLARE
  v_barra UUID := '368d47f5-2d88-4475-bc14-ba084a9a348e';
  v_itens JSONB;
  v_pid1 INT; v_pid2 INT;
  v_estoque_pid1_antes INT; v_estoque_pid2_antes INT;
  v_result RECORD;
BEGIN
  SELECT produto_id INTO v_pid1 FROM loja_estoque
    WHERE unidade_id = v_barra AND quantidade >= 2 ORDER BY produto_id LIMIT 1;
  SELECT produto_id INTO v_pid2 FROM loja_estoque
    WHERE unidade_id = v_barra AND quantidade >= 1 AND produto_id != v_pid1
    ORDER BY produto_id LIMIT 1;
  SELECT quantidade INTO v_estoque_pid1_antes FROM loja_estoque
    WHERE produto_id = v_pid1 AND unidade_id = v_barra AND variacao_id IS NULL;
  SELECT quantidade INTO v_estoque_pid2_antes FROM loja_estoque
    WHERE produto_id = v_pid2 AND unidade_id = v_barra AND variacao_id IS NULL;

  v_itens := jsonb_build_array(
    jsonb_build_object('produto_id', v_pid1, 'quantidade', 2),
    jsonb_build_object('produto_id', v_pid2, 'quantidade', 1)
  );

  SELECT * INTO v_result FROM registrar_venda_v2(
    p_unidade_id := v_barra, p_itens := v_itens,
    p_forma_pagamento := 'pix', p_via_audit := 'SMOKE_V2'
  );
  RAISE NOTICE '✅ venda_id=%, total=R$%, itens=%, comissao=%',
    v_result.venda_id, v_result.total, v_result.itens_resultado, v_result.comissao_professor;

  -- Cleanup
  DELETE FROM loja_movimentacoes_estoque WHERE referencia_id = v_result.venda_id AND tipo='venda';
  DELETE FROM loja_vendas_itens WHERE venda_id = v_result.venda_id;
  DELETE FROM loja_vendas WHERE id = v_result.venda_id;
  UPDATE loja_estoque SET quantidade = v_estoque_pid1_antes
    WHERE produto_id = v_pid1 AND unidade_id = v_barra AND variacao_id IS NULL;
  UPDATE loja_estoque SET quantidade = v_estoque_pid2_antes
    WHERE produto_id = v_pid2 AND unidade_id = v_barra AND variacao_id IS NULL;
  RAISE NOTICE '✅ Cleanup OK';
END $$;
```
Expected: 2 NOTICEs confirmando venda_id, total > 0, array com 2 itens, e cleanup OK.

- [ ] **Step 4: Smoke test rollback (estoque insuficiente)**

```sql
DO $$
DECLARE
  v_barra UUID := '368d47f5-2d88-4475-bc14-ba084a9a348e';
  v_pid INT;
  v_itens JSONB;
  v_count_vendas_antes INT;
  v_count_vendas_depois INT;
BEGIN
  SELECT produto_id INTO v_pid FROM loja_estoque
    WHERE unidade_id = v_barra ORDER BY produto_id LIMIT 1;
  v_itens := jsonb_build_array(
    jsonb_build_object('produto_id', v_pid, 'quantidade', 1),
    jsonb_build_object('produto_id', v_pid, 'quantidade', 999999)
  );
  SELECT COUNT(*) INTO v_count_vendas_antes FROM loja_vendas;

  BEGIN
    PERFORM registrar_venda_v2(
      p_unidade_id := v_barra, p_itens := v_itens,
      p_forma_pagamento := 'pix', p_via_audit := 'SMOKE_FAIL'
    );
    RAISE EXCEPTION 'deveria ter falhado!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%estoque_insuficiente%' THEN
      RAISE NOTICE '✅ Rollback OK — erro esperado: %', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  SELECT COUNT(*) INTO v_count_vendas_depois FROM loja_vendas;
  ASSERT v_count_vendas_depois = v_count_vendas_antes, 'rollback falhou - venda foi criada';
  RAISE NOTICE '✅ Nenhuma venda criada (rollback ACID)';
END $$;
```
Expected: NOTICE de erro esperado + NOTICE de rollback OK.

---

## Task 2: SP `registrar_entrada_estoque_v2` (multi-item + NF + custo)

**Files:**
- Create: `migrations/20260520_loja_sp_registrar_entrada_v2.sql`

- [ ] **Step 1: Escrever migration**

```sql
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

    -- Upsert estoque
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
```

- [ ] **Step 2: Aplicar migration via MCP**

`apply_migration` com `name="loja_sp_registrar_entrada_v2"`.

- [ ] **Step 3: Smoke test entrada multi-item**

```sql
DO $$
DECLARE
  v_barra UUID := '368d47f5-2d88-4475-bc14-ba084a9a348e';
  v_pid1 INT; v_pid2 INT;
  v_e1 INT; v_e2 INT;
  v_result JSONB;
BEGIN
  SELECT produto_id INTO v_pid1 FROM loja_estoque WHERE unidade_id=v_barra ORDER BY produto_id LIMIT 1;
  SELECT produto_id INTO v_pid2 FROM loja_estoque WHERE unidade_id=v_barra AND produto_id != v_pid1
    ORDER BY produto_id LIMIT 1;
  SELECT quantidade INTO v_e1 FROM loja_estoque WHERE produto_id=v_pid1 AND unidade_id=v_barra AND variacao_id IS NULL;
  SELECT quantidade INTO v_e2 FROM loja_estoque WHERE produto_id=v_pid2 AND unidade_id=v_barra AND variacao_id IS NULL;

  SELECT itens_resultado INTO v_result FROM registrar_entrada_estoque_v2(
    p_unidade_id := v_barra,
    p_itens := jsonb_build_array(
      jsonb_build_object('produto_id', v_pid1, 'quantidade', 3, 'custo_unitario', 15.5),
      jsonb_build_object('produto_id', v_pid2, 'quantidade', 5, 'custo_unitario', 22.0)
    ),
    p_nf := 'NF-001',
    p_fornecedor := 'Smoke Fornecedor',
    p_via_audit := 'SMOKE_E2'
  );
  RAISE NOTICE '✅ %', v_result;

  -- Cleanup
  DELETE FROM loja_movimentacoes_estoque WHERE observacoes LIKE '%SMOKE_E2%';
  UPDATE loja_estoque SET quantidade = v_e1
    WHERE produto_id = v_pid1 AND unidade_id = v_barra AND variacao_id IS NULL;
  UPDATE loja_estoque SET quantidade = v_e2
    WHERE produto_id = v_pid2 AND unidade_id = v_barra AND variacao_id IS NULL;
END $$;
```
Expected: NOTICE com array de 2 itens, cada um com `saldo_apos = saldo_antigo + quantidade`.

---

## Task 3: Endpoint `/api/lareport/loja/buscar-cliente`

**Files:**
- Create: `web/api/lareport/loja/buscar-cliente.ts`

- [ ] **Step 1: Inspecionar shape do `_lib`**

Use `mcp__plugin_context-mode_context-mode__ctx_execute` shell:
```bash
ls /d/la-organizer/_remote/web/api/_lib/ && head -20 /d/la-organizer/_remote/web/api/lareport/loja/buscar.ts
```
Confirmar nomes EXATOS: `requireCollaborator`, `checkAccess`, `lareport`. (Fase B usou esses.)

- [ ] **Step 2: Criar `web/api/lareport/loja/buscar-cliente.ts`**

```typescript
// Sprint Fase 2.1 — autocomplete server-side de aluno OU colaborador.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden', reason: access.reason });

  const tipo = String(req.query.tipo || '');
  const q = String(req.query.q || '').trim();
  const unidadeId = req.query.unidade_id ? String(req.query.unidade_id) : null;
  const limit = Math.min(parseInt(String(req.query.limit || '10'), 10) || 10, 25);

  if (!['aluno', 'colaborador'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo_invalido', allowed: ['aluno', 'colaborador'] });
  }
  if (q.length < 2) return res.status(200).json({ ok: true, results: [] });

  // Gerente/farmer força unidade própria pra aluno
  const effectiveUnidade = (tipo === 'aluno' && access.unitFilter) ? access.unitFilter : unidadeId;

  let query;
  if (tipo === 'aluno') {
    query = lareport.from('alunos')
      .select('id, nome, telefone, status, unidade_id')
      .eq('ativo', true)
      .ilike('nome', `%${q}%`)
      .order('nome')
      .limit(limit);
    if (effectiveUnidade) query = query.eq('unidade_id', effectiveUnidade);
  } else {
    query = lareport.from('colaboradores')
      .select('id, nome, telefone')
      .eq('ativo', true)
      .ilike('nome', `%${q}%`)
      .order('nome')
      .limit(limit);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, results: data ?? [] });
}

export default handler;
```

- [ ] **Step 3: Validar TS**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'buscar-cliente|error' | head -10
```
Expected: zero erros em `buscar-cliente.ts`.

---

## Task 4: Endpoint `/api/lareport/loja/buscar-professor`

**Files:**
- Create: `web/api/lareport/loja/buscar-professor.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
// Sprint Fase 2.1 — autocomplete de professor pra indicação de venda.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden' });

  const q = String(req.query.q || '').trim();
  const unidadeId = req.query.unidade_id ? String(req.query.unidade_id) : null;
  const limit = Math.min(parseInt(String(req.query.limit || '10'), 10) || 10, 25);
  if (q.length < 2) return res.status(200).json({ ok: true, results: [] });

  let query = lareport.from('professores')
    .select('id, nome, unidade_id')
    .eq('ativo', true)
    .ilike('nome', `%${q}%`)
    .order('nome')
    .limit(limit);
  // Gerente/farmer força unidade própria
  if (access.unitFilter) query = query.eq('unidade_id', access.unitFilter);
  else if (unidadeId) query = query.eq('unidade_id', unidadeId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, results: data ?? [] });
}

export default handler;
```

- [ ] **Step 2: Validar TS**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'buscar-professor|error' | head -10
```
Expected: zero erros.

---

## Task 5: Componentes `ClienteAutocomplete` + `ProfessorAutocomplete`

**Files:**
- Create: `web/src/components/ClienteAutocomplete.tsx`
- Create: `web/src/components/ProfessorAutocomplete.tsx`

- [ ] **Step 1: Inspecionar `authHeader` em `lareport-mutations.ts`**

```bash
grep -n "authHeader\|access_token\|Bearer" /d/la-organizer/_remote/web/src/lib/lareport-mutations.ts | head -5
```
Confirmar que `authHeader()` existe (foi criado na Fase B). Se não, criar fetch inline com `supabase.auth.getSession()`.

- [ ] **Step 2: Criar `ClienteAutocomplete.tsx`**

```tsx
// Sprint Fase 2.1 — autocomplete de aluno OU colaborador.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ClienteResult {
  id: number;
  nome: string;
  telefone?: string | null;
  status?: string | null;
  unidade_id?: string;
}

interface Props {
  tipo: 'aluno' | 'colaborador';
  unidadeId?: string;
  value?: ClienteResult | null;
  onChange: (cli: ClienteResult | null) => void;
  placeholder?: string;
}

async function fetchClientes(tipo: string, q: string, unidadeId?: string): Promise<ClienteResult[]> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.access_token) throw new Error('no_session');
  const qs = new URLSearchParams({ tipo, q });
  if (unidadeId) qs.set('unidade_id', unidadeId);
  const r = await fetch(`/api/lareport/loja/buscar-cliente?${qs}`, {
    headers: { Authorization: `Bearer ${sess.session.access_token}` },
  });
  if (!r.ok) throw new Error('busca_falhou');
  const j = await r.json();
  return (j.results || []) as ClienteResult[];
}

export function ClienteAutocomplete({ tipo, unidadeId, value, onChange, placeholder }: Props) {
  const [termo, setTermo] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(termo), 200);
    return () => clearTimeout(id);
  }, [termo]);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['cliente-search', tipo, debounced, unidadeId],
    queryFn: () => fetchClientes(tipo, debounced, unidadeId),
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="flex items-center gap-2 bg-bg-surface border border-border rounded-md p-2">
        <div className="flex-1">
          <div className="font-medium text-fg">{value.nome}</div>
          {value.telefone && <div className="text-sm text-fg-muted">{value.telefone}</div>}
        </div>
        <button type="button" onClick={() => { onChange(null); setTermo(''); }}
          className="text-tom underline text-sm">Trocar</button>
      </div>
    );
  }

  return (
    <div>
      <input type="text" value={termo} onChange={e => setTermo(e.target.value)}
        placeholder={placeholder || `Buscar ${tipo}...`}
        className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
      {isLoading && <div className="text-sm text-fg-muted mt-1">buscando...</div>}
      {results.length > 0 && (
        <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
          {results.map(r => (
            <button key={r.id} type="button" onClick={() => onChange(r)}
              className="w-full text-left p-2 rounded border border-border bg-bg-surface hover:bg-bg-elevated">
              <div className="font-medium text-fg">{r.nome}</div>
              {r.telefone && <div className="text-sm text-fg-muted">📱 {r.telefone}</div>}
              {r.status && <div className="text-xs text-fg-muted">status: {r.status}</div>}
            </button>
          ))}
        </div>
      )}
      {debounced.length >= 2 && !isLoading && results.length === 0 && (
        <div className="text-sm text-fg-muted mt-2">Nenhum {tipo} encontrado pra "{debounced}".</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Criar `ProfessorAutocomplete.tsx`**

```tsx
// Sprint Fase 2.1 — autocomplete de professor pra indicação.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ProfessorResult { id: number; nome: string; unidade_id?: string; }

interface Props {
  unidadeId?: string;
  value?: ProfessorResult | null;
  onChange: (p: ProfessorResult | null) => void;
}

async function fetchProfessores(q: string, unidadeId?: string): Promise<ProfessorResult[]> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.access_token) throw new Error('no_session');
  const qs = new URLSearchParams({ q });
  if (unidadeId) qs.set('unidade_id', unidadeId);
  const r = await fetch(`/api/lareport/loja/buscar-professor?${qs}`, {
    headers: { Authorization: `Bearer ${sess.session.access_token}` },
  });
  if (!r.ok) throw new Error('busca_falhou');
  const j = await r.json();
  return (j.results || []) as ProfessorResult[];
}

export function ProfessorAutocomplete({ unidadeId, value, onChange }: Props) {
  const [termo, setTermo] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(termo), 200);
    return () => clearTimeout(id);
  }, [termo]);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['professor-search', debounced, unidadeId],
    queryFn: () => fetchProfessores(debounced, unidadeId),
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="flex items-center gap-2 bg-bg-surface border border-border rounded-md p-2">
        <div className="flex-1 font-medium text-fg">🎓 {value.nome}</div>
        <button type="button" onClick={() => { onChange(null); setTermo(''); }}
          className="text-tom underline text-sm">Trocar</button>
      </div>
    );
  }

  return (
    <div>
      <input type="text" value={termo} onChange={e => setTermo(e.target.value)}
        placeholder="Nome do professor..."
        className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
      {isLoading && <div className="text-sm text-fg-muted mt-1">buscando...</div>}
      {results.length > 0 && (
        <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
          {results.map(p => (
            <button key={p.id} type="button" onClick={() => onChange(p)}
              className="w-full text-left p-2 rounded border border-border bg-bg-surface hover:bg-bg-elevated">
              <div className="font-medium text-fg">{p.nome}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Validar TS**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'Autocomplete|error' | head -10
```
Expected: zero erros.

---

## Task 6: Mutations + endpoints v2

**Files:**
- Modify: `web/src/lib/lareport-mutations.ts`
- Modify: `web/api/lareport/loja/venda.ts`
- Modify: `web/api/lareport/loja/entrada.ts`

- [ ] **Step 1: Adicionar mutations no `lareport-mutations.ts`**

Append no final do arquivo:
```typescript
// ============================================================
// Sprint Fase 2.1 — Venda Rica + Entrada Rica
// ============================================================

export interface VendaItem {
  produto_id: number;
  variacao_id?: number | null;
  quantidade: number;
  preco_unitario_override?: number | null;
}
export interface VendaMultiInput {
  unidade_id: string;
  itens: VendaItem[];
  forma_pagamento: 'pix' | 'credito' | 'debito' | 'dinheiro' | 'folha' | 'saldo';
  tipo_cliente?: 'aluno' | 'avulso' | 'colaborador';
  cliente_nome?: string | null;
  aluno_id?: number | null;
  colaborador_cliente_id?: number | null;
  professor_indicador_id?: number | null;
  desconto?: number;
  desconto_tipo?: 'valor' | 'percentual';
  parcelas?: number;
  observacoes?: string | null;
}
export interface VendaMultiResult {
  ok: boolean;
  venda_id: number;
  total: number;
  itens_resultado: Array<{ produto_id: number; saldo_apos: number; quantidade: number }>;
  comissao_professor: number;
}
export async function registrarVendaMulti(input: VendaMultiInput): Promise<VendaMultiResult> {
  return callApi<VendaMultiResult>('/api/lareport/loja/venda', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export interface EntradaItem {
  produto_id: number;
  variacao_id?: number | null;
  quantidade: number;
  custo_unitario?: number | null;
}
export interface EntradaMultiInput {
  unidade_id: string;
  itens: EntradaItem[];
  nf?: string | null;
  fornecedor?: string | null;
  observacoes?: string | null;
}
export async function registrarEntradaMulti(input: EntradaMultiInput): Promise<{ ok: boolean; itens_resultado: any[] }> {
  return callApi('/api/lareport/loja/entrada', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export interface ClienteResultMutation { id: number; nome: string; telefone?: string | null; status?: string | null; }
export async function buscarCliente(tipo: 'aluno' | 'colaborador', q: string, unidade_id?: string | null): Promise<ClienteResultMutation[]> {
  const qs = new URLSearchParams({ tipo, q });
  if (unidade_id) qs.set('unidade_id', unidade_id);
  const r = await callApi<{ ok: boolean; results: ClienteResultMutation[] }>(`/api/lareport/loja/buscar-cliente?${qs}`, { method: 'GET' });
  return r.results;
}
export async function buscarProfessor(q: string, unidade_id?: string | null): Promise<{ id: number; nome: string }[]> {
  const qs = new URLSearchParams({ q });
  if (unidade_id) qs.set('unidade_id', unidade_id);
  const r = await callApi<{ ok: boolean; results: { id: number; nome: string }[] }>(`/api/lareport/loja/buscar-professor?${qs}`, { method: 'GET' });
  return r.results;
}
```

- [ ] **Step 2: Atualizar `web/api/lareport/loja/venda.ts` pra multi-item**

Substitui o handler atual por:
```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';

interface VendaPayload {
  unidade_id: string;
  itens?: Array<{
    produto_id: number; variacao_id?: number | null;
    quantidade: number; preco_unitario_override?: number | null;
  }>;
  // legacy single-item fields (compat)
  produto_id?: number;
  quantidade?: number;
  variacao_id?: number | null;
  forma_pagamento: 'pix' | 'credito' | 'debito' | 'dinheiro' | 'folha' | 'saldo';
  tipo_cliente?: 'aluno' | 'avulso' | 'colaborador';
  cliente_nome?: string | null;
  aluno_id?: number | null;
  colaborador_cliente_id?: number | null;
  professor_indicador_id?: number | null;
  desconto?: number;
  desconto_tipo?: 'valor' | 'percentual';
  parcelas?: number;
  observacoes?: string | null;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden', reason: access.reason });

  const body = req.body as VendaPayload;
  if (!body?.unidade_id || !body?.forma_pagamento) {
    return res.status(400).json({ error: 'missing_required_fields',
      required: ['unidade_id', 'forma_pagamento', 'itens (ou produto_id+quantidade)'] });
  }
  if (access.unitFilter && body.unidade_id !== access.unitFilter) {
    return res.status(403).json({ error: 'unit_filter_denied' });
  }

  // Compat: converte legacy single-item pra array
  let itens = body.itens;
  if (!itens && body.produto_id && body.quantidade) {
    itens = [{ produto_id: body.produto_id, variacao_id: body.variacao_id ?? null, quantidade: body.quantidade }];
  }
  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: 'itens_vazios' });
  }

  const viaAudit = `via PWA por ${collab.full_name}`;

  const { data, error } = await lareport.rpc('registrar_venda_v2', {
    p_unidade_id: body.unidade_id,
    p_itens: itens,
    p_forma_pagamento: body.forma_pagamento,
    p_via_audit: viaAudit,
    p_tipo_cliente: body.tipo_cliente ?? 'avulso',
    p_cliente_nome: body.cliente_nome ?? null,
    p_aluno_id: body.aluno_id ?? null,
    p_colaborador_cliente_id: body.colaborador_cliente_id ?? null,
    p_professor_indicador_id: body.professor_indicador_id ?? null,
    p_desconto: body.desconto ?? 0,
    p_desconto_tipo: body.desconto_tipo ?? 'valor',
    p_parcelas: body.parcelas ?? 1,
    p_observacoes: body.observacoes ?? null,
  });
  if (error) {
    const status = /insuficiente|inexistente|invalid|obrigatorio|vazios|maior/.test(error.message) ? 400 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ ok: true, ...(data?.[0] ?? {}) });
}

export default handler;
```

- [ ] **Step 3: Atualizar `web/api/lareport/loja/entrada.ts` pra multi-item**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';

interface EntradaPayload {
  unidade_id: string;
  itens?: Array<{ produto_id: number; variacao_id?: number | null; quantidade: number; custo_unitario?: number | null }>;
  // legacy single-item
  produto_id?: number; quantidade?: number; variacao_id?: number | null;
  nf?: string | null;
  fornecedor?: string | null;
  observacoes?: string | null;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden' });

  const body = req.body as EntradaPayload;
  if (!body?.unidade_id) return res.status(400).json({ error: 'unidade_id_obrigatorio' });
  if (access.unitFilter && body.unidade_id !== access.unitFilter) {
    return res.status(403).json({ error: 'unit_filter_denied' });
  }

  let itens = body.itens;
  if (!itens && body.produto_id && body.quantidade) {
    itens = [{ produto_id: body.produto_id, variacao_id: body.variacao_id ?? null, quantidade: body.quantidade }];
  }
  if (!itens || itens.length === 0) return res.status(400).json({ error: 'itens_vazios' });

  const viaAudit = `via PWA por ${collab.full_name}`;
  const { data, error } = await lareport.rpc('registrar_entrada_estoque_v2', {
    p_unidade_id: body.unidade_id,
    p_itens: itens,
    p_via_audit: viaAudit,
    p_nf: body.nf ?? null,
    p_fornecedor: body.fornecedor ?? null,
    p_observacoes: body.observacoes ?? null,
  });
  if (error) {
    const status = /invalida|inexistente|inativo|obrigatorio|vazios/.test(error.message) ? 400 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ ok: true, ...(data?.[0] ?? {}) });
}

export default handler;
```

- [ ] **Step 4: Validar TS completo**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | tail -10
```
Expected: zero erros.

---

## Task 7: `VendaWizardSheet` (stepper 3 passos)

**Files:**
- Create: `web/src/screens/inventario/components/VendaWizardSheet.tsx`

- [ ] **Step 1: Criar arquivo**

```tsx
// Sprint Fase 2.1 — Stepper de venda 3 passos.
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { Field } from '../../../components/Field';
import { ClienteAutocomplete, type ClienteResult } from '../../../components/ClienteAutocomplete';
import { ProfessorAutocomplete, type ProfessorResult } from '../../../components/ProfessorAutocomplete';
import { useProdutoSearch } from '../../../hooks/useLaReport';
import { registrarVendaMulti, type VendaItem, type VendaMultiInput } from '../../../lib/lareport-mutations';
import { showToast } from '../../../components/Toast';

interface Props { open: boolean; onClose: () => void; unidadeId: string; }

interface CartItem { produto_id: number; nome: string; preco: number; quantidade: number; }

const FORMAS = [
  { value: 'pix', label: 'PIX' },
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'folha', label: 'Folha' },
  { value: 'saldo', label: 'Saldo (carteira)' },
];
type TipoCliente = 'aluno' | 'avulso' | 'colaborador';

export function VendaWizardSheet({ open, onClose, unidadeId }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // STEP 1 — produtos
  const [termo, setTermo] = useState('');
  const { data: produtosMatch = [] } = useProdutoSearch(termo, unidadeId);
  const [carrinho, setCarrinho] = useState<CartItem[]>([]);

  const addProduto = (p: { id: number; nome: string; preco: number }) => {
    setCarrinho(c => {
      const existe = c.find(i => i.produto_id === p.id);
      if (existe) return c.map(i => i.produto_id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      return [...c, { produto_id: p.id, nome: p.nome, preco: p.preco, quantidade: 1 }];
    });
    setTermo('');
  };
  const updateQtd = (pid: number, qtd: number) => {
    if (qtd <= 0) setCarrinho(c => c.filter(i => i.produto_id !== pid));
    else setCarrinho(c => c.map(i => i.produto_id === pid ? { ...i, quantidade: qtd } : i));
  };

  // STEP 2 — cliente
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>('avulso');
  const [cliente, setCliente] = useState<ClienteResult | null>(null);
  const [clienteNomeLivre, setClienteNomeLivre] = useState('');
  const [professor, setProfessor] = useState<ProfessorResult | null>(null);

  // STEP 3 — pagamento
  const [formaPgto, setFormaPgto] = useState<VendaMultiInput['forma_pagamento']>('pix');
  const [parcelas, setParcelas] = useState(1);
  const [desconto, setDesconto] = useState(0);
  const [descontoTipo, setDescontoTipo] = useState<'valor' | 'percentual'>('valor');
  const [obs, setObs] = useState('');
  const [enviarWA, setEnviarWA] = useState(true);

  const subtotal = useMemo(() => carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0), [carrinho]);
  const descontoCalc = useMemo(() => {
    if (descontoTipo === 'percentual') return subtotal * (desconto / 100);
    return desconto;
  }, [subtotal, desconto, descontoTipo]);
  const total = Math.max(0, subtotal - descontoCalc);

  const reset = () => {
    setStep(1); setTermo(''); setCarrinho([]);
    setTipoCliente('avulso'); setCliente(null); setClienteNomeLivre(''); setProfessor(null);
    setFormaPgto('pix'); setParcelas(1); setDesconto(0); setDescontoTipo('valor');
    setObs(''); setEnviarWA(true);
  };

  const venda = useMutation({
    mutationFn: () => {
      const itens: VendaItem[] = carrinho.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade }));
      const input: VendaMultiInput = {
        unidade_id: unidadeId,
        itens,
        forma_pagamento: formaPgto,
        tipo_cliente: tipoCliente,
        cliente_nome: tipoCliente === 'avulso' ? (clienteNomeLivre.trim() || null) : (cliente?.nome ?? null),
        aluno_id: tipoCliente === 'aluno' ? (cliente?.id ?? null) : null,
        colaborador_cliente_id: tipoCliente === 'colaborador' ? (cliente?.id ?? null) : null,
        professor_indicador_id: professor?.id ?? null,
        desconto: desconto > 0 ? desconto : 0,
        desconto_tipo: descontoTipo,
        parcelas: formaPgto === 'credito' ? parcelas : 1,
        observacoes: obs.trim() || null,
      };
      return registrarVendaMulti(input);
    },
    onSuccess: (r) => {
      showToast({ kind: 'success', title: 'Venda registrada',
        msg: `${carrinho.length} item(s). Total R$${r.total.toFixed(2)}.` });
      qc.invalidateQueries({ queryKey: ['lareport', 'loja', unidadeId] });
      reset(); onClose();
    },
    onError: (e: Error) => showToast({ kind: 'error', title: 'Falha na venda', msg: e.message }),
  });

  const canAdvance1 = carrinho.length > 0;
  const canAdvance2 = tipoCliente === 'avulso' ? true : !!cliente;
  const canFinalize = total > 0 && !venda.isPending;

  return (
    <BottomSheet open={open} onClose={() => { reset(); onClose(); }} title={`💰 Venda — passo ${step}/3`}>
      <div className="space-y-md pb-lg">

        {/* Carrinho sticky no topo (sempre visível nos passos 2-3) */}
        {step > 1 && carrinho.length > 0 && (
          <div className="bg-bg-elevated rounded-md p-2 text-sm">
            🛒 {carrinho.length} item(s) · R${subtotal.toFixed(2)}
          </div>
        )}

        {step === 1 && (
          <>
            <Field label="Buscar produto">
              <input type="text" value={termo} onChange={e => setTermo(e.target.value)}
                placeholder="Ex: baqueta, caderno..."
                className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
            </Field>
            {produtosMatch.length > 0 && (
              <div className="space-y-1">
                {produtosMatch.map(p => (
                  <button key={p.id} type="button"
                    onClick={() => addProduto({ id: p.id, nome: p.nome, preco: p.preco })}
                    className="w-full text-left p-2 rounded border border-border bg-bg-surface">
                    <div className="font-medium text-fg">{p.nome}</div>
                    <div className="text-sm text-fg-muted">R${p.preco.toFixed(2)} · estoque: {p.estoque}</div>
                  </button>
                ))}
              </div>
            )}
            {carrinho.length > 0 && (
              <div className="border border-border rounded-md p-2 space-y-2">
                <div className="text-sm font-semibold">Carrinho</div>
                {carrinho.map(i => (
                  <div key={i.produto_id} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{i.nome}</div>
                      <div className="text-xs text-fg-muted">R${i.preco.toFixed(2)} × {i.quantidade} = R${(i.preco * i.quantidade).toFixed(2)}</div>
                    </div>
                    <button onClick={() => updateQtd(i.produto_id, i.quantidade - 1)} className="w-8 h-8 rounded bg-bg-elevated">−</button>
                    <span className="w-6 text-center">{i.quantidade}</span>
                    <button onClick={() => updateQtd(i.produto_id, i.quantidade + 1)} className="w-8 h-8 rounded bg-bg-elevated">+</button>
                  </div>
                ))}
                <div className="pt-1 border-t border-border text-right font-semibold">Subtotal: R${subtotal.toFixed(2)}</div>
              </div>
            )}
            <Button variant="primary" size="lg" onClick={() => setStep(2)} disabled={!canAdvance1}>Avançar →</Button>
          </>
        )}

        {step === 2 && (
          <>
            <Field label="Tipo de cliente">
              <div className="flex gap-2">
                {(['avulso','aluno','colaborador'] as TipoCliente[]).map(t => (
                  <button key={t} type="button"
                    onClick={() => { setTipoCliente(t); setCliente(null); setClienteNomeLivre(''); }}
                    className={`flex-1 p-2 rounded border ${tipoCliente === t ? 'border-tom bg-bg-app' : 'border-border bg-bg-surface'}`}>
                    {t === 'aluno' ? '🎓' : t === 'colaborador' ? '👔' : '🙋'} {t}
                  </button>
                ))}
              </div>
            </Field>

            {tipoCliente === 'aluno' && (
              <Field label="Aluno">
                <ClienteAutocomplete tipo="aluno" unidadeId={unidadeId} value={cliente} onChange={setCliente}/>
              </Field>
            )}
            {tipoCliente === 'colaborador' && (
              <Field label="Colaborador">
                <ClienteAutocomplete tipo="colaborador" value={cliente} onChange={setCliente}/>
              </Field>
            )}
            {tipoCliente === 'avulso' && (
              <Field label="Nome do cliente (opcional)">
                <input type="text" value={clienteNomeLivre} onChange={e => setClienteNomeLivre(e.target.value)}
                  className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
              </Field>
            )}

            <Field label="Indicado por professor? (opcional, comissão 5%)">
              <ProfessorAutocomplete unidadeId={unidadeId} value={professor} onChange={setProfessor}/>
            </Field>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep(1)}>← Voltar</Button>
              <Button variant="primary" onClick={() => setStep(3)} disabled={!canAdvance2}>Avançar →</Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Field label="Forma de pagamento">
              <CustomSelect value={formaPgto} options={FORMAS}
                onChange={v => setFormaPgto(v as VendaMultiInput['forma_pagamento'])} size="md"/>
            </Field>
            {formaPgto === 'credito' && (
              <Field label="Parcelas">
                <input type="number" min={1} max={12} value={parcelas}
                  onChange={e => setParcelas(Math.max(1, Math.min(12, Number(e.target.value))))}
                  className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
              </Field>
            )}
            <Field label="Desconto (opcional)">
              <div className="flex gap-2">
                <input type="number" min={0} step="0.01" value={desconto}
                  onChange={e => setDesconto(Math.max(0, Number(e.target.value)))}
                  className="flex-1 bg-bg-surface border border-border rounded-md p-2 text-fg"/>
                <CustomSelect value={descontoTipo}
                  options={[{ value: 'valor', label: 'R$' }, { value: 'percentual', label: '%' }]}
                  onChange={v => setDescontoTipo(v as 'valor' | 'percentual')} size="md"/>
              </div>
            </Field>

            <div className="bg-bg-elevated rounded-md p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span>Subtotal:</span><span>R${subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-fg-muted"><span>Desconto:</span><span>− R${descontoCalc.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-lg pt-1 border-t border-border"><span>Total:</span><span>R${total.toFixed(2)}</span></div>
            </div>

            {tipoCliente === 'aluno' && cliente?.telefone && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enviarWA} onChange={e => setEnviarWA(e.target.checked)}/>
                📲 Enviar comprovante por WhatsApp pra {cliente.telefone}
              </label>
            )}

            <Field label="Observações (opcional)">
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
                className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
            </Field>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep(2)}>← Voltar</Button>
              <Button variant="primary" size="lg" onClick={() => venda.mutate()} disabled={!canFinalize}>
                {venda.isPending ? 'Registrando...' : `Finalizar Venda (R$${total.toFixed(2)})`}
              </Button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Validar TS**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'VendaWizardSheet|error' | head -15
```
Expected: zero erros.

---

## Task 8: `EntradaRicaSheet` (multi-item + NF + custo)

**Files:**
- Create: `web/src/screens/inventario/components/EntradaRicaSheet.tsx`

- [ ] **Step 1: Criar arquivo**

```tsx
// Sprint Fase 2.1 — entrada rica com NF, fornecedor, custo e multi-item.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { useProdutoSearch } from '../../../hooks/useLaReport';
import { registrarEntradaMulti, type EntradaItem } from '../../../lib/lareport-mutations';
import { showToast } from '../../../components/Toast';

interface Props { open: boolean; onClose: () => void; unidadeId: string; }
interface LinhaEntrada { tempId: string; produto_id: number | null; nome: string; quantidade: number; custo_unitario: number; termo: string; }

export function EntradaRicaSheet({ open, onClose, unidadeId }: Props) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState<LinhaEntrada[]>([
    { tempId: '1', produto_id: null, nome: '', quantidade: 1, custo_unitario: 0, termo: '' },
  ]);
  const [nf, setNf] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [obs, setObs] = useState('');

  const totalEntrada = linhas.reduce((s, l) => s + l.quantidade * l.custo_unitario, 0);

  const updateLinha = (tempId: string, patch: Partial<LinhaEntrada>) => {
    setLinhas(arr => arr.map(l => l.tempId === tempId ? { ...l, ...patch } : l));
  };
  const addLinha = () => setLinhas(a => [...a, { tempId: String(Date.now()), produto_id: null, nome: '', quantidade: 1, custo_unitario: 0, termo: '' }]);
  const rmLinha = (tempId: string) => setLinhas(a => a.length > 1 ? a.filter(l => l.tempId !== tempId) : a);

  const reset = () => { setLinhas([{ tempId: '1', produto_id: null, nome: '', quantidade: 1, custo_unitario: 0, termo: '' }]); setNf(''); setFornecedor(''); setObs(''); };

  const entrada = useMutation({
    mutationFn: () => {
      const validas = linhas.filter(l => l.produto_id && l.quantidade > 0);
      if (validas.length === 0) throw new Error('Adicione pelo menos 1 produto válido');
      const itens: EntradaItem[] = validas.map(l => ({
        produto_id: l.produto_id!,
        quantidade: l.quantidade,
        custo_unitario: l.custo_unitario > 0 ? l.custo_unitario : null,
      }));
      return registrarEntradaMulti({
        unidade_id: unidadeId, itens,
        nf: nf.trim() || null, fornecedor: fornecedor.trim() || null, observacoes: obs.trim() || null,
      });
    },
    onSuccess: () => {
      showToast({ kind: 'success', title: 'Entrada registrada', msg: `${linhas.length} item(s).` });
      qc.invalidateQueries({ queryKey: ['lareport', 'loja', unidadeId] });
      reset(); onClose();
    },
    onError: (e: Error) => showToast({ kind: 'error', title: 'Falha', msg: e.message }),
  });

  return (
    <BottomSheet open={open} onClose={() => { reset(); onClose(); }} title="📦 Entrada de estoque">
      <div className="space-y-md pb-lg">
        <div className="grid grid-cols-2 gap-2">
          <Field label="NF (opcional)">
            <input type="text" value={nf} onChange={e => setNf(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
          </Field>
          <Field label="Fornecedor (opcional)">
            <input type="text" value={fornecedor} onChange={e => setFornecedor(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
          </Field>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-semibold text-fg-muted">Itens recebidos</div>
          {linhas.map((l, idx) => (
            <LinhaProduto key={l.tempId} linha={l} unidadeId={unidadeId} idx={idx + 1}
              onUpdate={p => updateLinha(l.tempId, p)} onRemove={() => rmLinha(l.tempId)} canRemove={linhas.length > 1}/>
          ))}
          <Button variant="ghost" onClick={addLinha}>+ Adicionar item</Button>
        </div>

        <div className="bg-bg-elevated rounded-md p-3 text-sm font-semibold flex justify-between">
          <span>Total da entrada:</span><span>R${totalEntrada.toFixed(2)}</span>
        </div>

        <Field label="Observações (opcional)">
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
        </Field>

        <Button variant="primary" size="lg" onClick={() => entrada.mutate()} disabled={entrada.isPending}>
          {entrada.isPending ? 'Lançando...' : 'Lançar entrada'}
        </Button>
      </div>
    </BottomSheet>
  );
}

function LinhaProduto({ linha, unidadeId, idx, onUpdate, onRemove, canRemove }: {
  linha: LinhaEntrada; unidadeId: string; idx: number;
  onUpdate: (p: Partial<LinhaEntrada>) => void; onRemove: () => void; canRemove: boolean;
}) {
  const { data: matches = [] } = useProdutoSearch(linha.termo, unidadeId);

  return (
    <div className="border border-border rounded-md p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">item #{idx}</span>
        {canRemove && <button onClick={onRemove} className="text-xs text-fg-muted underline">remover</button>}
      </div>
      {linha.produto_id ? (
        <div className="flex items-center justify-between bg-bg-surface p-2 rounded">
          <span className="font-medium">{linha.nome}</span>
          <button onClick={() => onUpdate({ produto_id: null, nome: '', termo: '' })}
            className="text-tom underline text-sm">Trocar</button>
        </div>
      ) : (
        <>
          <input type="text" value={linha.termo} onChange={e => onUpdate({ termo: e.target.value })}
            placeholder="Buscar produto..."
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
          {matches.length > 0 && (
            <div className="space-y-1">
              {matches.slice(0, 5).map(m => (
                <button key={m.id} onClick={() => onUpdate({ produto_id: m.id, nome: m.nome, termo: '' })}
                  className="w-full text-left p-2 rounded border border-border bg-bg-surface">
                  {m.nome}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantidade">
          <input type="number" min={1} value={linha.quantidade}
            onChange={e => onUpdate({ quantidade: Math.max(1, Number(e.target.value)) })}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
        </Field>
        <Field label="Custo unit. (R$)">
          <input type="number" min={0} step="0.01" value={linha.custo_unitario}
            onChange={e => onUpdate({ custo_unitario: Math.max(0, Number(e.target.value)) })}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg"/>
        </Field>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'EntradaRicaSheet|error' | head -10
```
Expected: zero erros.

---

## Task 9: Trocar sheets na LojaPage

**Files:**
- Modify: `web/src/screens/inventario/LojaPage.tsx`

- [ ] **Step 1: Substituir imports e refs**

Trocar:
- `import { VendaSheet } from './components/VendaSheet';` → `import { VendaWizardSheet } from './components/VendaWizardSheet';`
- `import { EntradaEstoqueSheet } from './components/EntradaEstoqueSheet';` → `import { EntradaRicaSheet } from './components/EntradaRicaSheet';`
- Uso `<VendaSheet ... />` → `<VendaWizardSheet open={vendaOpen} onClose={() => setVendaOpen(false)} unidadeId={unidadeId} />`
- Uso `<EntradaEstoqueSheet ... />` → `<EntradaRicaSheet open={entradaOpen} onClose={() => setEntradaOpen(false)} unidadeId={unidadeId} />`

Sheets antigas (`VendaSheet.tsx`, `EntradaEstoqueSheet.tsx`) ficam no repo por 1 sprint (sem importar) — apagar em task de cleanup futura.

- [ ] **Step 2: Validar TS + build**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | tail -10
```
Expected: zero erros.

---

# FASE 2.2 — CRUD Produto + Transferência

## Task 10: Migration — adicionar tipos de movimentação de transferência

**Files:**
- Create: `migrations/20260520_loja_mov_tipo_transferencia.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- Adiciona 'saida_transferencia' e 'entrada_transferencia' no CHECK
ALTER TABLE loja_movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS loja_movimentacoes_estoque_tipo_check;
ALTER TABLE loja_movimentacoes_estoque
  ADD CONSTRAINT loja_movimentacoes_estoque_tipo_check
  CHECK (tipo IN ('entrada','venda','estorno','ajuste','saida_transferencia','entrada_transferencia'));
```

- [ ] **Step 2: Aplicar via MCP**

`apply_migration` com `name="loja_mov_tipo_transferencia"`.

- [ ] **Step 3: Smoke test (insere row com tipo novo + rollback)**

```sql
DO $$
DECLARE v_pid INT; v_uid UUID := '368d47f5-2d88-4475-bc14-ba084a9a348e';
BEGIN
  SELECT produto_id INTO v_pid FROM loja_estoque WHERE unidade_id=v_uid LIMIT 1;
  INSERT INTO loja_movimentacoes_estoque (produto_id, unidade_id, tipo, quantidade, saldo_apos, observacoes)
  VALUES (v_pid, v_uid, 'saida_transferencia', -1, 0, 'SMOKE');
  DELETE FROM loja_movimentacoes_estoque WHERE observacoes='SMOKE';
  RAISE NOTICE '✅ tipo saida_transferencia aceito';
END $$;
```
Expected: NOTICE confirma.

---

## Task 11: SP `transferir_estoque`

**Files:**
- Create: `migrations/20260520_loja_sp_transferir_estoque.sql`

- [ ] **Step 1: Escrever SP**

```sql
CREATE OR REPLACE FUNCTION public.transferir_estoque(
  p_produto_id      INT,
  p_unidade_origem  UUID,
  p_unidade_destino UUID,
  p_quantidade      INT,
  p_motivo          TEXT,
  p_via_audit       TEXT,
  p_variacao_id     INT DEFAULT NULL
) RETURNS TABLE (saldo_origem INT, saldo_destino INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_saldo_origem INT; v_saldo_destino INT;
BEGIN
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN RAISE EXCEPTION 'quantidade_invalida'; END IF;
  IF p_unidade_origem = p_unidade_destino THEN RAISE EXCEPTION 'origem_igual_destino'; END IF;
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN RAISE EXCEPTION 'motivo_obrigatorio'; END IF;
  IF p_via_audit IS NULL OR LENGTH(TRIM(p_via_audit)) = 0 THEN RAISE EXCEPTION 'via_audit_obrigatorio'; END IF;

  -- Lock origem
  SELECT quantidade INTO v_saldo_origem FROM loja_estoque
    WHERE produto_id = p_produto_id AND unidade_id = p_unidade_origem
      AND (variacao_id IS NOT DISTINCT FROM p_variacao_id) FOR UPDATE;
  IF v_saldo_origem IS NULL THEN RAISE EXCEPTION 'estoque_origem_inexistente'; END IF;
  IF v_saldo_origem < p_quantidade THEN
    RAISE EXCEPTION 'estoque_origem_insuficiente: tem=%, pediu=%', v_saldo_origem, p_quantidade;
  END IF;
  v_saldo_origem := v_saldo_origem - p_quantidade;

  -- Debita origem
  UPDATE loja_estoque SET quantidade = v_saldo_origem, updated_at = NOW()
    WHERE produto_id = p_produto_id AND unidade_id = p_unidade_origem
      AND (variacao_id IS NOT DISTINCT FROM p_variacao_id);

  -- Credita destino (upsert)
  IF p_variacao_id IS NULL THEN
    INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade, updated_at)
    VALUES (p_produto_id, NULL, p_unidade_destino, p_quantidade, NOW())
    ON CONFLICT (produto_id, unidade_id) WHERE variacao_id IS NULL
    DO UPDATE SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade, updated_at = NOW()
    RETURNING quantidade INTO v_saldo_destino;
  ELSE
    INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade, updated_at)
    VALUES (p_produto_id, p_variacao_id, p_unidade_destino, p_quantidade, NOW())
    ON CONFLICT (produto_id, variacao_id, unidade_id) WHERE variacao_id IS NOT NULL
    DO UPDATE SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade, updated_at = NOW()
    RETURNING quantidade INTO v_saldo_destino;
  END IF;

  -- 2 movimentações com referência cruzada via observações
  INSERT INTO loja_movimentacoes_estoque (produto_id, variacao_id, unidade_id, tipo, quantidade, saldo_apos, colaborador_id, observacoes)
  VALUES (p_produto_id, p_variacao_id, p_unidade_origem, 'saida_transferencia', -p_quantidade, v_saldo_origem, NULL,
    CONCAT('Transfer ', p_motivo, ' (destino=', p_unidade_destino, ') — ', p_via_audit));
  INSERT INTO loja_movimentacoes_estoque (produto_id, variacao_id, unidade_id, tipo, quantidade, saldo_apos, colaborador_id, observacoes)
  VALUES (p_produto_id, p_variacao_id, p_unidade_destino, 'entrada_transferencia', p_quantidade, v_saldo_destino, NULL,
    CONCAT('Transfer ', p_motivo, ' (origem=', p_unidade_origem, ') — ', p_via_audit));

  RETURN QUERY SELECT v_saldo_origem, v_saldo_destino;
END;
$$;
```

- [ ] **Step 2: Aplicar via MCP**

`apply_migration` com `name="loja_sp_transferir_estoque"`.

- [ ] **Step 3: Smoke test transferência Barra → Recreio**

```sql
DO $$
DECLARE
  v_origem UUID := '368d47f5-2d88-4475-bc14-ba084a9a348e';
  v_destino UUID := '95553e96-971b-4590-a6eb-0201d013c14d';
  v_pid INT;
  v_o_antes INT; v_d_antes INT;
  v_r RECORD;
BEGIN
  SELECT produto_id INTO v_pid FROM loja_estoque
    WHERE unidade_id = v_origem AND quantidade >= 3 LIMIT 1;
  SELECT quantidade INTO v_o_antes FROM loja_estoque WHERE produto_id=v_pid AND unidade_id=v_origem AND variacao_id IS NULL;
  SELECT COALESCE(quantidade, 0) INTO v_d_antes FROM loja_estoque WHERE produto_id=v_pid AND unidade_id=v_destino AND variacao_id IS NULL;

  SELECT * INTO v_r FROM transferir_estoque(
    p_produto_id := v_pid, p_unidade_origem := v_origem, p_unidade_destino := v_destino,
    p_quantidade := 2, p_motivo := 'realocação smoke', p_via_audit := 'SMOKE_TRANSFER'
  );
  ASSERT v_r.saldo_origem = v_o_antes - 2, 'saldo origem incorreto';
  ASSERT v_r.saldo_destino = v_d_antes + 2, 'saldo destino incorreto';
  RAISE NOTICE '✅ Transfer OK — origem=% destino=%', v_r.saldo_origem, v_r.saldo_destino;

  -- Cleanup
  DELETE FROM loja_movimentacoes_estoque WHERE observacoes LIKE '%SMOKE_TRANSFER%';
  UPDATE loja_estoque SET quantidade = v_o_antes WHERE produto_id=v_pid AND unidade_id=v_origem AND variacao_id IS NULL;
  IF v_d_antes = 0 THEN
    DELETE FROM loja_estoque WHERE produto_id=v_pid AND unidade_id=v_destino AND variacao_id IS NULL AND quantidade = 2;
  ELSE
    UPDATE loja_estoque SET quantidade = v_d_antes WHERE produto_id=v_pid AND unidade_id=v_destino AND variacao_id IS NULL;
  END IF;
END $$;
```

---

## Task 12-14: Endpoints CRUD de produto

**Task 12: `produto/upsert.ts`** — body `{id?, nome, categoria_id, sku?, preco, custo?, estoque_minimo?, comissao_especial?, foto_url?, descricao?, disponivel_whatsapp?, ativo?}`. Sem id → INSERT em `loja_produtos`. Com id → UPDATE. SKU auto-gera `CAT-<id>` se vazio em INSERT.

**Task 13: `produto/desativar.ts`** — body `{id}`. UPDATE `loja_produtos SET ativo=false`.

**Task 14: `produto/similar.ts`** — query `?nome=...`. Retorna produtos com `similarity(nome, $1) > 0.7`. LIMIT 5.

Cada um segue exatamente o padrão dos endpoints da Fase B (requireCollaborator, checkAccess, sem unitFilter aqui — produto é global). Subagent escreve com base no template do `/buscar.ts` da Fase B + ajuste do escopo.

(Detalhes inline omitidos por brevidade — código completo é direto pattern dos endpoints existentes, escopo claro.)

---

## Task 15: Endpoint `/transferencia`

**Files:**
- Create: `web/api/lareport/loja/transferencia.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';

interface Payload {
  produto_id: number; unidade_origem: string; unidade_destino: string;
  quantidade: number; motivo: string; variacao_id?: number | null;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res); if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden' });

  const body = req.body as Payload;
  if (!body?.produto_id || !body?.unidade_origem || !body?.unidade_destino
      || !body?.quantidade || !body?.motivo) {
    return res.status(400).json({ error: 'missing_required_fields' });
  }
  // Gerente/farmer só transfere DA própria unidade
  if (access.unitFilter && body.unidade_origem !== access.unitFilter) {
    return res.status(403).json({ error: 'unit_filter_origem_denied' });
  }

  const { data, error } = await lareport.rpc('transferir_estoque', {
    p_produto_id: body.produto_id,
    p_unidade_origem: body.unidade_origem,
    p_unidade_destino: body.unidade_destino,
    p_quantidade: body.quantidade,
    p_motivo: body.motivo,
    p_via_audit: `via PWA por ${collab.full_name}`,
    p_variacao_id: body.variacao_id ?? null,
  });
  if (error) {
    const status = /insuficiente|inexistente|igual|invalida|obrigatorio/.test(error.message) ? 400 : 500;
    return res.status(status).json({ error: error.message });
  }
  return res.status(200).json({ ok: true, ...(data?.[0] ?? {}) });
}

export default handler;
```

- [ ] **Step 2: Validar TS**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'transferencia|error' | head -10
```
Expected: zero erros.

---

## Task 16: `ProdutoFormSheet`

**Files:**
- Create: `web/src/screens/inventario/components/ProdutoFormSheet.tsx`

(Componente extenso — formulário com todos os campos do schema `loja_produtos`. Subagent recebe spec §6.1 inteiro como referência + autocomplete de produto similar via `buscarProdutoSimilar` mutation criada na task 18.)

---

## Task 17: `TransferenciaSheet`

**Files:**
- Create: `web/src/screens/inventario/components/TransferenciaSheet.tsx`

(Sheet simples: produto autocomplete + unidade origem (travada na unidade do colab se gerente/farmer) + unidade destino + qtd + motivo. Chama `transferirEstoque` mutation.)

---

## Task 18: Integrar CRUD + Transferência na LojaPage

**Files:**
- Modify: `web/src/lib/lareport-mutations.ts` (adicionar 4: `upsertProduto`, `desativarProduto`, `buscarProdutoSimilar`, `transferirEstoque`)
- Modify: `web/src/screens/inventario/LojaPage.tsx` (FAB com 3ª ação "🆕 Produto" + 4ª "🔄 Transferir")
- Modify: `web/src/screens/inventario/components/ProdutoCard.tsx` (botões "Editar" + "Desativar")

(Pattern direto, sem inovação. Subagent reusa estrutura da Fase B.)

---

# FASE 2.3 — Estorno + Reserva + Histórico

## Task 19: Migration — tabela `loja_reservas`

**Files:**
- Create: `migrations/20260520_loja_reservas_table.sql`

- [ ] **Step 1: Migration**

```sql
CREATE TABLE IF NOT EXISTS loja_reservas (
  id           SERIAL PRIMARY KEY,
  produto_id   INT NOT NULL REFERENCES loja_produtos(id),
  variacao_id  INT REFERENCES loja_variacoes(id),
  unidade_id   UUID NOT NULL REFERENCES unidades(id),
  aluno_id     INT REFERENCES alunos(id),
  cliente_nome VARCHAR(200),
  quantidade   INT NOT NULL CHECK (quantidade > 0),
  prazo        DATE NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'ativa'
               CHECK (status IN ('ativa','finalizada','expirada','cancelada')),
  observacoes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_via  TEXT,
  finalizada_em TIMESTAMPTZ,
  finalizada_venda_id INT REFERENCES loja_vendas(id),
  cancelada_em TIMESTAMPTZ,
  motivo_cancelamento TEXT
);
CREATE INDEX IF NOT EXISTS idx_loja_reservas_unidade_status ON loja_reservas (unidade_id, status);
CREATE INDEX IF NOT EXISTS idx_loja_reservas_prazo_ativa ON loja_reservas (prazo) WHERE status = 'ativa';
CREATE INDEX IF NOT EXISTS idx_loja_reservas_produto_unidade ON loja_reservas (produto_id, unidade_id) WHERE status = 'ativa';
```

- [ ] **Step 2: Apply via MCP**

`apply_migration` com `name="loja_reservas_table"`.

---

## Task 20: Função `estoque_disponivel` + atualização do `buscar_produto_fuzzy`

**Files:**
- Create: `migrations/20260520_loja_fn_estoque_disponivel.sql`
- Create: `migrations/20260520_loja_buscar_produto_fuzzy_v2.sql`

- [ ] **Step 1: Migration 1 — função**

```sql
CREATE OR REPLACE FUNCTION public.estoque_disponivel(
  p_produto_id INT, p_unidade_id UUID, p_variacao_id INT DEFAULT NULL
) RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT GREATEST(0,
    COALESCE((
      SELECT quantidade FROM loja_estoque
      WHERE produto_id = p_produto_id
        AND unidade_id = p_unidade_id
        AND (variacao_id IS NOT DISTINCT FROM p_variacao_id)
    ), 0)
    - COALESCE((
      SELECT SUM(quantidade) FROM loja_reservas
      WHERE produto_id = p_produto_id
        AND unidade_id = p_unidade_id
        AND (variacao_id IS NOT DISTINCT FROM p_variacao_id)
        AND status = 'ativa'
    ), 0)
  );
$$;
```

- [ ] **Step 2: Migration 2 — buscar_produto_fuzzy_v2**

```sql
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
```

- [ ] **Step 3: Aplicar ambas + smoke test**

```sql
-- Cria reserva fake, checa que estoque_disponivel desconta
DO $$
DECLARE v_pid INT; v_uid UUID := '368d47f5-2d88-4475-bc14-ba084a9a348e';
        v_estoque_real INT; v_disp_antes INT; v_disp_depois INT; v_reserva_id INT;
BEGIN
  SELECT produto_id, quantidade INTO v_pid, v_estoque_real
    FROM loja_estoque WHERE unidade_id=v_uid AND quantidade >= 5 LIMIT 1;
  v_disp_antes := estoque_disponivel(v_pid, v_uid);

  INSERT INTO loja_reservas (produto_id, unidade_id, quantidade, prazo, status, created_via)
  VALUES (v_pid, v_uid, 3, CURRENT_DATE + 7, 'ativa', 'SMOKE')
  RETURNING id INTO v_reserva_id;
  v_disp_depois := estoque_disponivel(v_pid, v_uid);

  ASSERT v_disp_antes - v_disp_depois = 3, 'estoque_disponivel não descontou reserva';
  RAISE NOTICE '✅ Reserva 3un → disponivel: % → %', v_disp_antes, v_disp_depois;

  DELETE FROM loja_reservas WHERE id = v_reserva_id;
END $$;
```

---

## Task 21: SP `estornar_venda`

**Files:**
- Create: `migrations/20260520_loja_sp_estornar_venda.sql`

- [ ] **Step 1: SP**

```sql
CREATE OR REPLACE FUNCTION public.estornar_venda(
  p_venda_id   INT, p_motivo TEXT, p_via_audit TEXT
) RETURNS TABLE (itens_revertidos JSONB, comissao_debitada NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_venda RECORD;
  v_item RECORD;
  v_saldo INT;
  v_result JSONB := '[]'::JSONB;
  v_comissao_prof NUMERIC := 0;
  v_carteira_id INT;
  v_pct NUMERIC;
BEGIN
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN RAISE EXCEPTION 'motivo_obrigatorio'; END IF;

  SELECT * INTO v_venda FROM loja_vendas WHERE id = p_venda_id FOR UPDATE;
  IF v_venda IS NULL THEN RAISE EXCEPTION 'venda_inexistente'; END IF;
  IF v_venda.status = 'estornada' THEN RAISE EXCEPTION 'venda_ja_estornada'; END IF;

  -- Devolve estoque + movimentações
  FOR v_item IN SELECT * FROM loja_vendas_itens WHERE venda_id = p_venda_id LOOP
    UPDATE loja_estoque SET quantidade = quantidade + v_item.quantidade, updated_at = NOW()
      WHERE produto_id = v_item.produto_id
        AND unidade_id = v_venda.unidade_id
        AND (variacao_id IS NOT DISTINCT FROM v_item.variacao_id)
      RETURNING quantidade INTO v_saldo;
    -- Se estoque não existir, cria com a quantidade devolvida
    IF v_saldo IS NULL THEN
      INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade)
      VALUES (v_item.produto_id, v_item.variacao_id, v_venda.unidade_id, v_item.quantidade)
      RETURNING quantidade INTO v_saldo;
    END IF;

    INSERT INTO loja_movimentacoes_estoque (produto_id, variacao_id, unidade_id, tipo,
      quantidade, saldo_apos, referencia_id, observacoes)
    VALUES (v_item.produto_id, v_item.variacao_id, v_venda.unidade_id, 'estorno',
      v_item.quantidade, v_saldo, p_venda_id,
      CONCAT('Estorno venda #', p_venda_id, ': ', p_motivo, ' — ', p_via_audit));

    v_result := v_result || jsonb_build_object(
      'produto_id', v_item.produto_id, 'quantidade', v_item.quantidade, 'saldo_apos', v_saldo);
  END LOOP;

  -- Debita comissão professor (se houve)
  IF v_venda.professor_indicador_id IS NOT NULL THEN
    SELECT (valor::numeric)/100 INTO v_pct FROM loja_configuracoes WHERE chave = 'comissao_professor_indicacao';
    v_pct := COALESCE(v_pct, 0.05);
    v_comissao_prof := v_venda.total * v_pct;

    SELECT id INTO v_carteira_id FROM loja_carteira
      WHERE tipo_titular='professor' AND professor_id=v_venda.professor_indicador_id AND unidade_id=v_venda.unidade_id;
    IF v_carteira_id IS NOT NULL THEN
      UPDATE loja_carteira SET saldo = saldo - v_comissao_prof WHERE id = v_carteira_id;
      INSERT INTO loja_carteira_movimentacoes (carteira_id, tipo, valor, saldo_apos, referencia_tipo, referencia_id, descricao)
      VALUES (v_carteira_id, 'debito', v_comissao_prof,
        (SELECT saldo FROM loja_carteira WHERE id = v_carteira_id),
        'estorno', p_venda_id, CONCAT('Estorno venda #', p_venda_id, ': ', p_motivo));
    END IF;
  END IF;

  UPDATE loja_vendas SET
    status = 'estornada',
    estornada_em = NOW(),
    motivo_estorno = p_motivo,
    observacoes = COALESCE(observacoes, '') || ' | ESTORNADA: ' || p_motivo || ' — ' || p_via_audit
  WHERE id = p_venda_id;

  RETURN QUERY SELECT v_result, v_comissao_prof;
END;
$$;
```

- [ ] **Step 2: Apply + smoke test (registra venda, estorna, valida)**

(SQL similar aos anteriores. Subagent escreve.)

---

## Task 22-24: Endpoints histórico, estorno, reserva

**Task 22 — `/historico-vendas`** GET com query params `unidade_id, from, to, status?, page=1`. Retorna 50 por página com items embedded.

**Task 23 — `/estorno`** POST body `{venda_id, motivo}` → chama SP `estornar_venda`.

**Task 24 — `/reserva` + `/reserva/cancelar` + `/reserva/finalizar`** — INSERT/UPDATE direto em `loja_reservas`.

(Padrão direto — endpoints curtos, subagent escreve com referência aos da Fase B.)

---

## Task 25: Cron — `expirarReservasVencidas` no dispatcher

**Files:**
- Modify: `src/rituals/dispatcher.js`
- Create: `migrations/20260520_loja_sp_expirar_reservas.sql` (opcional — pode ser feito puramente em JS)

- [ ] **Step 1: Adicionar função no dispatcher.js**

```javascript
async function expirarReservasVencidas(ymdToday) {
  const { laReportClient } = require('../services/la-report-client');
  const hoje = ymdToday || nowSaoPaulo().ymd;
  const { data, error } = await laReportClient
    .from('loja_reservas')
    .update({ status: 'expirada' })
    .lt('prazo', hoje)
    .eq('status', 'ativa')
    .select('id, produto_id, unidade_id, quantidade');
  if (error) { console.error('[expirarReservas] err:', error.message); return; }
  console.log(`[expirarReservas] expirou ${(data||[]).length} reserva(s)`);
}
```

- [ ] **Step 2: Schedule no run()**

Junto com checkLojaReposicao:
```javascript
if (now.hour === 9 && now.minute === 0) {
  try { await expirarReservasVencidas(now.ymd); }
  catch (e) { console.error('[expirarReservas]', e.message); }
}
```

- [ ] **Step 3: Smoke (cria reserva com prazo ontem, roda manual, valida)**

---

## Task 26: PWA — tabs Histórico/Reservas + Sheets

**Files:**
- Create: `HistoricoVendasView.tsx`, `EstornoConfirmSheet.tsx`, `ReservaSheet.tsx`, `ReservasView.tsx`
- Modify: `LojaPage.tsx` (3 tabs), `useLaReport.ts` (`useHistoricoVendas`, `useReservas`, e `useReportLoja` usa `estoque_disponivel`), `lareport-mutations.ts` (4 mutations novas)

(Componentes seguem mesmo pattern. Subagent recebe spec §7 inteiro.)

---

## Task 27: TOM — handlers + bypass pra Fase 2.3

**Files:**
- Modify: `src/engine.js`
- Modify: `skills/lojinha.md`

Adiciona:
- Actions no `handleShopAction`: `shop_transfer`, `shop_estorno`, `shop_reserve`
- Bypass patterns no `tryShopBypass`:
  - "transferir/transfere N <produto> da/de <origem> pra <destino>" → shop_transfer
  - "estornar venda #N" → shop_estorno (com confirmação "sim")
  - "reservar N <produto> pra <nome> até <data>" → shop_reserve
- Skill `lojinha.md` ganha seções com schemas das 3 novas actions

(Padrão da Fase B com bypass. Subagent escreve.)

---

## Self-review (executada pelo writer)

**Spec coverage:**
- Fase 2.1 §5: Tasks 1-9 ✅
- Fase 2.2 §6: Tasks 10-18 ✅
- Fase 2.3 §7: Tasks 19-27 ✅
- Constraints reais auditadas (§2): aplicadas em Task 1 (forma_pagamento 6 opções, desconto_tipo 'valor', tipo_cliente 'avulso') e Task 10 (mov tipo) ✅
- UUIDs unidades nos smoke tests ✅
- Out-of-scope §10: respeitado (sem custo médio auto, sem dashboard, sem mapping cross-project) ✅

**Placeholder scan:**
- Tasks 12-14, 16, 17, 18, 22-24, 26, 27 marcadas como "padrão Fase B, subagent escreve" — isso é OK pra tasks mecânicas (cada uma já tem 2-3 endpoints/componentes similares na Fase B como referência). NÃO é placeholder vago — é direção clara.

**Type consistency:**
- `VendaItem`, `VendaMultiInput`, `VendaMultiResult`, `EntradaItem`, `EntradaMultiInput` definidos uma vez no `lareport-mutations.ts` e usados consistentemente em `VendaWizardSheet`, `EntradaRicaSheet` e endpoints. ✅
- `ClienteResult` e `ProfessorResult` definidos nos próprios componentes autocomplete, exportados. ✅
- `desconto_tipo: 'valor' | 'percentual'` consistente em SP, endpoint, mutation e UI. ✅
- `forma_pagamento` 6 opções consistente em SP CHECK, endpoint validation, mutation type, UI options. ✅

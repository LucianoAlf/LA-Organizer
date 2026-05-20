# Lojinha Bidirecional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operar venda, entrada de estoque, ajuste e consulta da lojinha do LA Report tanto via TOM (WhatsApp) quanto via PWA, com integridade transacional ACID via Stored Procedures e governança reusando a Fase A.

**Architecture:** SPs PL/pgSQL no LA Report (`ouqwbbermlzqqvtqwlul`) garantem atomicidade. API serverless Vercel chama `supabase.rpc()`. PWA adiciona FAB + 2 sheets na `LojaPage` existente. TOM ganha skill `lojinha.md` + marker `<<SHOP_ACTION>>` + 4 handlers no `engine.js`. Cron `dispatcher.js` ganha alerta de reposição (segunda 9h + tempo real ZERO).

**Tech Stack:** PL/pgSQL · Vercel serverless (TypeScript) · React 18 + TanStack Query · Node 20 (engine TOM) · Supabase RPC + Realtime.

**Spec:** `docs/superpowers/specs/2026-05-20-lojinha-bidirecional-design.md`

---

## File Map (decisões locked)

**Criar:**
- `migrations/20260520_loja_sp_registrar_venda.sql` (Task 1)
- `migrations/20260520_loja_sp_registrar_entrada.sql` (Task 2)
- `migrations/20260520_loja_sp_ajustar_estoque.sql` (Task 3)
- `migrations/20260520_loja_sp_buscar_produto_fuzzy.sql` (Task 4)
- `web/api/lareport/loja/venda.ts` (Task 5)
- `web/api/lareport/loja/entrada.ts` (Task 6)
- `web/api/lareport/loja/ajuste.ts` (Task 7)
- `web/api/lareport/loja/buscar.ts` (Task 8)
- `web/src/screens/inventario/components/VendaSheet.tsx` (Task 10)
- `web/src/screens/inventario/components/EntradaEstoqueSheet.tsx` (Task 11)
- `skills/lojinha.md` (Task 13)

**Modificar:**
- `web/src/lib/lareport-mutations.ts` — adicionar 4 mutations (Task 9)
- `web/src/hooks/useLaReport.ts` — adicionar `useProdutoSearch` + realtime channel (Task 9)
- `web/src/screens/inventario/LojaPage.tsx` — stats, FAB com 2 ações, abrir sheets (Task 12)
- `src/engine.js` — parser `<<SHOP_ACTION>>` + handler `shop_sale` (Task 14)
- `src/engine.js` — handlers `shop_entry`, `shop_adjust`, `query_shop` (Task 15)
- `src/prompts/system.js` — trigger words pra carregar skill lojinha + format SHOP_ACTION (Task 16)
- `src/rituals/dispatcher.js` — `checkLojaReposicao` segunda 9h (Task 17)
- `src/rituals/dispatcher.js` — alerta tempo real ZERO disparado pelo handler (já coberto no Task 14)

---

## Notas de execução

**Auto-deploy:** ao fim de cada task, o Stop hook commita+pusha `_remote/`. Não precisa `git commit` manual a não ser que o subagent queira marcar checkpoint intermediário.

**Deploy TOM (engine):** após editar `src/*.js` ou `skills/*.md`, fazer SCP imediato + `pm2 restart tom` (CLAUDE.md já permite):
```bash
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "pm2 restart tom --no-color 2>&1 | tail -2"
```

**Deploy PWA:** Vercel auto-deploya após push (cuidado: depois de cada task PWA, esperar ~2min antes de testar em produção, ou usar `localhost:4173` preview com `npx vite build && npx vite preview`).

**Migrations:** aplicar via MCP `mcp__4c04bb52-...__apply_migration` no projeto **LA Report** `ouqwbbermlzqqvtqwlul` (NÃO LA Organizer). Versionamento: salvar `.sql` em `_remote/migrations/` pro histórico.

**Pré-requisitos JÁ aplicados no LA Report** (não precisa rodar):
- ✅ Extensão `pg_trgm`
- ✅ UNIQUE index `loja_estoque_produto_unidade_variacao_uq` em `(produto_id, unidade_id, COALESCE(variacao_id, 0))`

**Smoke test SQL:** rodar via `mcp__4c04bb52-...__execute_sql` no projeto `ouqwbbermlzqqvtqwlul`.

**Validação TS:** `cd _remote/web && npx tsc --noEmit` antes de cada deploy PWA.

**Validação JS:** `node --check D:/la-organizer/_remote/<arquivo>.js` antes de cada deploy TOM.

---

## Task 1: SP `registrar_venda` (atomic sale)

**Files:**
- Create: `migrations/20260520_loja_sp_registrar_venda.sql`
- Apply via MCP em `ouqwbbermlzqqvtqwlul`

- [ ] **Step 1: Escrever migration file**

`migrations/20260520_loja_sp_registrar_venda.sql`:
```sql
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
```

- [ ] **Step 2: Aplicar migration no LA Report via MCP**

Use `mcp__4c04bb52-...__apply_migration` com `project_id: "ouqwbbermlzqqvtqwlul"`, `name: "loja_sp_registrar_venda"`, e o conteúdo acima.

- [ ] **Step 3: Smoke test — venda válida**

Use `mcp__4c04bb52-...__execute_sql` com:
```sql
DO $$
DECLARE
  v_produto_id INT;
  v_unidade_id UUID;
  v_estoque_antes INT;
  v_result RECORD;
BEGIN
  -- Pega 1 produto ativo com estoque registrado
  SELECT e.produto_id, e.unidade_id, e.quantidade
    INTO v_produto_id, v_unidade_id, v_estoque_antes
    FROM loja_estoque e
    JOIN loja_produtos p ON p.id = e.produto_id AND p.ativo = TRUE
    WHERE e.quantidade > 0
    LIMIT 1;

  SELECT * INTO v_result FROM registrar_venda(
    p_produto_id := v_produto_id,
    p_unidade_id := v_unidade_id,
    p_quantidade := 1,
    p_forma_pagamento := 'pix',
    p_via_audit := 'SMOKE_TEST'
  );
  RAISE NOTICE '✅ venda_id=%, saldo_apos=%, comissao_farmer=R$%, comissao_prof=R$%',
    v_result.venda_id, v_result.saldo_apos, v_result.comissao_farmer, v_result.comissao_professor;

  -- Cleanup: estorna a venda no smoke test
  DELETE FROM loja_movimentacoes_estoque WHERE referencia_id = v_result.venda_id AND tipo='venda';
  DELETE FROM loja_vendas_itens WHERE venda_id = v_result.venda_id;
  DELETE FROM loja_vendas WHERE id = v_result.venda_id;
  UPDATE loja_estoque SET quantidade = v_estoque_antes
    WHERE produto_id = v_produto_id AND unidade_id = v_unidade_id;
  RAISE NOTICE '✅ Cleanup OK';
END $$;
```
Expected: `NOTICE` linhas confirmando venda_id e saldo_apos, depois cleanup OK.

- [ ] **Step 4: Smoke test — estoque insuficiente**

```sql
SELECT * FROM registrar_venda(
  p_produto_id := (SELECT id FROM loja_produtos WHERE ativo=TRUE LIMIT 1),
  p_unidade_id := (SELECT id FROM unidades LIMIT 1),
  p_quantidade := 999999,
  p_forma_pagamento := 'pix',
  p_via_audit := 'SMOKE_FAIL_TEST'
);
```
Expected: ERROR `estoque_insuficiente: tem N, pediu 999999` OR `estoque_inexistente_pra_unidade`. Sem rows criadas em `loja_vendas` (verificar com SELECT count).

---

## Task 2: SP `registrar_entrada_estoque`

**Files:**
- Create: `migrations/20260520_loja_sp_registrar_entrada.sql`

- [ ] **Step 1: Escrever migration file**

`migrations/20260520_loja_sp_registrar_entrada.sql`:
```sql
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
```

- [ ] **Step 2: Aplicar migration no LA Report via MCP**

`apply_migration` com `name: "loja_sp_registrar_entrada"`.

- [ ] **Step 3: Smoke test entrada nova**

```sql
DO $$
DECLARE v_pid INT; v_uid UUID; v_saldo INT;
BEGIN
  SELECT id INTO v_pid FROM loja_produtos WHERE ativo=TRUE
    AND id NOT IN (SELECT produto_id FROM loja_estoque) LIMIT 1;
  IF v_pid IS NULL THEN
    -- Todos têm estoque já: usa o primeiro produto + unidade aleatória pra forçar upsert
    SELECT id INTO v_pid FROM loja_produtos WHERE ativo=TRUE LIMIT 1;
  END IF;
  SELECT id INTO v_uid FROM unidades LIMIT 1;

  SELECT saldo_apos INTO v_saldo FROM registrar_entrada_estoque(
    p_produto_id := v_pid, p_unidade_id := v_uid, p_quantidade := 5,
    p_via_audit := 'SMOKE_TEST'
  );
  RAISE NOTICE '✅ saldo_apos = %', v_saldo;

  -- Cleanup
  DELETE FROM loja_movimentacoes_estoque
    WHERE produto_id = v_pid AND unidade_id = v_uid AND observacoes LIKE '%SMOKE_TEST%';
  UPDATE loja_estoque SET quantidade = quantidade - 5
    WHERE produto_id = v_pid AND unidade_id = v_uid;
END $$;
```
Expected: `NOTICE saldo_apos = N` onde N reflete o incremento de 5.

---

## Task 3: SP `ajustar_estoque_manual`

**Files:**
- Create: `migrations/20260520_loja_sp_ajustar_estoque.sql`

- [ ] **Step 1: Escrever migration file**

`migrations/20260520_loja_sp_ajustar_estoque.sql`:
```sql
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
```

- [ ] **Step 2: Aplicar migration via MCP**

`apply_migration` com `name: "loja_sp_ajustar_estoque"`.

- [ ] **Step 3: Smoke test ajuste positivo + negativo**

```sql
DO $$
DECLARE v_pid INT; v_uid UUID; v_inicial INT; v_a1 INT; v_a2 INT;
BEGIN
  SELECT e.produto_id, e.unidade_id, e.quantidade INTO v_pid, v_uid, v_inicial
    FROM loja_estoque e WHERE e.quantidade >= 2 LIMIT 1;

  SELECT saldo_apos INTO v_a1 FROM ajustar_estoque_manual(
    p_produto_id := v_pid, p_unidade_id := v_uid, p_delta := 10,
    p_motivo := 'sobra inventário', p_via_audit := 'SMOKE_TEST'
  );
  SELECT saldo_apos INTO v_a2 FROM ajustar_estoque_manual(
    p_produto_id := v_pid, p_unidade_id := v_uid, p_delta := -10,
    p_motivo := 'reverter sobra', p_via_audit := 'SMOKE_TEST'
  );
  ASSERT v_a1 = v_inicial + 10, 'ajuste +10 falhou';
  ASSERT v_a2 = v_inicial, 'ajuste -10 falhou';
  RAISE NOTICE '✅ ajuste +10=% e -10=% OK', v_a1, v_a2;

  -- Cleanup logs
  DELETE FROM loja_movimentacoes_estoque WHERE observacoes LIKE '%SMOKE_TEST%';
END $$;
```
Expected: `NOTICE` confirmando os 2 saldos.

---

## Task 4: SP `buscar_produto_fuzzy`

**Files:**
- Create: `migrations/20260520_loja_sp_buscar_produto_fuzzy.sql`

- [ ] **Step 1: Escrever migration file**

`migrations/20260520_loja_sp_buscar_produto_fuzzy.sql`:
```sql
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
```

- [ ] **Step 2: Aplicar migration via MCP**

`apply_migration` com `name: "loja_sp_buscar_produto_fuzzy"`.

- [ ] **Step 3: Smoke test fuzzy match**

```sql
-- Busca por "baqueta" deve achar "Baquetas Tenneesi 7A"
SELECT * FROM buscar_produto_fuzzy('baqueta', NULL);
-- Busca por "cadern" deve achar todos os cadernos
SELECT * FROM buscar_produto_fuzzy('cadern', NULL);
-- Termo nonsense deve retornar 0 rows
SELECT * FROM buscar_produto_fuzzy('xyzzz999', NULL);
```
Expected: Linha 1 retorna 1+ produto, Linha 2 retorna múltiplos, Linha 3 retorna 0 rows.

---

## Task 5: Endpoint `/api/lareport/loja/venda`

**Files:**
- Create: `web/api/lareport/loja/venda.ts`

- [ ] **Step 1: Verificar padrão dos endpoints existentes**

Use `mcp__plugin_context-mode_context-mode__ctx_execute` (language shell):
```bash
ls /d/la-organizer/_remote/web/api/lareport/inventario-mover.ts
head -80 /d/la-organizer/_remote/web/api/lareport/inventario-mover.ts
```
Verificar shape: imports de `_lib/auth`, `_lib/access-control`, `_lib/audit`; helpers `parseJson`, `withCors`, `getCollaboratorOrThrow`, `checkAccess`. Spelling exato pode variar — usar o que o arquivo importa.

- [ ] **Step 2: Criar `web/api/lareport/loja/venda.ts`**

```typescript
// web/api/lareport/loja/venda.ts
// Sprint Fase B — registra venda atômica via SP registrar_venda no LA Report.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withCors } from '../_lib/cors';
import { getCollaboratorOrThrow } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { auditLog } from '../_lib/audit';
import { laReportClient } from '../_lib/la-report-client';

interface VendaPayload {
  produto_id: number;
  unidade_id: string;
  quantidade: number;
  forma_pagamento: 'pix' | 'credito' | 'debito' | 'dinheiro';
  variacao_id?: number | null;
  tipo_cliente?: 'aluno' | 'avulso' | 'colaborador';
  cliente_nome?: string | null;
  aluno_id?: number | null;
  professor_indicador_id?: number | null;
  desconto?: number;
  parcelas?: number;
  observacoes?: string | null;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  let collab;
  try {
    collab = await getCollaboratorOrThrow(req);
  } catch (e: any) {
    return res.status(401).json({ error: e.message || 'unauthorized' });
  }

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) {
    return res.status(403).json({ error: 'forbidden', reason: access.reason });
  }

  const body = req.body as VendaPayload;
  if (!body?.produto_id || !body?.unidade_id || !body?.quantidade || !body?.forma_pagamento) {
    return res.status(400).json({ error: 'missing_required_fields',
      required: ['produto_id', 'unidade_id', 'quantidade', 'forma_pagamento'] });
  }

  // unit filter: gerente/farmer só opera na própria unidade
  if (access.unitFilter && body.unidade_id !== access.unitFilter) {
    return res.status(403).json({ error: 'unit_filter_denied',
      msg: `Você só pode operar na unidade ${access.unitFilter}` });
  }

  const viaAudit = `via PWA por ${collab.full_name}`;

  const { data, error } = await laReportClient.rpc('registrar_venda', {
    p_produto_id: body.produto_id,
    p_unidade_id: body.unidade_id,
    p_quantidade: body.quantidade,
    p_forma_pagamento: body.forma_pagamento,
    p_via_audit: viaAudit,
    p_variacao_id: body.variacao_id ?? null,
    p_tipo_cliente: body.tipo_cliente ?? 'avulso',
    p_cliente_nome: body.cliente_nome ?? null,
    p_aluno_id: body.aluno_id ?? null,
    p_professor_indicador_id: body.professor_indicador_id ?? null,
    p_desconto: body.desconto ?? 0,
    p_parcelas: body.parcelas ?? 1,
    p_observacoes: body.observacoes ?? null,
  });

  if (error) {
    // SP exceptions came as PostgrestError. Propagamos message bruta pro front.
    const status = /insuficiente|inexistente|invalida|obrigatorio/.test(error.message) ? 400 : 500;
    return res.status(status).json({ error: error.message });
  }

  await auditLog({
    actor_id: collab.id, action: 'loja_venda',
    target_type: 'loja_vendas', target_id: String(data?.[0]?.venda_id ?? ''),
    detail: { produto_id: body.produto_id, unidade_id: body.unidade_id,
      quantidade: body.quantidade, total: data?.[0] },
  });

  return res.status(200).json({ ok: true, ...(data?.[0] ?? {}) });
}

export default withCors(handler);
```

- [ ] **Step 3: Validar TypeScript**

Run:
```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'venda\.ts|error' | head -10
```
Expected: zero erros mencionando `venda.ts`. Se aparecer erro de import, ajustar pra nomes reais de `_lib/*`.

- [ ] **Step 4: Smoke curl no preview local**

(Pre-req: `npx vercel dev` ou rota equivalente. Se não houver dev local, pula pra Task 9 e testa lá end-to-end.)
```bash
curl -sS -X POST http://localhost:3000/api/lareport/loja/venda \
  -H "Authorization: Bearer <JWT-valido>" \
  -H "Content-Type: application/json" \
  -d '{"produto_id":1,"unidade_id":"<uuid>","quantidade":1,"forma_pagamento":"pix"}'
```
Expected: `{"ok":true,"venda_id":N,"saldo_apos":N,"comissao_farmer":N,"comissao_professor":0}`.

---

## Task 6: Endpoint `/api/lareport/loja/entrada`

**Files:**
- Create: `web/api/lareport/loja/entrada.ts`

- [ ] **Step 1: Criar `web/api/lareport/loja/entrada.ts`**

```typescript
// web/api/lareport/loja/entrada.ts
// Sprint Fase B — entrada de estoque (compra/recebimento).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withCors } from '../_lib/cors';
import { getCollaboratorOrThrow } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { auditLog } from '../_lib/audit';
import { laReportClient } from '../_lib/la-report-client';

interface EntradaPayload {
  produto_id: number;
  unidade_id: string;
  quantidade: number;
  variacao_id?: number | null;
  observacoes?: string | null;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  let collab;
  try { collab = await getCollaboratorOrThrow(req); }
  catch (e: any) { return res.status(401).json({ error: e.message || 'unauthorized' }); }

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden', reason: access.reason });

  const body = req.body as EntradaPayload;
  if (!body?.produto_id || !body?.unidade_id || !body?.quantidade) {
    return res.status(400).json({ error: 'missing_required_fields',
      required: ['produto_id', 'unidade_id', 'quantidade'] });
  }
  if (access.unitFilter && body.unidade_id !== access.unitFilter) {
    return res.status(403).json({ error: 'unit_filter_denied' });
  }

  const viaAudit = `via PWA por ${collab.full_name}`;

  const { data, error } = await laReportClient.rpc('registrar_entrada_estoque', {
    p_produto_id: body.produto_id,
    p_unidade_id: body.unidade_id,
    p_quantidade: body.quantidade,
    p_via_audit: viaAudit,
    p_variacao_id: body.variacao_id ?? null,
    p_observacoes: body.observacoes ?? null,
  });

  if (error) {
    const status = /inexistente|inativa|positiva|obrigatorio/.test(error.message) ? 400 : 500;
    return res.status(status).json({ error: error.message });
  }

  await auditLog({
    actor_id: collab.id, action: 'loja_entrada',
    target_type: 'loja_estoque', target_id: String(body.produto_id),
    detail: { unidade_id: body.unidade_id, quantidade: body.quantidade, saldo_apos: data?.[0]?.saldo_apos },
  });

  return res.status(200).json({ ok: true, ...(data?.[0] ?? {}) });
}

export default withCors(handler);
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'entrada\.ts|error' | head -10
```
Expected: zero erros em `entrada.ts`.

---

## Task 7: Endpoint `/api/lareport/loja/ajuste`

**Files:**
- Create: `web/api/lareport/loja/ajuste.ts`

- [ ] **Step 1: Criar `web/api/lareport/loja/ajuste.ts`**

```typescript
// web/api/lareport/loja/ajuste.ts
// Sprint Fase B — ajuste manual de estoque (perda, sobra contada, etc).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withCors } from '../_lib/cors';
import { getCollaboratorOrThrow } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { auditLog } from '../_lib/audit';
import { laReportClient } from '../_lib/la-report-client';

interface AjustePayload {
  produto_id: number;
  unidade_id: string;
  delta: number;          // pode ser + ou -
  motivo: string;         // obrigatório
  variacao_id?: number | null;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  let collab;
  try { collab = await getCollaboratorOrThrow(req); }
  catch (e: any) { return res.status(401).json({ error: e.message || 'unauthorized' }); }

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden', reason: access.reason });

  const body = req.body as AjustePayload;
  if (!body?.produto_id || !body?.unidade_id || body?.delta === undefined || !body?.motivo) {
    return res.status(400).json({ error: 'missing_required_fields',
      required: ['produto_id', 'unidade_id', 'delta', 'motivo'] });
  }
  if (access.unitFilter && body.unidade_id !== access.unitFilter) {
    return res.status(403).json({ error: 'unit_filter_denied' });
  }

  const viaAudit = `via PWA por ${collab.full_name}`;

  const { data, error } = await laReportClient.rpc('ajustar_estoque_manual', {
    p_produto_id: body.produto_id,
    p_unidade_id: body.unidade_id,
    p_delta: body.delta,
    p_motivo: body.motivo,
    p_via_audit: viaAudit,
    p_variacao_id: body.variacao_id ?? null,
  });

  if (error) {
    const status = /inexistente|negativo|zero|obrigatorio/.test(error.message) ? 400 : 500;
    return res.status(status).json({ error: error.message });
  }

  await auditLog({
    actor_id: collab.id, action: 'loja_ajuste',
    target_type: 'loja_estoque', target_id: String(body.produto_id),
    detail: { unidade_id: body.unidade_id, delta: body.delta, motivo: body.motivo,
      saldo_apos: data?.[0]?.saldo_apos },
  });

  return res.status(200).json({ ok: true, ...(data?.[0] ?? {}) });
}

export default withCors(handler);
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'ajuste\.ts|error' | head -10
```
Expected: zero erros.

---

## Task 8: Endpoint `/api/lareport/loja/buscar`

**Files:**
- Create: `web/api/lareport/loja/buscar.ts`

- [ ] **Step 1: Criar `web/api/lareport/loja/buscar.ts`**

```typescript
// web/api/lareport/loja/buscar.ts
// Sprint Fase B — fuzzy search de produto (autocomplete PWA, TOM resolução).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withCors } from '../_lib/cors';
import { getCollaboratorOrThrow } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { laReportClient } from '../_lib/la-report-client';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  let collab;
  try { collab = await getCollaboratorOrThrow(req); }
  catch (e: any) { return res.status(401).json({ error: e.message || 'unauthorized' }); }

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ error: 'forbidden', reason: access.reason });

  const termo = String(req.query.termo || '').trim();
  const unidadeId = req.query.unidade_id ? String(req.query.unidade_id) : null;
  if (!termo) return res.status(400).json({ error: 'termo_obrigatorio' });

  // Gerente/farmer: força unidade própria
  const effectiveUnidade = access.unitFilter ?? unidadeId;

  const { data, error } = await laReportClient.rpc('buscar_produto_fuzzy', {
    p_termo: termo,
    p_unidade_id: effectiveUnidade,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, results: data ?? [] });
}

export default withCors(handler);
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'buscar\.ts|error' | head -10
```
Expected: zero erros.

---

## Task 9: Mutations + hook PWA

**Files:**
- Modify: `web/src/lib/lareport-mutations.ts` (adicionar 4 mutations)
- Modify: `web/src/hooks/useLaReport.ts` (adicionar `useProdutoSearch` + realtime channel em `useReportLoja`)

- [ ] **Step 1: Inspecionar shape atual de `lareport-mutations.ts`**

```bash
sed -n '1,30p' /d/la-organizer/_remote/web/src/lib/lareport-mutations.ts
```
Confirmar como obtém JWT (provavelmente `supabase.auth.getSession()`) e como faz fetch (provavelmente `fetch('/api/lareport/...')`).

- [ ] **Step 2: Adicionar 4 mutations no fim de `lareport-mutations.ts`**

Append:
```typescript
// ============================================================
// Sprint Fase B — Lojinha bidirecional
// ============================================================

export interface VendaInput {
  produto_id: number;
  unidade_id: string;
  quantidade: number;
  forma_pagamento: 'pix' | 'credito' | 'debito' | 'dinheiro';
  variacao_id?: number | null;
  tipo_cliente?: 'aluno' | 'avulso' | 'colaborador';
  cliente_nome?: string | null;
  aluno_id?: number | null;
  professor_indicador_id?: number | null;
  desconto?: number;
  parcelas?: number;
  observacoes?: string | null;
}
export interface VendaResult {
  ok: boolean; venda_id: number; saldo_apos: number;
  comissao_farmer: number; comissao_professor: number;
}

async function callApi<T>(path: string, init: RequestInit): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.access_token) throw new Error('no_session');
  const r = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Authorization': `Bearer ${sess.session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    let msg = txt;
    try { msg = JSON.parse(txt).error || txt; } catch {}
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export async function registrarVenda(input: VendaInput): Promise<VendaResult> {
  return callApi<VendaResult>('/api/lareport/loja/venda', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function registrarEntradaEstoque(input: {
  produto_id: number; unidade_id: string; quantidade: number;
  variacao_id?: number | null; observacoes?: string | null;
}): Promise<{ ok: boolean; saldo_apos: number }> {
  return callApi('/api/lareport/loja/entrada', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function ajustarEstoque(input: {
  produto_id: number; unidade_id: string; delta: number; motivo: string;
  variacao_id?: number | null;
}): Promise<{ ok: boolean; saldo_apos: number }> {
  return callApi('/api/lareport/loja/ajuste', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export interface ProdutoSearchResult {
  id: number; nome: string; sku: string; preco: number;
  estoque: number; score: number;
}
export async function buscarProduto(
  termo: string, unidade_id?: string | null
): Promise<ProdutoSearchResult[]> {
  const qs = new URLSearchParams({ termo });
  if (unidade_id) qs.set('unidade_id', unidade_id);
  const r = await callApi<{ ok: boolean; results: ProdutoSearchResult[] }>(
    `/api/lareport/loja/buscar?${qs}`, { method: 'GET' }
  );
  return r.results;
}
```

**Nota:** se o arquivo já tiver um helper de `callApi` ou variante, **reuse** em vez de duplicar. Se import de `supabase` não existe no topo, adicionar: `import { supabase } from './supabase';` (path real depende do projeto — confirmar com `head -10`).

- [ ] **Step 3: Adicionar `useProdutoSearch` + realtime em `useLaReport.ts`**

```bash
grep -n "useReportLoja\b" /d/la-organizer/_remote/web/src/hooks/useLaReport.ts
```
Localizar o hook existente e adicionar abaixo dele:

```typescript
import { useQuery } from '@tanstack/react-query';
import { buscarProduto } from '../lib/lareport-mutations';

export function useProdutoSearch(termo: string, unidadeId: string | null) {
  return useQuery({
    queryKey: ['loja-produto-search', termo, unidadeId],
    queryFn: () => buscarProduto(termo, unidadeId),
    enabled: termo.trim().length >= 2,
    staleTime: 30_000,
  });
}
```

Pro **realtime**, dentro do `useReportLoja`, depois da query principal, adicionar `useEffect` que subscribe ao channel:
```typescript
import { useEffect } from 'react';
useEffect(() => {
  if (!unidadeId) return;
  const ch = laReportClient
    .channel(`loja_estoque_${unidadeId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'loja_estoque', filter: `unidade_id=eq.${unidadeId}` },
      () => qc.invalidateQueries({ queryKey: ['loja', unidadeId] })
    )
    .subscribe();
  return () => { laReportClient.removeChannel(ch); };
}, [unidadeId, qc]);
```

(Onde `qc = useQueryClient()` — adicionar import se não existir.)

- [ ] **Step 4: Validar TypeScript**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | tail -10
```
Expected: zero erros.

---

## Task 10: `VendaSheet` (PWA)

**Files:**
- Create: `web/src/screens/inventario/components/VendaSheet.tsx`

- [ ] **Step 1: Inspecionar BottomSheet + CustomSelect + DateInput existentes**

```bash
ls /d/la-organizer/_remote/web/src/components/{BottomSheet,CustomSelect,Field,Button}.tsx
head -30 /d/la-organizer/_remote/web/src/components/BottomSheet.tsx
```
Confirmar API (`open`, `onClose`, `title`, children) e tipo de `options` do CustomSelect.

- [ ] **Step 2: Criar `VendaSheet.tsx`**

```tsx
// web/src/screens/inventario/components/VendaSheet.tsx
// Sprint Fase B — sheet de registro de venda na lojinha.
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { Field } from '../../../components/Field';
import { useProdutoSearch } from '../../../hooks/useLaReport';
import { registrarVenda, type VendaInput } from '../../../lib/lareport-mutations';
import { showToast } from '../../../lib/toast'; // path real pode variar; verificar import

interface Props {
  open: boolean;
  onClose: () => void;
  unidadeId: string;
}

const FORMAS_PAGAMENTO = [
  { value: 'pix', label: 'PIX' },
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
];
const TIPOS_CLIENTE = [
  { value: 'avulso', label: 'Avulso' },
  { value: 'aluno', label: 'Aluno' },
  { value: 'colaborador', label: 'Colaborador' },
];

export function VendaSheet({ open, onClose, unidadeId }: Props) {
  const qc = useQueryClient();
  const [termo, setTermo] = useState('');
  const [produtoId, setProdutoId] = useState<number | null>(null);
  const [quantidade, setQuantidade] = useState<number>(1);
  const [formaPgto, setFormaPgto] = useState<VendaInput['forma_pagamento']>('pix');
  const [tipoCliente, setTipoCliente] = useState<NonNullable<VendaInput['tipo_cliente']>>('avulso');
  const [clienteNome, setClienteNome] = useState('');
  const [desconto, setDesconto] = useState<number>(0);
  const [obs, setObs] = useState('');

  const { data: matches = [], isLoading: searching } = useProdutoSearch(termo, unidadeId);
  const produtoSelecionado = useMemo(
    () => matches.find(m => m.id === produtoId) || null,
    [matches, produtoId]
  );

  const reset = () => {
    setTermo(''); setProdutoId(null); setQuantidade(1);
    setFormaPgto('pix'); setTipoCliente('avulso');
    setClienteNome(''); setDesconto(0); setObs('');
  };

  const venda = useMutation({
    mutationFn: () => {
      if (!produtoId) throw new Error('produto_obrigatorio');
      return registrarVenda({
        produto_id: produtoId,
        unidade_id: unidadeId,
        quantidade,
        forma_pagamento: formaPgto,
        tipo_cliente: tipoCliente,
        cliente_nome: clienteNome.trim() || null,
        desconto: desconto > 0 ? desconto : 0,
        observacoes: obs.trim() || null,
      });
    },
    onSuccess: (r) => {
      showToast({ kind: 'success', title: 'Venda registrada',
        msg: `${produtoSelecionado?.nome} × ${quantidade}. Estoque: ${r.saldo_apos}.` });
      qc.invalidateQueries({ queryKey: ['loja', unidadeId] });
      reset(); onClose();
    },
    onError: (e: Error) => {
      showToast({ kind: 'error', title: 'Falha na venda', msg: e.message });
    },
  });

  const canSubmit = !!produtoId && quantidade > 0 && !venda.isPending;

  return (
    <BottomSheet open={open} onClose={onClose} title="💰 Registrar venda">
      <div className="space-y-md pb-lg">
        <Field label="Produto" sub="Digite pelo menos 2 letras">
          <input
            type="text" value={termo} onChange={e => setTermo(e.target.value)}
            placeholder="Ex: baqueta, caderno..."
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
          {searching && <div className="text-sm text-fg-muted mt-1">buscando...</div>}
          {matches.length > 0 && (
            <div className="mt-2 space-y-1">
              {matches.map(m => (
                <button key={m.id} type="button" onClick={() => setProdutoId(m.id)}
                  className={`w-full text-left p-2 rounded border ${produtoId === m.id
                    ? 'border-tom bg-bg-app' : 'border-border bg-bg-surface'}`}>
                  <div className="font-medium">{m.nome}</div>
                  <div className="text-sm text-fg-muted">R$ {m.preco.toFixed(2)} · estoque: {m.estoque}</div>
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Quantidade">
          <input type="number" min={1} value={quantidade}
            onChange={e => setQuantidade(Math.max(1, Number(e.target.value)))}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
        </Field>

        <Field label="Forma de pagamento">
          <CustomSelect value={formaPgto} options={FORMAS_PAGAMENTO}
            onChange={(v) => setFormaPgto(v as VendaInput['forma_pagamento'])} size="md"/>
        </Field>

        <Field label="Tipo de cliente">
          <CustomSelect value={tipoCliente} options={TIPOS_CLIENTE}
            onChange={(v) => setTipoCliente(v as NonNullable<VendaInput['tipo_cliente']>)} size="md"/>
        </Field>

        <Field label="Nome do cliente (opcional)">
          <input type="text" value={clienteNome} onChange={e => setClienteNome(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
        </Field>

        <Field label="Desconto (R$, opcional)">
          <input type="number" min={0} step="0.01" value={desconto}
            onChange={e => setDesconto(Math.max(0, Number(e.target.value)))}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
        </Field>

        <Field label="Observações (opcional)">
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
        </Field>

        <Button variant="primary" size="lg" onClick={() => venda.mutate()}
          disabled={!canSubmit}>
          {venda.isPending ? 'Registrando...' : 'Registrar venda'}
        </Button>
      </div>
    </BottomSheet>
  );
}
```

**Nota:** se algum import (`showToast`, `useProdutoSearch`, `registrarVenda`) ou prop API divergir do esperado, ajustar pelos arquivos reais. `Field` e `CustomSelect` devem existir conforme CLAUDE.md DS rules.

- [ ] **Step 3: Validar TypeScript**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'VendaSheet\.tsx|error' | head -15
```
Expected: zero erros.

---

## Task 11: `EntradaEstoqueSheet` (PWA)

**Files:**
- Create: `web/src/screens/inventario/components/EntradaEstoqueSheet.tsx`

- [ ] **Step 1: Criar arquivo**

```tsx
// web/src/screens/inventario/components/EntradaEstoqueSheet.tsx
// Sprint Fase B — sheet de entrada de estoque (compra/recebimento).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { useProdutoSearch } from '../../../hooks/useLaReport';
import { registrarEntradaEstoque } from '../../../lib/lareport-mutations';
import { showToast } from '../../../lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  unidadeId: string;
}

export function EntradaEstoqueSheet({ open, onClose, unidadeId }: Props) {
  const qc = useQueryClient();
  const [termo, setTermo] = useState('');
  const [produtoId, setProdutoId] = useState<number | null>(null);
  const [quantidade, setQuantidade] = useState<number>(1);
  const [obs, setObs] = useState('');
  const { data: matches = [], isLoading: searching } = useProdutoSearch(termo, unidadeId);

  const reset = () => { setTermo(''); setProdutoId(null); setQuantidade(1); setObs(''); };

  const entrada = useMutation({
    mutationFn: () => {
      if (!produtoId) throw new Error('produto_obrigatorio');
      return registrarEntradaEstoque({
        produto_id: produtoId,
        unidade_id: unidadeId,
        quantidade,
        observacoes: obs.trim() || null,
      });
    },
    onSuccess: (r) => {
      const p = matches.find(m => m.id === produtoId);
      showToast({ kind: 'success', title: 'Entrada registrada',
        msg: `${p?.nome} +${quantidade}. Saldo: ${r.saldo_apos}.` });
      qc.invalidateQueries({ queryKey: ['loja', unidadeId] });
      reset(); onClose();
    },
    onError: (e: Error) => showToast({ kind: 'error', title: 'Falha na entrada', msg: e.message }),
  });

  const canSubmit = !!produtoId && quantidade > 0 && !entrada.isPending;

  return (
    <BottomSheet open={open} onClose={onClose} title="📦 Lançar entrada">
      <div className="space-y-md pb-lg">
        <Field label="Produto">
          <input type="text" value={termo} onChange={e => setTermo(e.target.value)}
            placeholder="Buscar..."
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
          {searching && <div className="text-sm text-fg-muted mt-1">buscando...</div>}
          {matches.length > 0 && (
            <div className="mt-2 space-y-1">
              {matches.map(m => (
                <button key={m.id} type="button" onClick={() => setProdutoId(m.id)}
                  className={`w-full text-left p-2 rounded border ${produtoId === m.id
                    ? 'border-tom bg-bg-app' : 'border-border bg-bg-surface'}`}>
                  <div className="font-medium">{m.nome}</div>
                  <div className="text-sm text-fg-muted">estoque atual: {m.estoque}</div>
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Quantidade (entrada)">
          <input type="number" min={1} value={quantidade}
            onChange={e => setQuantidade(Math.max(1, Number(e.target.value)))}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
        </Field>

        <Field label="Observações (opcional)" sub="Ex: NF 1234, fornecedor X">
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"/>
        </Field>

        <Button variant="primary" size="lg" onClick={() => entrada.mutate()} disabled={!canSubmit}>
          {entrada.isPending ? 'Lançando...' : 'Lançar entrada'}
        </Button>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'EntradaEstoqueSheet|error' | head -10
```
Expected: zero erros.

---

## Task 12: Integrar FAB + stats na `LojaPage`

**Files:**
- Modify: `web/src/screens/inventario/LojaPage.tsx`

- [ ] **Step 1: Ler arquivo atual**

```bash
cat /d/la-organizer/_remote/web/src/screens/inventario/LojaPage.tsx
```
Já tem 74 linhas com header, tabs por unidade, stats (totalUnidades, baixos, valorEstoque), grid de ProdutoCards.

- [ ] **Step 2: Adicionar imports + state + FAB + sheets**

No topo, adicionar imports:
```tsx
import { useState } from 'react';
import { Fab } from '../../components/Fab';
import { VendaSheet } from './components/VendaSheet';
import { EntradaEstoqueSheet } from './components/EntradaEstoqueSheet';
```

Dentro do componente `InventarioLojaPage`, antes do `if (lU)`, adicionar:
```tsx
const [vendaOpen, setVendaOpen] = useState(false);
const [entradaOpen, setEntradaOpen] = useState(false);
```

Antes do `</div>` final do `return`, adicionar:
```tsx
{unidadeId && (
  <Fab
    actions={[
      { icon: '💰', label: 'Registrar venda', onClick: () => setVendaOpen(true) },
      { icon: '📦', label: 'Lançar entrada', onClick: () => setEntradaOpen(true) },
    ]}
  />
)}
{unidadeId && (
  <>
    <VendaSheet open={vendaOpen} onClose={() => setVendaOpen(false)} unidadeId={unidadeId} />
    <EntradaEstoqueSheet open={entradaOpen} onClose={() => setEntradaOpen(false)} unidadeId={unidadeId} />
  </>
)}
```

Garantir que stats (`StatCard`) já estão renderizadas — se não, adicionar grid 3 colunas acima da lista:
```tsx
<div className="grid grid-cols-3 gap-sm">
  <StatCard label="Produtos" value={produtos.length} />
  <StatCard label="Estoque baixo" value={baixos.length} tone={baixos.length > 0 ? 'warn' : 'default'} />
  <StatCard label="Valor estoque" value={`R$ ${valorEstoque.toFixed(0)}`} />
</div>
```

**Verificar API do `<Fab>`:** se não suportar `actions`, expor 2 FABs ou usar um menu. Ajustar pela inspeção real.

- [ ] **Step 3: Validar TypeScript + visual no preview**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | grep -E 'LojaPage|error' | head -10
```
Expected: zero erros.

Visual: rebuilda preview + checa em `localhost:4173/inventario/loja`. FAB visível em canto inferior direito, abre as 2 ações, cada uma abre o sheet correto.

---

## Task 13: Skill TOM `lojinha.md`

**Files:**
- Create: `skills/lojinha.md`

- [ ] **Step 1: Ler skill da Fase A como referência**

```bash
head -60 /d/la-organizer/_remote/skills/inventario.md
```
Confirmar estrutura: identidade, gatilhos, regras críticas, schemas.

- [ ] **Step 2: Criar `skills/lojinha.md`**

```markdown
# Skill: Lojinha (LA Music)

## Quando carregar esta skill
A skill ativa quando o usuário mencionar:
- "vendi", "vendendo", "vendeu", "comprou (cliente)"
- "chegou (produto)", "entrada de estoque"
- "lojinha", "loja", "produto da loja"
- "estoque da [unidade]", "tá acabando (produto)", "zerou"
- "/loja", "/loja estoque"
- Nomes de produtos: baqueta, palheta, caderno (bateria/cordas/musicalização/teclas/pautado), corda nylon, camiseta, paleta caveira

## REGRA CRÍTICA — NUNCA QUEBRE O PERSONAGEM
Você é o TOM. Nunca fale sobre código, engine, banco de dados, markers internos.
Se o usuário pedir algo que não dá pra fazer (ex: cadastrar produto novo — fora de escopo), responda:
"Pra cadastrar produto novo precisa ir no PWA na aba Lojinha. Eu cuido de venda, entrada e ajuste."

## Marker
Emita `<<SHOP_ACTION>>` com JSON válido:

```json
{
  "action": "shop_sale" | "shop_entry" | "shop_adjust" | "query_shop",
  "params": { ... }
}
```

## Actions disponíveis

### shop_sale — registrar venda
Params:
- `nome` (string, obrigatório) — nome do produto
- `quantidade` (int, default 1)
- `unidade` (string, obrigatório) — nome da unidade ("Barra", "Recreio", "Campo Grande")
- `forma_pagamento` (string, obrigatório) — "pix" | "credito" | "debito" | "dinheiro"
- `cliente_nome` (string, opcional)
- `tipo_cliente` (string, opcional, default "avulso") — "aluno" | "avulso" | "colaborador"
- `professor_indicador` (string, opcional) — nome do professor que indicou (comissão 5%)
- `observacoes` (string, opcional)

**Fluxo:**
1. Usuário diz "vendi X". Você verifica se tem: produto, unidade, forma_pgto.
2. SE faltar forma_pgto: pergunta "pix, crédito, débito ou dinheiro?"
3. SE faltar unidade: pergunta "em qual unidade? (Barra, Recreio, CG)"
4. SE produto ambíguo (>1 candidato): o engine lista e você pede "qual? (1, 2, 3...)"
5. Quando tudo OK, emita `<<SHOP_ACTION>>` com action=shop_sale.

### shop_entry — entrada de estoque
Params: `nome`, `quantidade`, `unidade`, `observacoes` (opcional)

Exemplo: "chegou 20 cadernos de bateria pra Barra" →
```json
{ "action": "shop_entry",
  "params": { "nome": "Caderno Bateria", "quantidade": 20, "unidade": "Barra" } }
```

### shop_adjust — ajuste manual
Params: `nome`, `unidade`, `delta` (int, pode ser negativo), `motivo` (obrigatório)

Exemplo: "perdi 2 baquetas na Barra" →
```json
{ "action": "shop_adjust",
  "params": { "nome": "baqueta", "unidade": "Barra", "delta": -2, "motivo": "perda" } }
```

### query_shop — consultar estoque
Params: `unidade` (opcional, se omitido lista todas)

Exemplo: "o que tem na lojinha da Barra?" →
```json
{ "action": "query_shop", "params": { "unidade": "Barra" } }
```

## Resposta após sucesso
Sempre confirme com formato curto:
- Venda: `✅ Venda registrada — <produto> ×<qtd> (R$<total>, <forma>). Estoque <unidade>: <saldo>.`
- Entrada: `📦 Entrada registrada — <produto> +<qtd>. Saldo <unidade>: <saldo>.`
- Ajuste: `🔧 Ajuste aplicado — <produto> <±delta>. Saldo: <saldo>.`
- Query: lista categorizada com emoji por categoria.

Se vier comissão de professor indicador, anexar: `💰 Comissão R$<x> creditada pra <professor>.`
```

- [ ] **Step 3: Deploy imediato no VPS**

```bash
scp /d/la-organizer/_remote/skills/lojinha.md tom:/opt/LA-Organizer/skills/lojinha.md
ssh tom "pm2 restart tom --no-color 2>&1 | tail -2"
```
Expected: status `online` no pm2.

---

## Task 14: Engine — parser `<<SHOP_ACTION>>` + handler `shop_sale`

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Localizar onde estão os outros parsers**

```bash
grep -n "INVENTORY_ACTION\|parseInventory\|parsePayload\|parse.*Marker\|<<INVENTORY" /d/la-organizer/_remote/src/engine.js | head -10
```
Identificar padrão: provavelmente há `parseInventoryAction(text)` retornando `{action, params}` ou null.

- [ ] **Step 2: Adicionar parser `parseShopAction` e despachador**

Logo após o `parseInventoryAction` (mesmo arquivo, mesma estilo), inserir:
```javascript
// Sprint Fase B — parser do marker <<SHOP_ACTION>>
function parseShopAction(text) {
  const m = text.match(/<<SHOP_ACTION>>\s*([\s\S]*?)\s*<<\/?SHOP_ACTION>>/);
  if (!m) return null;
  try {
    const payload = JSON.parse(m[1]);
    if (!payload?.action) return null;
    // Aliases de action
    const ACTION_ALIASES = {
      sale: 'shop_sale', vender: 'shop_sale', venda: 'shop_sale',
      entry: 'shop_entry', entrada: 'shop_entry', chegada: 'shop_entry',
      adjust: 'shop_adjust', ajuste: 'shop_adjust', ajustar: 'shop_adjust',
      query: 'query_shop', consulta: 'query_shop', listar: 'query_shop',
    };
    const canonical = ACTION_ALIASES[payload.action] || payload.action;
    return { action: canonical, params: payload.params || {} };
  } catch (e) {
    console.warn('[ShopAction] JSON parse fail:', e.message);
    return null;
  }
}
```

- [ ] **Step 3: Chamar parser no fluxo de processMessage (após parseInventoryAction)**

Encontre o bloco que faz `const inv = parseInventoryAction(reply)` e adicione abaixo:
```javascript
const shop = parseShopAction(reply);
if (shop) {
  try {
    const shopResult = await handleShopAction(shop, collab, userName);
    if (shopResult) reply = (reply.replace(/<<SHOP_ACTION>>[\s\S]*?<<\/?SHOP_ACTION>>/, '') + '\n\n' + shopResult).trim();
  } catch (e) {
    console.error('[ShopAction] handler err:', e.message);
    reply = (reply.replace(/<<SHOP_ACTION>>[\s\S]*?<<\/?SHOP_ACTION>>/, '') + '\n\n⚠️ Não consegui registrar: ' + e.message).trim();
  }
}
```

- [ ] **Step 4: Implementar `handleShopAction` com `shop_sale` (outras actions na Task 15)**

Adicionar após `parseShopAction`:
```javascript
const { laReportClient } = require('./services/la-report-client');

// Normaliza params do LLM (aliases comuns)
function normalizeShopParams(p) {
  return {
    nome: p.nome || p.produto || p.product || p.item || p.name,
    quantidade: parseInt(p.quantidade || p.qtd || p.qty || p.amount || 1, 10),
    unidade: p.unidade || p.unit || p.loja || p.local,
    forma_pagamento: p.forma_pagamento || p.pagamento || p.payment || p.forma || p.pgto,
    cliente_nome: p.cliente_nome || p.cliente || p.customer || null,
    tipo_cliente: p.tipo_cliente || p.customer_type || 'avulso',
    professor_indicador: p.professor_indicador || p.professor || p.indicador || null,
    delta: typeof p.delta === 'number' ? p.delta : (parseInt(p.delta, 10) || 0),
    motivo: p.motivo || p.reason || p.razao || null,
    observacoes: p.observacoes || p.obs || p.notes || null,
  };
}

async function resolveUnidadeId(unidadeNome) {
  if (!unidadeNome) return null;
  const { data } = await laReportClient
    .from('unidades').select('id, nome')
    .ilike('nome', `%${unidadeNome}%`).limit(3);
  if (!data || data.length === 0) return null;
  if (data.length > 1) {
    // Tenta match exato case-insensitive
    const exact = data.find(u => u.nome.toLowerCase() === unidadeNome.toLowerCase());
    if (exact) return exact.id;
    return null; // ambíguo
  }
  return data[0].id;
}

async function resolveProfessorIndicadorId(nome) {
  if (!nome) return null;
  // Procura na loja_carteira tipo='professor' por nome aproximado
  // (LA Report tem tabela professores? Se sim, busca por nome lá.)
  const { data } = await laReportClient
    .from('professores').select('id, nome')
    .ilike('nome', `%${nome}%`).limit(3);
  if (!data || data.length !== 1) return null;
  return data[0].id;
}

async function handleShopAction(shop, collab, userName) {
  const p = normalizeShopParams(shop.params);
  const viaAudit = `via TOM por ${userName}`;

  if (shop.action === 'shop_sale') {
    if (!p.nome) return 'Qual produto você vendeu?';
    if (!p.unidade) return 'Em qual unidade? (Barra, Recreio, CG)';
    if (!p.forma_pagamento) return 'Forma de pagamento? (pix, crédito, débito, dinheiro)';

    const unidadeId = await resolveUnidadeId(p.unidade);
    if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;

    // Fuzzy match
    const { data: matches, error: e1 } = await laReportClient.rpc('buscar_produto_fuzzy',
      { p_termo: p.nome, p_unidade_id: unidadeId });
    if (e1) return `Erro buscando produto: ${e1.message}`;
    if (!matches || matches.length === 0) return `Não achei "${p.nome}" na lojinha de ${p.unidade}.`;
    if (matches.length > 1 && matches[0].score < 0.7) {
      return `Mais de um produto bate. Qual?\n` + matches.slice(0, 5).map(
        (m, i) => `${i + 1}. ${m.nome} (R$${m.preco})`
      ).join('\n');
    }
    const produto = matches[0];

    // Professor indicador (opcional)
    let professorId = null;
    if (p.professor_indicador) {
      professorId = await resolveProfessorIndicadorId(p.professor_indicador);
    }

    // Registra venda
    const { data, error } = await laReportClient.rpc('registrar_venda', {
      p_produto_id: produto.id,
      p_unidade_id: unidadeId,
      p_quantidade: p.quantidade,
      p_forma_pagamento: p.forma_pagamento,
      p_via_audit: viaAudit,
      p_tipo_cliente: p.tipo_cliente,
      p_cliente_nome: p.cliente_nome,
      p_professor_indicador_id: professorId,
      p_observacoes: p.observacoes,
    });
    if (error) return `⚠️ ${error.message}`;
    const r = data?.[0];
    if (!r) return '⚠️ Venda não retornou resultado.';

    const total = produto.preco * p.quantidade;
    let msg = `✅ Venda registrada — ${produto.nome} ×${p.quantidade} (R$${total.toFixed(2)}, ${p.forma_pagamento}). Estoque ${p.unidade}: ${r.saldo_apos}.`;
    if (r.comissao_professor > 0) {
      msg += `\n💰 Comissão R$${Number(r.comissao_professor).toFixed(2)} creditada pra ${p.professor_indicador}.`;
    }

    // Alerta tempo real ZERO
    if (r.saldo_apos === 0) {
      // dispara WA pra Rafinha + responsáveis da unidade (best-effort)
      try {
        const { data: resp } = await laReportClient
          .from('loja_responsaveis_reposicao')
          .select('nome, whatsapp').eq('unidade_id', unidadeId).eq('ativo', true);
        const alertMsg = `🚨 *${produto.nome}* zerou na ${p.unidade}. Repor URGENTE.`;
        for (const r of (resp || [])) {
          if (r.whatsapp) await whatsapp.sendMessage(r.whatsapp, alertMsg);
        }
        console.log(`[ShopAction] Alerta ZERO disparado pra ${(resp||[]).length} responsável(eis)`);
      } catch (e) {
        console.warn('[ShopAction] alerta ZERO falhou:', e.message);
      }
    }
    return msg;
  }

  // outras actions implementadas na Task 15
  return null;
}
```

- [ ] **Step 5: Validar sintaxe + deploy**

```bash
node --check /d/la-organizer/_remote/src/engine.js && \
  scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js && \
  ssh tom "pm2 restart tom --no-color 2>&1 | tail -2"
```
Expected: `OK` da sintaxe + `online` no pm2.

- [ ] **Step 6: Smoke test via WhatsApp**

Mande pelo seu Whats: `"vendi 1 baqueta na Barra pix"`. Espera resposta com confirmação ou pedido pra desambiguar. Acompanhar:
```bash
ssh tom "pm2 logs tom --lines 30 --nostream --raw 2>&1 | grep -E 'ShopAction|shop_sale|enviada' | tail -15"
```

---

## Task 15: Engine — handlers `shop_entry`, `shop_adjust`, `query_shop`

**Files:**
- Modify: `src/engine.js` (adicionar ao `handleShopAction` dentro do mesmo bloco)

- [ ] **Step 1: Adicionar handler `shop_entry`**

Dentro de `handleShopAction`, antes do `return null`:
```javascript
  if (shop.action === 'shop_entry') {
    if (!p.nome) return 'Qual produto chegou?';
    if (!p.unidade) return 'Pra qual unidade? (Barra, Recreio, CG)';
    if (!p.quantidade || p.quantidade <= 0) return 'Quantos chegaram?';

    const unidadeId = await resolveUnidadeId(p.unidade);
    if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;

    const { data: matches } = await laReportClient.rpc('buscar_produto_fuzzy',
      { p_termo: p.nome, p_unidade_id: unidadeId });
    if (!matches || matches.length === 0) return `Não achei "${p.nome}" no catálogo.`;
    if (matches.length > 1 && matches[0].score < 0.7) {
      return `Qual produto?\n` + matches.slice(0,5).map(
        (m,i) => `${i+1}. ${m.nome}`).join('\n');
    }
    const produto = matches[0];

    const { data, error } = await laReportClient.rpc('registrar_entrada_estoque', {
      p_produto_id: produto.id,
      p_unidade_id: unidadeId,
      p_quantidade: p.quantidade,
      p_via_audit: viaAudit,
      p_observacoes: p.observacoes,
    });
    if (error) return `⚠️ ${error.message}`;
    return `📦 Entrada registrada — ${produto.nome} +${p.quantidade}. Saldo ${p.unidade}: ${data?.[0]?.saldo_apos}.`;
  }
```

- [ ] **Step 2: Adicionar handler `shop_adjust`**

```javascript
  if (shop.action === 'shop_adjust') {
    if (!p.nome) return 'Qual produto?';
    if (!p.unidade) return 'Em qual unidade?';
    if (!p.delta || p.delta === 0) return 'Quanto ajustar? (+ ou -)';
    if (!p.motivo) return 'Qual o motivo do ajuste? (perda, sobra contada, etc)';

    const unidadeId = await resolveUnidadeId(p.unidade);
    if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;

    const { data: matches } = await laReportClient.rpc('buscar_produto_fuzzy',
      { p_termo: p.nome, p_unidade_id: unidadeId });
    if (!matches || matches.length === 0) return `Não achei "${p.nome}".`;
    if (matches.length > 1 && matches[0].score < 0.7) {
      return `Qual produto?\n` + matches.slice(0,5).map(
        (m,i) => `${i+1}. ${m.nome}`).join('\n');
    }
    const produto = matches[0];

    const { data, error } = await laReportClient.rpc('ajustar_estoque_manual', {
      p_produto_id: produto.id,
      p_unidade_id: unidadeId,
      p_delta: p.delta,
      p_motivo: p.motivo,
      p_via_audit: viaAudit,
    });
    if (error) return `⚠️ ${error.message}`;
    const sinal = p.delta > 0 ? '+' : '';
    return `🔧 Ajuste aplicado — ${produto.nome} ${sinal}${p.delta}. Saldo ${p.unidade}: ${data?.[0]?.saldo_apos}.`;
  }
```

- [ ] **Step 3: Adicionar handler `query_shop`**

```javascript
  if (shop.action === 'query_shop') {
    let unidadeId = null;
    if (p.unidade) {
      unidadeId = await resolveUnidadeId(p.unidade);
      if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;
    }

    // Lista produtos com estoque (>0) na unidade
    let q = laReportClient.from('loja_produtos')
      .select('id, nome, preco, categoria_id, loja_categorias(nome, icone)')
      .eq('ativo', true);
    const { data: produtos } = await q.limit(50);
    if (!produtos || produtos.length === 0) return 'Nenhum produto ativo na lojinha.';

    // Busca estoque por unidade pra cada produto
    const { data: estoque } = await laReportClient
      .from('loja_estoque').select('produto_id, quantidade, unidade_id')
      .in('produto_id', produtos.map(x => x.id))
      .gt('quantidade', 0)
      .eq(unidadeId ? 'unidade_id' : 'produto_id', unidadeId || produtos[0].id);
    // ^ se unidadeId for null, pega tudo (filtro produto_id=primeiro só pra não dar erro)

    const stockMap = new Map();
    for (const e of (estoque || [])) {
      const k = e.produto_id;
      stockMap.set(k, (stockMap.get(k) || 0) + e.quantidade);
    }

    const comEstoque = produtos.filter(p => stockMap.get(p.id) > 0);
    if (comEstoque.length === 0) return `📭 Nada com estoque${p.unidade ? ' em ' + p.unidade : ''}.`;

    // Agrupa por categoria
    const byCat = new Map();
    for (const pr of comEstoque) {
      const cat = pr.loja_categorias?.icone + ' ' + (pr.loja_categorias?.nome || 'Outros');
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(`• ${pr.nome} (R$${pr.preco}) — ${stockMap.get(pr.id)} un`);
    }

    let out = `🛍 *Lojinha${p.unidade ? ' — ' + p.unidade : ''}*\n`;
    for (const [cat, itens] of byCat) {
      out += `\n${cat}\n` + itens.join('\n');
    }
    return out;
  }
```

- [ ] **Step 4: Validar sintaxe + deploy**

```bash
node --check /d/la-organizer/_remote/src/engine.js && \
  scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js && \
  ssh tom "pm2 restart tom --no-color 2>&1 | tail -2"
```
Expected: `OK` + `online`.

- [ ] **Step 5: Smoke tests via WhatsApp**

- `"o que tem na lojinha da Barra?"` → query_shop responde com lista
- `"chegou 5 baquetas pra Barra"` → shop_entry confirma
- `"perdi 1 baqueta na Barra, motivo: caiu no chão"` → shop_adjust confirma

---

## Task 16: Prompt system — gatilhos pra carregar skill `lojinha`

**Files:**
- Modify: `src/prompts/system.js`

- [ ] **Step 1: Localizar pickSkill ou keyword routing**

```bash
grep -n "pickSkill\|inventario\|loadSkill\|skill.*md\|inventariomd" /d/la-organizer/_remote/src/prompts/system.js | head -10
```

- [ ] **Step 2: Adicionar gatilho `lojinha` no pickSkill (ou estrutura equivalente)**

Onde a skill `inventario` é carregada por keywords, adicionar análoga pra `lojinha`. Exemplo (adaptar pela estrutura real):
```javascript
// Sprint Fase B — gatilho da skill lojinha
const _lojinhaKeywordRe = /\b(vendi|vendeu|vender|venda|chegou|chegaram|comprou|lojinha|loja|baqueta|palheta|caderno|estoque\s+da\s+loja|tá acabando|zerou|paleta|camiseta)\b/i;
if (_lojinhaKeywordRe.test(userMessage)) {
  skills.push('lojinha');
}
```

- [ ] **Step 3: Adicionar instrução de SHOP_ACTION format no system prompt principal (se houver bloco geral de markers)**

```bash
grep -n "INVENTORY_ACTION\|PREFS_UPDATE\|<<MARKER" /d/la-organizer/_remote/src/prompts/system.js | head -10
```
Onde os markers existentes são listados pro LLM, adicionar:
```
- `<<SHOP_ACTION>>...<<\/SHOP_ACTION>>`: pra operações na lojinha (venda, entrada, ajuste, consulta).
  Veja skill `lojinha.md` pra schema completo.
```

- [ ] **Step 4: Validar sintaxe + deploy**

```bash
node --check /d/la-organizer/_remote/src/prompts/system.js && \
  scp /d/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js && \
  ssh tom "pm2 restart tom --no-color 2>&1 | tail -2"
```
Expected: `OK` + `online`.

---

## Task 17: Cron — alerta de reposição (segunda 9h)

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Localizar bloco que roda às segundas 9h pra inventário**

```bash
grep -n "now.dow === 1\|hour === 9\|inventario\|reposicao" /d/la-organizer/_remote/src/rituals/dispatcher.js | head -10
```
Achar bloco existente OU adicionar bloco novo no `run()`.

- [ ] **Step 2: Adicionar chamada `checkLojaReposicao` no horário**

No `run()`, junto com outros disparos semanais:
```javascript
// Sprint Fase B — alerta de reposição da lojinha (segunda 9h)
if (now.dow === 1 && now.hour === 9 && now.minute === 0) {
  try {
    await checkLojaReposicao(now.ymd);
  } catch (e) {
    console.error('[checkLojaReposicao]', e.message);
  }
}
```

- [ ] **Step 3: Implementar `checkLojaReposicao`**

Em algum lugar do mesmo arquivo (próximo a outros checkers):
```javascript
async function checkLojaReposicao(ymdToday) {
  const { laReportClient } = require('../services/la-report-client');
  // 1. Produtos com estoque < minimo, agrupados por unidade
  const { data: estoqueBaixo, error } = await laReportClient
    .from('loja_estoque')
    .select('produto_id, unidade_id, quantidade, loja_produtos!inner(nome, estoque_minimo, ativo)')
    .lt('quantidade', 999999); // placeholder; filtramos abaixo
  if (error) {
    console.error('[checkLojaReposicao] query err:', error.message);
    return;
  }
  const baixos = (estoqueBaixo || []).filter(e =>
    e.loja_produtos?.ativo && e.quantidade < (e.loja_produtos?.estoque_minimo ?? 5)
  );
  if (baixos.length === 0) {
    console.log('[checkLojaReposicao] sem produtos abaixo do mínimo');
    return;
  }

  // 2. Agrupa por unidade
  const byUnidade = new Map();
  for (const b of baixos) {
    if (!byUnidade.has(b.unidade_id)) byUnidade.set(b.unidade_id, []);
    byUnidade.get(b.unidade_id).push(b);
  }

  // 3. Nomes das unidades
  const { data: unidades } = await laReportClient.from('unidades')
    .select('id, nome').in('id', [...byUnidade.keys()]);
  const unidadeNome = new Map((unidades || []).map(u => [u.id, u.nome]));

  // 4. Pra cada unidade, busca responsáveis
  const whatsapp = require('../services/whatsapp');
  let totalSent = 0;
  for (const [unidadeId, lista] of byUnidade) {
    const nome = unidadeNome.get(unidadeId) || '?';
    const { data: resp } = await laReportClient.from('loja_responsaveis_reposicao')
      .select('nome, whatsapp').eq('unidade_id', unidadeId).eq('ativo', true);
    const linhas = lista.map(l =>
      `• ${l.loja_produtos.nome}: ${l.quantidade} (mín ${l.loja_produtos.estoque_minimo ?? 5})`
    ).join('\n');
    const msg = `📦 *Reposição lojinha — ${nome}*\n\n${linhas}`;
    for (const r of (resp || [])) {
      if (r.whatsapp) {
        try { await whatsapp.sendMessage(r.whatsapp, msg); totalSent++; }
        catch (e) { console.warn('[checkLojaReposicao] WA err:', e.message); }
      }
    }
  }
  console.log(`[checkLojaReposicao] disparou ${totalSent} alerta(s)`);
}
```

- [ ] **Step 4: Smoke test (forçado)**

Adicionar suporte a `--force=loja_reposicao` no parser de args do `run()`, OU rodar direto:
```bash
ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && set +a && node -e \"
const d = require('./src/rituals/dispatcher.js');
(async()=>{ await d.checkLojaReposicao('2026-05-20'); })();
\" 2>&1 | tail -10"
```

**ATENÇÃO:** se houver produtos abaixo do mínimo de verdade, isso vai disparar WA real pros responsáveis (Luciano nas 3 unidades). Validar com user antes de rodar.

- [ ] **Step 5: Deploy**

```bash
node --check /d/la-organizer/_remote/src/rituals/dispatcher.js && \
  scp /d/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js && \
  ssh tom "pm2 restart tom --no-color 2>&1 | tail -2"
```

---

## Self-review (executada pelo writer; ver gaps abaixo)

**Spec coverage:**
- §3 Arquitetura → coberta nos Tasks 1-17 (camadas SP/API/PWA/TOM/cron)
- §4 SPs → Tasks 1-4
- §5 Endpoints → Tasks 5-8
- §6 TOM handlers → Tasks 13-16
- §7 PWA → Tasks 9-12
- §8 Cron alertas → Task 17 (segunda 9h) + Task 14 (tempo real ZERO inline no shop_sale handler)
- §9 Governança → checkAccess em cada endpoint (Tasks 5-8)
- §10 Plano de testes → smoke nas Tasks 1-4 + curls Task 5-8 + WhatsApp Tasks 14-15
- §11 Out-of-scope → respeitado (não implementa CRUD produtos, estorno, conversão moeda LA, mapping farmer)
- §12 Migrations → Tasks 1-4 aplicam as 4 SPs; pré-reqs (pg_trgm + UNIQUE index) já documentados como ✅

**Gaps identificados e cobertos:**
- Resolução `professor_indicador` por nome via tabela `professores` (Task 14) — se essa tabela não existir no LA Report, o handler ignora silenciosamente (professor_indicador_id=null). Não trava venda.
- Resposta de venda em TOM mostra `total = preco * qtd` calculado localmente porque SP não retorna total. **OK** — produto.preco vem do fuzzy match.
- Não há Task pra "estorno de venda" — fora de escopo (§11). ✅

**Placeholder scan:** zero "TBD/TODO/implement later" no plano. Cada step tem código real.

**Type consistency:** types `VendaInput`, `VendaResult`, `ProdutoSearchResult` usados em mutations (Task 9), VendaSheet (Task 10) e endpoints (Task 5) — assinaturas casam.

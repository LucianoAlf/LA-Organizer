# Sprint Fase B — Lojinha Bidirecional (LA Report ↔ PWA ↔ TOM)

**Data:** 2026-05-20  
**Autor:** Claude Code (brainstorming com Alf)  
**Status:** Aprovado pra plano  
**Sprint anterior:** [Fase A — Inventário Bidirecional](2026-05-17-inventario-bidirecional-design.md)

---

## 1. Objetivo

Estender a integração LA Organizer ↔ LA Report ↔ TOM (entregue na Fase A pra `inventario`) cobrindo agora `loja_*` (12 tabelas). Lifecycle completo de venda, entrada, ajuste, alerta de reposição e comissões — operável via WhatsApp (TOM) e PWA.

---

## 2. Decisões-chave (referência rápida)

| Decisão | Escolha |
|---|---|
| Banco-alvo das SPs | **LA Report** (`ouqwbbermlzqqvtqwlul`), não LA Organizer |
| Campos venda TOM | produto + unidade + forma_pagamento (cliente_nome NULL default, tipo_cliente='avulso') |
| Variações | Suportar mas opcional (TOM pergunta só se produto tiver variações cadastradas) |
| Comissões | 5% professor indicador → credita `loja_carteira` direto. 5% farmer → calculado mas **não creditado** nesta sprint (depende de mapping cross-project, ver §11). Saldo em R$, sem conversão moeda LA. |
| Conversão Moeda LA | Não nessa fase (saldo R$ acumula; conversão manual depois) |
| Alertas reposição | Cron segunda 9h (resumo) + tempo real só quando estoque=0 |
| Permissões escrita | Mesma de leitura: Direção, Rafinha (ops_tecnicas), Gerentes (🔒u), Farmers (🔒u) |
| Arquitetura venda | **Stored Procedure atômica** (`registrar_venda`) — ACID, BEGIN/EXCEPTION/END |
| Fuzzy match produto | SP simples (`buscar_produto_fuzzy`) ou ILIKE no service — fora da transação |

---

## 3. Arquitetura

### 3.1 Camadas

```
┌──────────────────┐   ┌──────────────────┐   ┌────────────────────────┐
│  TOM (WhatsApp)  │   │  PWA (React)     │   │  Cron (dispatcher.js)  │
│  engine.js       │   │  LojaPage.tsx +  │   │  Alertas reposição     │
│  SHOP_ACTION     │   │  VendaSheet etc  │   │  (segunda 9h + tr ZERO)│
└────────┬─────────┘   └────────┬─────────┘   └───────────┬────────────┘
         │                      │                         │
         │                      │                         │
         ▼                      ▼                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  API serverless (Vercel) — web/api/lareport/loja/*                    │
│  /venda  /entrada  /ajuste  (POST autenticado + checkAccess)          │
│  Reusa _lib/auth, _lib/access-control, _lib/audit (Fase A)            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ supabase.rpc()
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LA Report Postgres (ouqwbbermlzqqvtqwlul)                            │
│  Stored Procedures novas (PL/pgSQL, SECURITY DEFINER):                │
│    registrar_venda(...)       — atômica, 5 ops + comissão             │
│    registrar_entrada_estoque  — INSERT + UPDATE saldo                 │
│    ajustar_estoque_manual     — UPDATE direto, audit-trail            │
│    buscar_produto_fuzzy(termo, unidade) — opcional, helper            │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Boundary entre LA Organizer e LA Report

- **LA Organizer DB** (`cesnbnrynvxvgdhfmaua`): `collaborators`, `tasks`, `events`, `ritual_logs`, `notifications`. **Não muda nesta sprint.**
- **LA Report DB** (`ouqwbbermlzqqvtqwlul`): `loja_*` (12 tabelas). **Todas SPs novas aqui.**
- Auth: PWA já tem `useAccess('loja_produtos')`. API endpoints validam JWT no LA Organizer e re-validam ACL via `checkAccess(collab, 'loja_produtos')`.

### 3.3 Cross-project ID mapping (regra R1 da Fase A)

`loja_*.colaborador_id` é INT (LA Report) ≠ `collaborators.id` UUID (LA Organizer). Não há mapping confiável → **gravar NULL** + injetar `"via TOM/PWA por <full_name>"` em `observacoes`. Sem exceção.

---

## 4. Stored Procedures (PL/pgSQL no LA Report)

### 4.1 `registrar_venda` — operação atômica

**Assinatura:**
```sql
CREATE OR REPLACE FUNCTION public.registrar_venda(
  p_produto_id      INT,
  p_variacao_id     INT DEFAULT NULL,   -- opcional
  p_unidade_id      UUID,
  p_quantidade      INT,                 -- > 0
  p_forma_pagamento VARCHAR,             -- 'pix'|'credito'|'debito'|'dinheiro'
  p_tipo_cliente    VARCHAR DEFAULT 'avulso',
  p_cliente_nome    VARCHAR DEFAULT NULL,
  p_aluno_id        INT DEFAULT NULL,
  p_professor_indicador_id INT DEFAULT NULL,
  p_desconto        NUMERIC DEFAULT 0,
  p_parcelas        INT DEFAULT 1,
  p_observacoes     TEXT DEFAULT NULL,
  p_via_audit       TEXT NOT NULL        -- "via TOM por Rafinha" ou "via PWA por Quintela"
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
  -- 1. Lê preço e nome do produto (ou variação)
  IF p_variacao_id IS NOT NULL THEN
    SELECT preco, nome INTO v_preco_unit, v_variacao_nome FROM loja_variacoes WHERE id=p_variacao_id AND ativo=TRUE;
    IF v_preco_unit IS NULL THEN RAISE EXCEPTION 'variacao_inexistente_ou_inativa'; END IF;
  END IF;
  IF v_preco_unit IS NULL THEN
    SELECT preco, nome INTO v_preco_unit, v_produto_nome FROM loja_produtos WHERE id=p_produto_id AND ativo=TRUE;
    IF v_preco_unit IS NULL THEN RAISE EXCEPTION 'produto_inexistente_ou_inativo'; END IF;
  ELSE
    SELECT nome INTO v_produto_nome FROM loja_produtos WHERE id=p_produto_id;
  END IF;

  -- 2. Lock e checa estoque suficiente
  SELECT quantidade INTO v_saldo_atual FROM loja_estoque
    WHERE produto_id=p_produto_id AND unidade_id=p_unidade_id
      AND (variacao_id IS NOT DISTINCT FROM p_variacao_id)
    FOR UPDATE;
  IF v_saldo_atual IS NULL THEN RAISE EXCEPTION 'estoque_inexistente_pra_unidade'; END IF;
  IF v_saldo_atual < p_quantidade THEN RAISE EXCEPTION 'estoque_insuficiente: tem %, pediu %', v_saldo_atual, p_quantidade; END IF;
  v_saldo_novo := v_saldo_atual - p_quantidade;

  -- 3. Calcula totais
  v_subtotal := v_preco_unit * p_quantidade;
  v_total := v_subtotal - COALESCE(p_desconto,0);

  -- 4. INSERT loja_vendas
  INSERT INTO loja_vendas (
    unidade_id, data_venda, tipo_cliente, cliente_nome, aluno_id, professor_indicador_id,
    subtotal, desconto, total, forma_pagamento, parcelas, observacoes, status, vendedor_id
  ) VALUES (
    p_unidade_id, NOW(), p_tipo_cliente, p_cliente_nome, p_aluno_id, p_professor_indicador_id,
    v_subtotal, COALESCE(p_desconto,0), v_total, p_forma_pagamento, p_parcelas,
    CONCAT_WS(' — ', NULLIF(p_observacoes,''), p_via_audit), 'concluida', NULL
  ) RETURNING id INTO v_venda_id;

  -- 5. INSERT loja_vendas_itens
  INSERT INTO loja_vendas_itens (venda_id, produto_id, variacao_id, produto_nome, variacao_nome,
    quantidade, preco_unitario, subtotal)
  VALUES (v_venda_id, p_produto_id, p_variacao_id, v_produto_nome, v_variacao_nome,
    p_quantidade, v_preco_unit, v_subtotal);

  -- 6. UPDATE loja_estoque
  UPDATE loja_estoque SET quantidade=v_saldo_novo, updated_at=NOW()
    WHERE produto_id=p_produto_id AND unidade_id=p_unidade_id
      AND (variacao_id IS NOT DISTINCT FROM p_variacao_id);

  -- 7. INSERT loja_movimentacoes_estoque
  INSERT INTO loja_movimentacoes_estoque (produto_id, variacao_id, unidade_id, tipo, quantidade,
    saldo_apos, referencia_id, colaborador_id, observacoes)
  VALUES (p_produto_id, p_variacao_id, p_unidade_id, 'venda', -p_quantidade,
    v_saldo_novo, v_venda_id, NULL, p_via_audit);

  -- 8. Comissões (lê configs ativas)
  SELECT (valor::numeric)/100 INTO v_comissao_farmer_pct FROM loja_configuracoes WHERE chave='comissao_farmer_padrao';
  SELECT (valor::numeric)/100 INTO v_comissao_prof_pct   FROM loja_configuracoes WHERE chave='comissao_professor_indicacao';
  v_comissao_farmer_pct := COALESCE(v_comissao_farmer_pct, 0.05);
  v_comissao_prof_pct   := COALESCE(v_comissao_prof_pct,   0.05);

  -- Farmer: identificado por p_via_audit não é estável → NÃO credita farmer aqui (não temos colaborador_id seguro).
  -- Decisão design: comissão de farmer fica como TODO até mapping cross-project ser resolvido (ver §11).
  -- Por ora, calcula valor mas não credita carteira.
  v_comissao_farmer := v_total * v_comissao_farmer_pct;

  -- Professor indicador: SE p_professor_indicador_id ≠ NULL → credita carteira do professor.
  IF p_professor_indicador_id IS NOT NULL THEN
    v_comissao_prof := v_total * v_comissao_prof_pct;
    SELECT id INTO v_carteira_id FROM loja_carteira
      WHERE tipo_titular='professor' AND professor_id=p_professor_indicador_id AND unidade_id=p_unidade_id;
    IF v_carteira_id IS NULL THEN
      INSERT INTO loja_carteira (tipo_titular, professor_id, unidade_id, saldo, moedas_la)
      VALUES ('professor', p_professor_indicador_id, p_unidade_id, v_comissao_prof, 0)
      RETURNING id INTO v_carteira_id;
    ELSE
      UPDATE loja_carteira SET saldo=saldo+v_comissao_prof WHERE id=v_carteira_id;
    END IF;
    INSERT INTO loja_carteira_movimentacoes (carteira_id, tipo, valor, saldo_apos, referencia_tipo, referencia_id, descricao)
    VALUES (v_carteira_id, 'credito', v_comissao_prof,
      (SELECT saldo FROM loja_carteira WHERE id=v_carteira_id),
      'venda', v_venda_id, CONCAT('Indicação venda #', v_venda_id, ' — ', p_via_audit));
  END IF;

  RETURN QUERY SELECT v_venda_id, v_saldo_novo, v_comissao_farmer, v_comissao_prof;
END;
$$;
```

**Notas:**
- `BEGIN/EXCEPTION/END` implícito: qualquer `RAISE` no meio aborta TUDO (rollback automático).
- `FOR UPDATE` no SELECT do estoque evita race condition de 2 vendas simultâneas pro mesmo produto.
- Comissão de **farmer** fica calculada mas **não creditada** — sem mapping cross-project confiável (R1). Documentado em §11.
- Comissão de **professor indicador** funciona porque `professor_indicador_id` é INT nativo do LA Report (sem cross-project).

### 4.2 `registrar_entrada_estoque`

```sql
CREATE OR REPLACE FUNCTION public.registrar_entrada_estoque(
  p_produto_id INT, p_variacao_id INT DEFAULT NULL,
  p_unidade_id UUID, p_quantidade INT,  -- > 0
  p_observacoes TEXT DEFAULT NULL, p_via_audit TEXT NOT NULL
) RETURNS TABLE (saldo_apos INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_saldo INT;
BEGIN
  IF p_quantidade <= 0 THEN RAISE EXCEPTION 'quantidade_deve_ser_positiva'; END IF;
  -- upsert estoque
  -- UNIQUE index já criado: loja_estoque_produto_unidade_variacao_uq
  --   ON loja_estoque (produto_id, unidade_id, COALESCE(variacao_id, 0))
  -- ON CONFLICT precisa usar EXATAMENTE a mesma expressão do index.
  INSERT INTO loja_estoque (produto_id, variacao_id, unidade_id, quantidade, updated_at)
  VALUES (p_produto_id, p_variacao_id, p_unidade_id, p_quantidade, NOW())
  ON CONFLICT (produto_id, unidade_id, COALESCE(variacao_id, 0)) DO UPDATE
    SET quantidade = loja_estoque.quantidade + EXCLUDED.quantidade, updated_at=NOW()
  RETURNING quantidade INTO v_saldo;

  INSERT INTO loja_movimentacoes_estoque (produto_id, variacao_id, unidade_id, tipo,
    quantidade, saldo_apos, colaborador_id, observacoes)
  VALUES (p_produto_id, p_variacao_id, p_unidade_id, 'entrada',
    p_quantidade, v_saldo, NULL, CONCAT_WS(' — ', NULLIF(p_observacoes,''), p_via_audit));
  RETURN QUERY SELECT v_saldo;
END;
$$;
```

**Pre-req:** ✅ JÁ APLICADO no LA Report — UNIQUE index `loja_estoque_produto_unidade_variacao_uq` em `(produto_id, unidade_id, COALESCE(variacao_id, 0))`.

### 4.3 `ajustar_estoque_manual`

Semelhante a entrada, mas grava `tipo='ajuste'` e aceita delta positivo OU negativo. Audit-trail completo nas observações.

### 4.4 `buscar_produto_fuzzy` (helper, opcional)

```sql
CREATE OR REPLACE FUNCTION public.buscar_produto_fuzzy(p_termo TEXT, p_unidade_id UUID DEFAULT NULL)
RETURNS TABLE (id INT, nome VARCHAR, sku VARCHAR, preco NUMERIC, estoque INT, score REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.nome, p.sku, p.preco,
    COALESCE((SELECT quantidade FROM loja_estoque e
              WHERE e.produto_id=p.id AND (p_unidade_id IS NULL OR e.unidade_id=p_unidade_id) LIMIT 1), 0),
    similarity(p.nome, p_termo) AS score
  FROM loja_produtos p
  WHERE p.ativo=TRUE AND (p.nome ILIKE '%'||p_termo||'%' OR similarity(p.nome, p_termo) > 0.2)
  ORDER BY score DESC, p.nome ASC LIMIT 5;
$$;
```

**Pre-req:** ✅ JÁ APLICADO no LA Report — extensão `pg_trgm` habilitada.

---

## 5. API endpoints (serverless Vercel)

Diretório: `web/api/lareport/loja/`

| Endpoint | Método | Body | Chama SP |
|---|---|---|---|
| `/api/lareport/loja/venda` | POST | `{produto_id, variacao_id?, unidade_id, quantidade, forma_pagamento, tipo_cliente?, cliente_nome?, aluno_id?, professor_indicador_id?, desconto?, parcelas?, observacoes?}` | `registrar_venda` |
| `/api/lareport/loja/entrada` | POST | `{produto_id, variacao_id?, unidade_id, quantidade, observacoes?}` | `registrar_entrada_estoque` |
| `/api/lareport/loja/ajuste` | POST | `{produto_id, variacao_id?, unidade_id, delta, motivo}` | `ajustar_estoque_manual` |
| `/api/lareport/loja/buscar` | GET | `?termo=...&unidade_id=...` | `buscar_produto_fuzzy` |

Padrão de cada handler (reusa `_lib/`):
```ts
1. Valida JWT (Bearer) + busca collaborator no LA Organizer
2. checkAccess(collab, 'loja_produtos')
3. Se collab.role in ['gerente','farmer']: valida que payload.unidade_id == collab.unit_id
4. p_via_audit = `via PWA por ${collab.full_name}`
5. supabase.rpc('registrar_venda', {...payload, p_via_audit})
6. audit log (já existe _lib/audit.ts)
7. Retorna resultado da SP
```

---

## 6. TOM — handlers WhatsApp

### 6.1 Skill nova: `skills/lojinha.md`

Carregada quando o LLM detectar intenção de loja (palavras-chave: vendi, vendendo, comprou, chegou produto, estoque loja, lojinha, ajuste estoque, palhetas, baquetas, cordas, caderno, camiseta).

### 6.2 Marker novo: `<<SHOP_ACTION>>`

```
<<SHOP_ACTION>>
{
  "action": "shop_sale" | "shop_entry" | "shop_adjust" | "query_shop",
  "params": { ... }
}
<</SHOP_ACTION>>
```

**Action `shop_sale`** — params: `nome` (do produto), `quantidade`, `unidade` (nome ou alias), `forma_pagamento`, `variacao?`, `cliente_nome?`, `professor_indicador?`.

**Aliases aceitos pelo normalizer:** `produto/item/name → nome`; `qtd/qty/amount → quantidade`; `unit/loja/local → unidade`; `pgto/pagamento/payment → forma_pagamento`.

### 6.3 Handler `shop_sale` no engine.js (pseudocódigo)

```js
case 'shop_sale': {
  // 1. Normaliza aliases (mesma estratégia do move_item da Fase A)
  // 2. Resolve unidade_id por nome
  // 3. supabase.rpc('buscar_produto_fuzzy', { p_termo: p.nome, p_unidade_id: unidadeId })
  // 4a. 0 resultados → "Não achei '<nome>' na lojinha de <unidade>."
  // 4b. 1 resultado com score>0.7 → segue
  // 4c. 2+ resultados OU score baixo → lista numerada + memoriza contexto pendente (collaborator_memory) + pede "qual?"
  // 5. Confirma forma_pagamento se faltou (default: pergunta)
  // 6. (Se produto tem variações ativas) lista variações e pede
  // 7. supabase.rpc('registrar_venda', {...})
  // 8. Reply: "✅ Venda registrada — <produto> x<qtd> (R$<total>, <forma>). Estoque <unidade>: <saldo>."
  // 9. (Se professor_indicador foi creditado) anexa: "💰 Comissão R$<x> creditada pra <professor>."
}
```

**Confirmação:** registra direto se score>0.7 E venda < R$100. Se ≥ R$100 ou ambíguo, mostra resumo + pede "confirma? sim/não".

### 6.4 Handler `query_shop`

Lista produtos da unidade com estoque. Formato compacto agrupado por categoria (igual `query_room` da Fase A).

### 6.5 Slash command `/loja` e `/loja estoque`

- `/loja` → resumo: N produtos, X com estoque baixo, valor total estoque.
- `/loja estoque` → lista detalhada (mesmo formato do `query_shop`).

---

## 7. PWA — extensão da LojaPage

Diretório: `web/src/screens/inventario/LojaPage.tsx` (já existe, 74 linhas).

### 7.1 Stats adicionais (topo)

```
┌─────────────┬──────────────┬───────────────────┐
│ N produtos  │ Estoque baixo│ Valor em estoque  │
└─────────────┴──────────────┴───────────────────┘
```

### 7.2 FAB (canto inferior direito)

Botão expansível com 2 ações (reusa `<Fab>` da Fase A):
- 💰 **Registrar venda** → abre `VendaSheet`
- 📦 **Lançar entrada** → abre `EntradaEstoqueSheet`

### 7.3 Componentes novos

**`VendaSheet`** (em `screens/inventario/components/VendaSheet.tsx`):
- Select produto (com autocomplete via `useReportLoja`)
- Select variação (mostra só se produto tem variações)
- Input quantidade
- Select forma_pagamento (CustomSelect do DS: pix/crédito/débito/dinheiro)
- Input cliente_nome (opcional, livre)
- Select tipo_cliente (CustomSelect: aluno/avulso/colaborador)
- Select professor_indicador (CustomSelect populado de `loja_carteira.tipo_titular='professor'`, opcional)
- Input desconto (opcional, R$ ou %)
- Input observações (opcional)
- Botão "Registrar"

**`EntradaEstoqueSheet`** (em `screens/inventario/components/EntradaEstoqueSheet.tsx`):
- Select produto + variação
- Input quantidade
- Input observações
- Botão "Lançar entrada"

**(Opcional Fase B+)** `AjusteEstoqueSheet` — vai com FAB só pra Direção+Rafinha.

### 7.4 Mutations no `lareport-mutations.ts`

```ts
export async function registrarVenda(payload: {...}): Promise<{venda_id: number, saldo_apos: number, ...}>
export async function registrarEntradaEstoque(payload: {...}): Promise<{saldo_apos: number}>
export async function ajustarEstoque(payload: {...}): Promise<{saldo_apos: number}>
```

Cada uma faz `fetch('/api/lareport/loja/<endpoint>', ...)` com JWT.

### 7.5 Realtime

Já existe infra. Adicionar canal `loja_estoque` no `useReportLoja` hook → invalida cache quando vier event de INSERT/UPDATE.

---

## 8. Cron — alertas de reposição

Arquivo: `src/rituals/dispatcher.js`.

### 8.1 Cron de segunda 9h (resumo)

Adicionar dentro do bloco existente que já roda inventário às segundas:

```js
if (now.dow === 1 && now.hour === 9 && now.minute === 0) {
  await checkLojaReposicao(now.ymd);
}

async function checkLojaReposicao(ymdToday) {
  // 1. Query produtos com estoque < estoque_minimo agrupados por unidade
  // 2. Pra cada unidade, busca loja_responsaveis_reposicao
  // 3. Monta msg: "📦 Reposição loja <unidade>: <produto> tem <X>, mínimo <Y> (...)"
  // 4. Envia pra Rafinha (sempre) + responsáveis da unidade
  // 5. Logger usa ritual_logs.ritual_type='loja_reposicao'
}
```

### 8.2 Tempo real — apenas quando estoque chega a ZERO

Implementado no handler `registrar_venda` em JS (após retorno da SP):
```js
if (resultado.saldo_apos === 0) {
  // dispara WA imediato pra Rafinha + responsáveis da unidade
  // log em ritual_logs.ritual_type='loja_zerou'
}
```

---

## 9. Governança e auditoria

| Operação | Quem pode | Filtro |
|---|---|---|
| Ler loja (produtos/estoque/vendas) | Direção, Rafinha, Gerente, Farmer | Gerente/Farmer: 🔒 sua unidade |
| Registrar venda | Direção, Rafinha, Gerente, Farmer | Gerente/Farmer: 🔒 sua unidade |
| Lançar entrada | Direção, Rafinha, Gerente, Farmer | Gerente/Farmer: 🔒 sua unidade |
| Ajuste manual | Direção, Rafinha, Gerente, Farmer | Gerente/Farmer: 🔒 sua unidade |

**Trilha de auditoria:** toda operação injeta `"via TOM por <nome>"` ou `"via PWA por <nome>"` em `observacoes` (loja_vendas, loja_movimentacoes_estoque) e em `descricao` (loja_carteira_movimentacoes). Padrão R1 da Fase A.

---

## 10. Plano de testes (smoke)

| Cenário | Ferramenta | Resultado esperado |
|---|---|---|
| Venda 1 produto, score=1.0 | TOM no WhatsApp ("vendi 1 baqueta na Barra") | Confirma direto, registra, retorna saldo |
| Venda ambígua (2 produtos com nomes parecidos) | TOM | Lista numerada, espera escolha, registra |
| Venda > R$100 | TOM | Pede confirmação "sim/não" |
| Venda com estoque insuficiente | TOM ou PWA | Erro `estoque_insuficiente` propaga pra UI |
| Venda atômica falha no meio | Manual (SP com RAISE intermediário em ambiente dev) | Rollback completo, nenhuma tabela alterada |
| Race: 2 vendas simultâneas pro mesmo produto | Smoke via 2 chamadas paralelas | FOR UPDATE serializa, uma falha por estoque_insuficiente |
| Entrada estoque sem registro prévio em loja_estoque | PWA | INSERT com upsert, saldo = qtd |
| Comissão professor | Venda com professor_indicador_id setado | Credita carteira do professor, INSERT em loja_carteira_movimentacoes |
| Comissão farmer | Venda sem mapping confiável | Calcula valor, NÃO credita (TODO documentado) |
| Alerta segunda 9h | Cron força com `--force=loja_reposicao` | WA pra Rafinha + responsáveis |
| Alerta tempo real ZERO | Venda que zera estoque | WA imediato pra Rafinha + responsáveis |
| Gerente da Barra tentando venda em CG | API | 403 unit_filter_denied |

---

## 11. Out-of-scope (Fase B+ documentado)

- **Mapping cross-project `collaborators.id` (UUID) ↔ `loja_*.colaborador_id` (INT)** — sem isso, comissão de farmer fica calculada mas não creditada. Spec dedicado.
- **Conversão R$ → moeda LA** — quando atingir threshold definido.
- **CRUD de produtos** (cadastrar produto novo, editar preço/foto) — fora desta sprint, fica só lançamento operacional.
- **Estorno de venda** (`loja_vendas.status='estornada'`) — função `estornar_venda` semelhante à `registrar_venda` mas invertendo.
- **Variações: cadastrar/editar** — atualmente tabela `loja_variacoes` vazia. Suporte de **leitura** já entra na Fase B; cadastro fica fora.
- **Comissão pro vendedor (farmer logado)** — depende do mapping cross-project.
- **Dashboard de vendas** (gráficos, faturamento, top produtos) — leitura especializada, fora.

---

## 12. Migrations a aplicar

No **LA Report** (`ouqwbbermlzqqvtqwlul`):

### Pré-requisitos (✅ JÁ APLICADOS no banco — não precisa rodar)
- ✅ Extensão `pg_trgm` habilitada
- ✅ UNIQUE index `loja_estoque_produto_unidade_variacao_uq` em `(produto_id, unidade_id, COALESCE(variacao_id, 0))`

### A aplicar via MCP
1. `20260520_loja_sp_registrar_venda.sql` — função `registrar_venda` (§4.1)
2. `20260520_loja_sp_registrar_entrada.sql` — função `registrar_entrada_estoque` (§4.2)
3. `20260520_loja_sp_ajustar_estoque.sql` — função `ajustar_estoque_manual` (§4.3)
4. `20260520_loja_sp_buscar_produto_fuzzy.sql` — função `buscar_produto_fuzzy` (§4.4)

No **LA Organizer** (`cesnbnrynvxvgdhfmaua`): nenhuma migration.

---

## 13. Arquivos a criar/modificar (preview pro plan)

**Criar:**
- `web/api/lareport/loja/venda.ts`
- `web/api/lareport/loja/entrada.ts`
- `web/api/lareport/loja/ajuste.ts`
- `web/api/lareport/loja/buscar.ts`
- `web/src/screens/inventario/components/VendaSheet.tsx`
- `web/src/screens/inventario/components/EntradaEstoqueSheet.tsx`
- `skills/lojinha.md`
- `migrations/20260520_loja_*.sql` (×5)

**Modificar:**
- `web/src/screens/inventario/LojaPage.tsx` — stats novas, FAB com 2 ações
- `web/src/lib/lareport-mutations.ts` — `registrarVenda`, `registrarEntradaEstoque`, `ajustarEstoque`, `buscarProduto`
- `web/src/hooks/useLaReport.ts` — adicionar realtime channel `loja_estoque`, hook `useProdutoSearch`
- `src/engine.js` — parser `<<SHOP_ACTION>>`, handlers `shop_sale/shop_entry/shop_adjust/query_shop`
- `src/prompts/system.js` — instruções pro LLM sobre quando carregar skill lojinha + format de SHOP_ACTION
- `src/rituals/dispatcher.js` — `checkLojaReposicao` (segunda 9h) + chamada após venda zerar

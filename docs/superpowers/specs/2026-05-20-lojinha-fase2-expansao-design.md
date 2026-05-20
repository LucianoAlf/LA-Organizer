# Sprint Fase 2 — Lojinha Expansão (Venda Rica + CRUD + Operações Avançadas)

**Data:** 2026-05-20  
**Autor:** Claude Code (brainstorming com Alf)  
**Status:** Aprovado pra plano  
**Sprint anterior:** [Fase B — Lojinha Bidirecional](2026-05-20-lojinha-bidirecional-design.md)

---

## 1. Objetivo

Elevar a UX da lojinha do PWA ao nível da UI rica do LA Report (mostrada nos screenshots de referência) e cobrir operações avançadas: CRUD de produto, transferência entre unidades, estorno de venda e reservas. Mantém bidirecional com LA Report — toda operação no PWA aparece no banco e vice-versa.

---

## 2. Decisões-chave (referência rápida)

| Decisão | Escolha |
|---|---|
| Estrutura do spec | 1 spec único, 3 fases executadas em ordem (2.1 → 2.2 → 2.3) |
| Layout Venda | **Stepper 3 passos** mobile-first (não 2 colunas) |
| Carrinho | Multi-item (até N produtos numa venda) |
| Autocomplete aluno | **Server-side** (1480 alunos — debounce 200ms + ILIKE + LIMIT 10) |
| Comprovante WA | Checkbox no checkout, default ON se aluno tem telefone |
| Permissões escrita | **Tudo liberado** pra Direção, Coord, Rafinha, Gerente 🔒u, Farmer 🔒u (sem restrição extra em estorno/transferência/CRUD) |
| Estoque disponível com reservas | `loja_estoque.quantidade - SUM(loja_reservas WHERE status='ativa')` — só na Fase 2.3 |
| Produto = global / Estoque = por unidade | Mantido. CRUD produto não pede unidade. |
| Duplicata produto | Detecção por similarity > 0.7 — aviso, não bloqueio |
| Variações | Mantidas opcionais (Fase B já cobriu, Fase 2 não mexe) |

---

## 3. Permissões consolidadas

| Operação | Direção | Coord | Rafinha | Gerente | Farmer |
|---|---|---|---|---|---|
| Vender (incluso multi-item) | ✅ | ✅ | ✅ | ✅ 🔒u | ✅ 🔒u |
| Entrada estoque (rica ou simples) | ✅ | ✅ | ✅ | ✅ 🔒u | ✅ 🔒u |
| Ajuste manual | ✅ | ✅ | ✅ | ✅ 🔒u | ✅ 🔒u |
| Cadastrar / editar / desativar produto | ✅ | ✅ | ✅ | ✅ | ✅ |
| Transferência entre unidades | ✅ | ✅ | ✅ | ✅ 🔒u | ✅ 🔒u |
| Estorno de venda | ✅ | ✅ | ✅ | ✅ 🔒u | ✅ 🔒u |
| Reservar | ✅ | ✅ | ✅ | ✅ 🔒u | ✅ 🔒u |

🔒u: gerente/farmer só pode operar na própria unidade. Para **transferência**, isso significa que o `unidade_origem_id` precisa bater com `access.unitFilter`; transferir DA própria unidade PRA outra é OK.

**Reusa `checkAccess(collab, 'loja_produtos')` da Fase A** — nenhuma regra nova, só expandimos o que já tem.

---

## 4. Arquitetura (alto nível)

```
┌─────────────────────────────────────────────────────────────────────┐
│ PWA (React) — LojaPage com 3 tabs: [Produtos] [Histórico] [Reservas]│
│  └─ FAB com 3 ações: 💰 Venda Rica  ·  📦 Entrada Rica  ·  🆕 Produto│
│  └─ Sheets: VendaWizard, EntradaRica, ProdutoForm, Transferencia,   │
│             EstornoConfirm, Reserva                                  │
│  └─ Autocomplete: Cliente (aluno/colab), Professor (indicador)      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│ API serverless Vercel — web/api/lareport/loja/*                     │
│  buscar-aluno  ·  buscar-professor  ·  produto/{upsert,desativar}   │
│  venda (atualizado p/ multi-item)  ·  entrada (estendido)           │
│  transferencia  ·  estorno  ·  reserva  ·  historico-vendas         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ supabase.rpc()
┌──────────────────────────▼──────────────────────────────────────────┐
│ LA Report Postgres (ouqwbbermlzqqvtqwlul)                           │
│  SPs novas: registrar_venda_v2, transferir_estoque,                 │
│             estornar_venda, expirar_reservas_vencidas               │
│  Tabela nova: loja_reservas                                         │
│  Funções helper: estoque_disponivel(produto_id, unidade_id, var_id?) │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Fase 2.1 — Venda Rica + Entrada Rica

### 5.1 `VendaWizardSheet` — stepper 3 passos

**Passo 1 — Produtos:**
- Grid de cards (mobile: 2 col, desktop: 3-4 col), cada um com nome + preço + emoji da categoria
- Filtro top: chips de categoria (Cordas, Palhetas, Baquetas, etc) + chip "Estoque baixo"
- Cada card tem botão `+` que abre stepper inline de quantidade (1, 2, 3...). Estoque disponível mostrado em "X un disponíveis" abaixo do preço.
- Carrinho aparece como **pílula sticky no topo**: "🛒 3 itens · R$ 145" — clique expande lista do carrinho (drawer ou inline).
- Botão "Avançar →" só habilita se carrinho tem ≥ 1 item.

**Passo 2 — Cliente:**
- Toggle 3 opções (chips): `🎓 Aluno` | `🙋 Avulso` | `👔 Colaborador`
- Se **Aluno**: `<ClienteAutocomplete tipo="aluno" unidade_id={ativo}>` → input com debounce 200ms → mostra até 10 resultados (nome + telefone). Selecionar vincula `aluno_id`. Default unidade do colab logado.
- Se **Avulso**: input livre `cliente_nome`.
- Se **Colaborador**: `<ClienteAutocomplete tipo="colaborador">` → busca em `colaboradores` LA Report.
- Campo opcional: **"Indicado por professor?"** → `<ProfessorAutocomplete>` → comissão 5% credita carteira.

**Passo 3 — Pagamento + finalizar:**
- Forma de pagamento (CustomSelect): pix / crédito / débito / dinheiro
- Parcelas (NumberInput 1-12x) — aparece SÓ se forma = "crédito"
- Desconto: input numérico + toggle de tipo (R$ ou %)
- Resumo em cartão destacado:
  ```
  Subtotal:    R$ 145,00
  Desconto:  − R$  10,00
  ────────────────────
  Total:       R$ 135,00
  ```
- Checkbox "📲 Enviar comprovante por WhatsApp" — default ON se aluno tem telefone, hidden se não tem ou se tipo ≠ aluno
- Observações (textarea opcional)
- Botão grande "Finalizar Venda (R$ 135,00)"

**Estados:** carrinho persistido em `useState` do wizard (não localStorage — fica simples). Reset ao fechar/finalizar.

### 5.2 SP `registrar_venda_v2`

Substitui `registrar_venda` da Fase B (mantém a antiga como `registrar_venda_legacy` por 1 sprint pra não quebrar TOM enquanto migra). Assinatura:

```sql
CREATE OR REPLACE FUNCTION public.registrar_venda_v2(
  p_unidade_id      UUID,
  p_itens           JSONB,        -- [{produto_id, variacao_id?, quantidade, preco_unitario_override?}]
  p_forma_pagamento VARCHAR,
  p_via_audit       TEXT,
  p_tipo_cliente    VARCHAR DEFAULT 'avulso',
  p_cliente_nome    VARCHAR DEFAULT NULL,
  p_aluno_id        INT DEFAULT NULL,
  p_colaborador_cliente_id INT DEFAULT NULL,
  p_professor_indicador_id INT DEFAULT NULL,
  p_desconto        NUMERIC DEFAULT 0,
  p_desconto_tipo   VARCHAR DEFAULT 'reais',  -- 'reais'|'percentual'
  p_parcelas        INT DEFAULT 1,
  p_observacoes     TEXT DEFAULT NULL
) RETURNS TABLE (
  venda_id INT,
  total NUMERIC,
  itens_resultado JSONB,    -- [{produto_id, saldo_apos}]
  comissao_professor NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  -- BEGIN
  --   1. Valida p_itens não vazio
  --   2. Loop pelos itens: lê preço atual (ou usa override), lock estoque FOR UPDATE,
  --      acumula subtotal, valida saldo suficiente PRA CADA ITEM
  --   3. Calcula desconto (R$ ou %) e total = subtotal - desconto
  --   4. INSERT loja_vendas (1 row)
  --   5. Loop pelos itens: INSERT loja_vendas_itens + UPDATE loja_estoque +
  --      INSERT loja_movimentacoes_estoque tipo='venda' referencia_id=venda_id
  --   6. Comissão professor: se p_professor_indicador_id ≠ NULL, credita
  --      loja_carteira (cria se não existe) + INSERT loja_carteira_movimentacoes
  --   7. Retorna venda_id, total, array de [{produto_id, saldo_apos}], comissao
  -- EXCEPTION → rollback automático (qualquer RAISE)
$$;
```

**Rollback test obrigatório no smoke:** se algum item do array falhar (estoque insuficiente), TODA a venda é abortada (zero rows criadas, nenhum estoque mexido).

### 5.3 `ClienteAutocomplete` (componente reusável)

Props: `tipo: 'aluno' | 'colaborador'`, `unidadeId?: string`, `onSelect: (entidade) => void`.

Backend: `GET /api/lareport/loja/buscar-cliente?tipo=aluno&q=jos&unidade_id=...&limit=10` → retorna `[{id, nome, telefone?, status?}]`.

Query no banco:
```sql
-- Aluno
SELECT id, nome, telefone, status FROM alunos
WHERE ativo = TRUE AND unidade_id = $1 AND nome ILIKE '%' || $2 || '%'
ORDER BY similarity(nome, $2) DESC, nome ASC LIMIT 10;

-- Colaborador (sem filtro de unidade)
SELECT id, nome, telefone FROM colaboradores
WHERE ativo = TRUE AND nome ILIKE '%' || $1 || '%'
ORDER BY similarity(nome, $1) DESC, nome ASC LIMIT 10;
```

Frontend debounce 200ms, cache do react-query 30s.

### 5.4 `ProfessorAutocomplete` (similar)

Backend: `GET /api/lareport/loja/buscar-professor?q=...&unidade_id=...` em `professores` (56 ativos). Mesmo padrão.

### 5.5 Entrada Rica — `EntradaRicaSheet`

Renomeia o sheet atual pra `EntradaRicaSheet`. Adiciona campos:
- Nota fiscal (text, opcional)
- Fornecedor (text, opcional)
- **Múltiplos itens** (botão "+ adicionar item"): cada linha tem produto autocomplete + qtd + custo unitário desta compra
- Total da entrada calculado: `Σ(qtd × custo_unit)` — mostrado no rodapé do sheet
- Observações (textarea)

Backend: estende SP `registrar_entrada_estoque` pra aceitar array OU cria nova SP `registrar_entrada_v2` análoga a `registrar_venda_v2`. Em cada item, atualiza estoque + grava custo da movimentação. **Não atualiza `loja_produtos.custo` automaticamente** — esse é "custo médio" e fica fora dessa sprint.

### 5.6 Endpoints

- `POST /api/lareport/loja/venda` → atualizado pra aceitar body com `itens: VendaItem[]`, chama `registrar_venda_v2`. Mantém compatibilidade com body antigo single-item (converte pra array de 1 item).
- `POST /api/lareport/loja/entrada` → idem com `itens: EntradaItem[]`.
- `GET /api/lareport/loja/buscar-cliente?tipo=aluno|colaborador&q=...&unidade_id=...`
- `GET /api/lareport/loja/buscar-professor?q=...&unidade_id=...`

### 5.7 TOM (estender bypass e handlers)

`handleShopAction` ganha:
- **`shop_sale_multi`** action: aceita array de itens via marker. Bypass continua só pra single-item (frase "vendi N X na Y pix"); multi-item exige PWA.
- Comprovante WA: se `aluno_id` foi informado e tem telefone, dispara WA com resumo da venda automaticamente (mesmo padrão de fila de notificações da Fase A).

---

## 6. Fase 2.2 — CRUD de Produto + Transferência

### 6.1 `ProdutoFormSheet` — cadastro/edição

Modal único pra criar ou editar (props: `mode: 'create' | 'edit'`, `produto?: Produto`).

Campos (igual screenshot 3 fornecido):
- **Nome*** — com detecção de duplicata: ao terminar de digitar (debounce 500ms), backend `GET /api/lareport/loja/produto/similar?nome=...` → retorna lista de produtos com `similarity > 0.7`. UI mostra: "🔎 Produtos parecidos: X, Y. Tem certeza que é um produto novo?"
- **Categoria*** (CustomSelect das 7 existentes — emoji + nome)
- **SKU** (auto-gerado `<PREFIXO_CAT>-<id>` se vazio; editável)
- **Preço base*** (R$)
- **Custo** (R$)
- **Estoque mínimo** (default 5)
- **Comissão especial %** (opcional, override do padrão 5%)
- **Foto** (reusa `<FotoUploader>` existente — Storage do LA Report, mesma pasta `loja/produtos/`)
- **Descrição** (textarea)
- **Disponível pra divulgação WhatsApp** (checkbox)
- **Produto ativo** (checkbox, default true)

**Variações:** seção colapsável "Variações". Botão "+ Variação" abre inline-edit: nome + SKU + preço + ativo. Salva como rows em `loja_variacoes`. (Hoje tabela vazia; não exige variações.)

### 6.2 Desativar produto

Botão "Desativar" no `ProdutoCard` (visível só pra Direção/Coord/Rafinha/Gerente/Farmer = todos). Confirmação simples ("Tem certeza? Vendas antigas não mudam, mas o produto some das listas de venda."). UPDATE `loja_produtos SET ativo = FALSE`. Card aparece riscado se desativado e filtro "mostrar inativos" estiver ligado.

### 6.3 FAB ganha 3ª ação

```
+ Novo
  ├─ 💰 Registrar venda     → VendaWizardSheet
  ├─ 📦 Lançar entrada      → EntradaRicaSheet
  └─ 🆕 Cadastrar produto   → ProdutoFormSheet (mode=create)
```

### 6.4 Transferência entre unidades — `TransferenciaSheet`

Campos:
- Produto (`ProdutoAutocomplete` — reusa o `buscarProduto` da Fase B)
- Unidade origem (CustomSelect — default unidade do colab; se gerente/farmer, **trava** na unidade dele)
- Unidade destino (CustomSelect — exclui origem)
- Quantidade (number)
- Motivo (text obrigatório — pra audit)

Backend SP nova:

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
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  -- Validações: qtd > 0, origem != destino, motivo not empty
  -- Lock origem FOR UPDATE
  -- Checa saldo origem suficiente
  -- UPDATE estoque origem (-qtd)
  -- Upsert estoque destino (+qtd) — ON CONFLICT (produto_id, unidade_id, COALESCE(variacao_id, 0))
  -- INSERT 2 movimentações: 'saida_transferencia' na origem + 'entrada_transferencia' no destino
  --   referencia cruzada: usa MESMO motivo + "transfer pair" id
$$;
```

**Constraint check:** `loja_movimentacoes_estoque.tipo` precisa aceitar `'saida_transferencia'` e `'entrada_transferencia'`. Migration ajusta o CHECK constraint.

### 6.5 Endpoints

- `POST /api/lareport/loja/produto/upsert` — body: `{id?, nome, categoria_id, sku, preco, ...}`. Sem id → INSERT; com id → UPDATE.
- `POST /api/lareport/loja/produto/desativar` — body: `{id}`. Soft delete.
- `GET /api/lareport/loja/produto/similar?nome=...` — fuzzy match retorna candidates.
- `POST /api/lareport/loja/transferencia` — body: `{produto_id, unidade_origem, unidade_destino, quantidade, motivo, variacao_id?}`. Chama `transferir_estoque`.

---

## 7. Fase 2.3 — Estorno + Reserva + Histórico

### 7.1 LojaPage com tabs

```
[ Produtos ]  [ Histórico ]  [ Reservas ]
```

Tabs reusa `<Tabs>` do DS (já existe).

### 7.2 `HistoricoVendasView`

Lista paginada de vendas da unidade ativa.
Filtros top: data (range), forma de pagamento, status (concluida/estornada), professor indicador.
Cada row:
```
20/05 18:16  •  Corda de Violão Nylon × 1  •  R$ 25,90 pix
Cliente: Avulso  •  via TOM por Luciano Alf
[ Estornar ]
```

### 7.3 Estorno de venda — `EstornoConfirmSheet`

Click em "Estornar" no row → abre sheet de confirmação com:
- Resumo da venda original
- Campo "Motivo do estorno" (obrigatório, audit)
- Botão "Confirmar estorno" (vermelho)

Backend SP:
```sql
CREATE OR REPLACE FUNCTION public.estornar_venda(
  p_venda_id   INT,
  p_motivo     TEXT,
  p_via_audit  TEXT
) RETURNS TABLE (
  itens_revertidos JSONB,
  comissao_debitada NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  -- Valida: venda existe E status='concluida'
  -- Loop pelos loja_vendas_itens:
  --   UPDATE loja_estoque (+ quantidade)
  --   INSERT loja_movimentacoes_estoque tipo='estorno' qtd=+qtd
  -- Se houve professor_indicador_id na venda original:
  --   Calcula comissão original = total × pct na época
  --   Debita carteira: UPDATE loja_carteira SET saldo = saldo - comissao
  --   INSERT loja_carteira_movimentacoes tipo='debito' valor=comissao
  --   (Se saldo ficar negativo, ainda assim grava; estorno é uma realidade contábil)
  -- UPDATE loja_vendas SET status='estornada', estornada_em=NOW(),
  --   estornada_por=NULL (cross-project), motivo_estorno=p_motivo, observacoes += p_via_audit
$$;
```

**Constraint check:** `loja_movimentacoes_estoque.tipo` precisa aceitar `'estorno'`.

### 7.4 Reservas

**Migration nova — tabela `loja_reservas`:**
```sql
CREATE TABLE loja_reservas (
  id           SERIAL PRIMARY KEY,
  produto_id   INT NOT NULL REFERENCES loja_produtos(id),
  variacao_id  INT REFERENCES loja_variacoes(id),
  unidade_id   UUID NOT NULL REFERENCES unidades(id),
  aluno_id     INT REFERENCES alunos(id),
  cliente_nome VARCHAR,                                -- se não vier de alunos
  quantidade   INT NOT NULL CHECK (quantidade > 0),
  prazo        DATE NOT NULL,                          -- até quando reservado
  status       VARCHAR NOT NULL DEFAULT 'ativa'
               CHECK (status IN ('ativa','finalizada','expirada','cancelada')),
  observacoes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_via  TEXT,                                   -- "via PWA por X"
  finalizada_em TIMESTAMPTZ,
  finalizada_venda_id INT REFERENCES loja_vendas(id)   -- quando vira venda
);
CREATE INDEX idx_reservas_unidade_status ON loja_reservas (unidade_id, status);
CREATE INDEX idx_reservas_prazo_ativa ON loja_reservas (prazo) WHERE status = 'ativa';
```

**Função helper essencial:**
```sql
CREATE OR REPLACE FUNCTION public.estoque_disponivel(
  p_produto_id INT, p_unidade_id UUID, p_variacao_id INT DEFAULT NULL
) RETURNS INT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(e.quantidade, 0) - COALESCE(
    (SELECT SUM(r.quantidade) FROM loja_reservas r
     WHERE r.produto_id = p_produto_id
       AND r.unidade_id = p_unidade_id
       AND (r.variacao_id IS NOT DISTINCT FROM p_variacao_id)
       AND r.status = 'ativa'), 0
  )
  FROM loja_estoque e
  WHERE e.produto_id = p_produto_id
    AND e.unidade_id = p_unidade_id
    AND (e.variacao_id IS NOT DISTINCT FROM p_variacao_id);
$$;
```

**TODAS as queries de saldo passam a usar `estoque_disponivel(...)`** em vez de ler `loja_estoque.quantidade` direto:
- `registrar_venda_v2`: substitui `IF v_saldo_atual < p_quantidade` por chamar `estoque_disponivel` (mas mantém UPDATE em `loja_estoque.quantidade`)
- `buscar_produto_fuzzy`: retorna `estoque_disponivel` no campo `estoque`
- `useReportLoja` (hook PWA): backend retorna campo `estoque_disponivel`
- TOM `query_shop`: mostra disponível, com nota "(X reservados)" se aplicável

**`ReservaSheet`:**
- Produto (autocomplete)
- Cliente: aluno (autocomplete) OU nome livre
- Quantidade
- Prazo (date picker — default hoje + 7 dias)
- Observações
- Botão "Reservar"

Backend: `POST /api/lareport/loja/reserva` → INSERT em `loja_reservas`. Sem SP (operação simples, sem ACID complexo — só 1 INSERT). Lock no estoque feito conceitualmente via `estoque_disponivel`.

**Cron de expiração:**
Nova função no `dispatcher.js`:
```js
// Roda diariamente 09:00 BRT
async function expirarReservasVencidas(ymd) {
  // UPDATE loja_reservas SET status='expirada'
  //   WHERE status='ativa' AND prazo < CURRENT_DATE
  // Pra cada reserva expirada, notifica criador via WA (lookup por created_via)
}
```

**Finalizar reserva como venda:** botão "Finalizar como venda" no card de reserva → abre `VendaWizardSheet` pré-populado (produto + cliente + qtd). Após sucesso, UPDATE reserva `status='finalizada' finalizada_venda_id=...`.

**Cancelar reserva:** botão "Cancelar" → UPDATE `status='cancelada'`.

### 7.5 Endpoints

- `GET /api/lareport/loja/historico-vendas?unidade_id=...&from=YYYY-MM-DD&to=...&pagina=1`
- `POST /api/lareport/loja/estorno` — body `{venda_id, motivo}` → SP `estornar_venda`
- `POST /api/lareport/loja/reserva` — body `{produto_id, unidade_id, aluno_id?, cliente_nome?, quantidade, prazo, observacoes?}`
- `POST /api/lareport/loja/reserva/cancelar` — body `{id, motivo?}`
- `POST /api/lareport/loja/reserva/finalizar` — body `{id}` (apenas marca finalizada; venda real vai pelo endpoint `/venda`)

### 7.6 TOM (estende handlers)

Skill `lojinha.md` ganha:
- `shop_transfer` — "transferir 5 cordas da Barra pra Recreio"
- `shop_estorno` — "estornar venda #X" (com confirmação)
- `shop_reserve` — "reservar 2 baquetas pra aluno Joseph até dia 25"

Bypass do engine ganha pattern matches pra essas frases (mesmo padrão da Fase B).

---

## 8. Migrations a aplicar

### Fase 2.1
1. `20260520_loja_sp_registrar_venda_v2.sql` — SP nova (mantém `registrar_venda` antiga como `registrar_venda_legacy` por 1 sprint)
2. `20260520_loja_sp_registrar_entrada_v2.sql` — SP nova multi-item (ou estende a existente)

### Fase 2.2
3. `20260520_loja_movimentacoes_tipo_check.sql` — adiciona `'saida_transferencia'`, `'entrada_transferencia'` no CHECK constraint
4. `20260520_loja_sp_transferir_estoque.sql` — SP nova

### Fase 2.3
5. `20260520_loja_movimentacoes_tipo_estorno.sql` — adiciona `'estorno'` no CHECK
6. `20260520_loja_sp_estornar_venda.sql` — SP nova
7. `20260520_loja_reservas_table.sql` — CREATE TABLE + indexes
8. `20260520_loja_fn_estoque_disponivel.sql` — função helper
9. `20260520_loja_buscar_produto_fuzzy_v2.sql` — atualiza `buscar_produto_fuzzy` pra usar `estoque_disponivel`
10. `20260520_loja_sp_expirar_reservas.sql` — SP do cron

---

## 9. Plano de testes (smoke)

| Fase | Cenário | Resultado esperado |
|---|---|---|
| 2.1 | Venda multi-item (3 produtos) | 1 row em `loja_vendas`, 3 em `loja_vendas_itens`, 3 estoque updates, comissão professor creditada se houver |
| 2.1 | Venda com 1 item sem estoque | RAISE estoque_insuficiente, ZERO rows criadas (rollback ACID) |
| 2.1 | Autocomplete aluno "joseph" | Retorna ≤ 10 resultados de `alunos` |
| 2.1 | Entrada rica com NF + 2 produtos | 2 rows em `loja_movimentacoes_estoque` tipo='entrada' com NF nas observações |
| 2.2 | Cadastrar produto novo | INSERT loja_produtos, foto sobe pro Storage, aparece no grid |
| 2.2 | Cadastrar produto com nome igual existente | UI mostra "Produtos parecidos: X" antes de salvar |
| 2.2 | Desativar produto | UPDATE ativo=false, some da venda mas existe nas vendas antigas |
| 2.2 | Transferência Barra → Recreio 3 un | Saldo Barra −3, Recreio +3, 2 movimentações criadas |
| 2.2 | Transferência mesma origem/destino | Erro `origem_igual_destino` |
| 2.3 | Estornar venda | Estoque devolvido, status='estornada', comissão debitada se aplicável |
| 2.3 | Estornar venda já estornada | Erro `venda_ja_estornada` |
| 2.3 | Reservar 2 un produto X | INSERT loja_reservas; `estoque_disponivel` cai por 2 |
| 2.3 | Vender qtd > disponível (reserva ocupa) | RAISE estoque_insuficiente |
| 2.3 | Cron expira reserva vencida | UPDATE status='expirada' pra reservas com prazo < hoje |

---

## 10. Out-of-scope (Fase 3+)

- **CRUD de variações em massa** — Fase 2 só edita 1 variação por vez inline
- **Atualização automática de custo médio** quando entra estoque (hoje só registra na movimentação)
- **Carrinho persistente entre sessões** (localStorage) — hoje reset ao fechar
- **Histórico paginado infinito** (Fase 2.3 limita 50 por página)
- **Dashboard de vendas** (gráficos, faturamento por mês)
- **Notificação ao aluno sobre reserva expirando** (cron de 1 dia antes)
- **Mapping cross-project `colaboradores.id` INT ↔ `collaborators.id` UUID** — ainda pendente da Fase B
- **Comissão de farmer creditada na carteira** (depende do mapping)

---

## 11. Arquivos a criar/modificar (preview pro plan)

### Fase 2.1
**Criar:** `VendaWizardSheet.tsx`, `ClienteAutocomplete.tsx`, `ProfessorAutocomplete.tsx`, `EntradaRicaSheet.tsx`, `web/api/lareport/loja/buscar-cliente.ts`, `web/api/lareport/loja/buscar-professor.ts`, 2 migration SQL.

**Modificar:** `LojaPage.tsx` (substitui `VendaSheet` por `VendaWizardSheet`), `lareport-mutations.ts` (registrarVendaMulti, registrarEntradaMulti, buscarCliente, buscarProfessor), `web/api/lareport/loja/venda.ts` (multi-item), `web/api/lareport/loja/entrada.ts` (multi-item).

### Fase 2.2
**Criar:** `ProdutoFormSheet.tsx`, `TransferenciaSheet.tsx`, `web/api/lareport/loja/produto/upsert.ts`, `web/api/lareport/loja/produto/desativar.ts`, `web/api/lareport/loja/produto/similar.ts`, `web/api/lareport/loja/transferencia.ts`, 2 migration SQL.

**Modificar:** `LojaPage.tsx` (3ª ação no FAB, botão Desativar em ProdutoCard), `lareport-mutations.ts`.

### Fase 2.3
**Criar:** `HistoricoVendasView.tsx`, `EstornoConfirmSheet.tsx`, `ReservaSheet.tsx`, `web/api/lareport/loja/historico-vendas.ts`, `web/api/lareport/loja/estorno.ts`, `web/api/lareport/loja/reserva.ts` (+ cancelar/finalizar), 6 migration SQL.

**Modificar:** `LojaPage.tsx` (3 tabs), `useLaReport.ts` (hook usa `estoque_disponivel`), `dispatcher.js` (cron expirar reservas), `engine.js` (handlers TOM shop_transfer/estorno/reserve + bypass).

---

# Lojinha — Refactor UI Hub + Telas Internas

**Data:** 2026-05-21
**Autor:** Alf (com Claude)
**Status:** Aprovado — pronto pra plan
**Origem:** Sprint pós Fase 2 da Lojinha. UI atual tem 3 níveis de tabs empilhadas
(unidades → produtos/histórico/reservas → ativas/finalizadas/canceladas) e ficou
confusa pra mobile. Objetivo: visual premium-mobile, navegação clara, zero
3º nível de tabs.

---

## 1. Estrutura de navegação

**Antes (atual):**
```
LojaPage
├─ Tabs unidades       (Barra | Campo Grande | Recreio)
├─ Sub-tabs            (Produtos | Histórico | Reservas)
└─ Sub-sub-tabs        (Ativas | Finalizadas | Canceladas)   ← problema
```

**Depois:**
```
LojaHub (tela)
├─ Header              (← · 🛍 Lojinha · [Barra ▾])
├─ Alerta              (se estoque baixo)
├─ Cards-atalho        (Produtos | Histórico | Reservas — drill-down)
└─ Resumo da unidade   (block lateral com KPIs gerais)

Cada card → tela própria:
  ├─ ProdutosPage
  ├─ HistoricoPage
  └─ ReservasPage
```

Sem terceiro nível em lugar nenhum. Filtros viram **chips horizontais
roláveis** dentro de cada tela.

---

## 2. Tela-hub (LojaHub)

**Layout aprovado: variante B — lista compacta horizontal estilo iOS Settings.**

### 2.1 Componentes

**Header** (sticky no topo)
- Botão back (volta pra `/inventario`)
- Ícone + título: `🛍 Lojinha`
- Chip seletor de unidade: `Barra ▾` (abre BottomSheet com opções) —
  substitui as 3 tabs de unidade lado a lado

**Alerta de estoque** (condicional)
- Mantém o pattern atual (`bg-warning/10` + border-l-4) se houver produto
  abaixo do mínimo. Some quando zerado.

**Seção "Acessos rápidos"** (label uppercase muted)
- 3 cards-linha (HubCard), cada um com:
  - Ícone à esquerda (40×40, bg verde 10%)
  - Título + meta line (KPIs inline em texto, separados por `·`)
  - Chevron `›` à direita
  - Click → navega pra tela respectiva

**Seção "Resumo da unidade"** (label uppercase muted)
- Bloco com 2 KPIs gerais (ex: itens totais + faturamento do dia).
  Mantém footprint pequeno pra crescer no futuro (sparkline, comparativo
  entre unidades, etc.).

**FAB**
- Mantém as 5 ações atuais (venda, entrada, produto, transferência,
  reserva). Atalho rápido independente da tela em que está.

### 2.2 Conteúdo de cada HubCard

| Card | Ícone | Meta line (exemplo) |
|---|---|---|
| Produtos | 📦 | `10 ativos · R$485 estoque · 1 atenção` |
| Histórico | 📊 | `12 vendas · R$310 (30d)` |
| Reservas | 🔖 | `2 ativas · 0 vence hoje` |

KPI em **bold** + métricas secundárias em peso normal, separadas por `·`.

### 2.3 Dados necessários

- `produtos.length`, `valorEstoque`, `baixos.length` (já temos de `useReportLoja`)
- `historico` resumo: contar vendas 30d + soma total (do mesmo endpoint
  `historico-vendas` ou aggregate novo)
- `reservas` resumo: contar `status='ativa'`, contar `prazo=today` (do
  hook `useReservas`)
- Resumo unidade: total de itens + faturamento do dia (já temos / pode
  reusar query)

---

## 3. Tela Produtos (ProdutosPage)

**Header:** `‹ · 📦 Produtos · [Barra ▾]`

**Search bar:** input "Buscar produto..." com debounce 200ms. Filtra
client-side a lista carregada.

**Chips de filtro** (horizontal scroll, sem barra visível):
- `Todos (10)` — default ativo
- `Estoque baixo (1)`
- `Sem estoque (0)`
- `Por categoria` — abre BottomSheet com lista de categorias

**Lista:** mantém `ProdutoCard` atual (foto/ícone, nome, venda, estoque
badge, ações Editar/Desativar). Sem mudança estrutural — só herda o novo
ambiente.

**FAB:** atalho "Cadastrar produto" (uma ação, sem menu).

---

## 4. Tela Histórico (HistoricoPage)

**Header:** `‹ · 📊 Histórico · [Barra ▾]`

**Chips** (horizontal scroll):
- `30 dias` (default) | `7d` | `90d` — período
- `Estornadas` — toggle pra mostrar só estornadas
- `PIX` — atalho pro filtro de forma mais comum
- `Filtros ⚙` — abre BottomSheet com filtros raros (professor, outras
  formas de pagamento, status detalhado)

**Header de seção:** total resumido — `12 vendas · R$ 310,00`

**Lista** de cards de venda:
- Ícone (💰 ativa, ↩️ estornada)
- Primeira linha: `Nx <produto> · <cliente>`
- Segunda linha: `<data> · <pill forma> · <pill #id>` ou
  `· <pill ESTORNADA>` (estornada usa `opacity:0.5` + total tachado)
- Tail: total em R$
- Click → abre EstornoConfirmSheet (existente)

**Sem FAB nesta tela** (Histórico é só leitura).

---

## 5. Tela Reservas (ReservasPage)

**Header:** `‹ · 🔖 Reservas · [Barra ▾]`

**Chips** de status (substitui o 3º nível):
- `Ativas (2)` — default
- `Finalizadas (3)`
- `Arquivadas (1)` — agrupa canceladas + expiradas

**Cards** de reserva (todos no MESMO formato):
- Header da linha: ícone 🔖 · `<cliente> · Nx` · `<produto>` · pill de
  prazo (`Vence em Nd` / `VENCIDA` / `Finalizada` / `Cancelada`)
- Footer da linha (só em ativas): botões inline `Finalizar` (primary
  verde) e `Cancelar` (ghost), + data do prazo
- Click no card abre detalhes (próximo escopo, fora desta sprint)

**FAB:** atalho "Criar reserva".

---

## 6. Componentes novos / refactor

### Novos
- `LojaHub.tsx` — tela-hub com HubCards
- `HubCard.tsx` — card-linha clicável (ícone + título + meta + chevron),
  reusável (pode virar `<NavCard>` se outros hubs quiserem)
- `UnidadeChip.tsx` — chip-seletor de unidade que abre BottomSheet
  (substitui `<Tabs>` de unidades nesta tela)
- `ChipFilterRow.tsx` — container de chips horizontais com CSS
  `scrollbar-width:none` + `::-webkit-scrollbar{display:none}`, e
  `overflow-x:auto`. Aceita chips ativos/inativos com count opcional.
- `ProdutosPage.tsx` — nova tela (extrai da LojaPage atual)
- `HistoricoPage.tsx` — nova tela (extrai `HistoricoVendasView`)
- `ReservasPage.tsx` — nova tela (extrai `ReservasView`)

### Refactor
- `LojaPage.tsx` — VIRA `LojaHub`. Remove sub-tabs internas. Remove
  `subTab` state.
- `App.tsx` — adiciona rotas:
  - `/inventario/loja` → `<LojaHub />`
  - `/inventario/loja/produtos` → `<ProdutosPage />`
  - `/inventario/loja/historico` → `<HistoricoPage />`
  - `/inventario/loja/reservas` → `<ReservasPage />`
- `HistoricoVendasView.tsx` — vira `HistoricoPage` (envelopa header + 
  chips no lugar dos dropdowns)
- `ReservasView.tsx` — vira `ReservasPage` (chips no lugar das sub-tabs)
- Chips substituem `<CustomSelect>` em filtros principais de histórico
  (mantém CustomSelect dentro do "Filtros ⚙" sheet)

### Não muda
- `ProdutoCard`, `VendaWizardSheet`, `EntradaRicaSheet`, `TransferenciaSheet`,
  `ProdutoFormSheet`, `EstornoConfirmSheet`, `ReservaSheet` — usados como
  são, só convocados em outras telas
- Hooks `useReportLoja`, `useHistoricoVendas`, `useReservas` — sem mudança
- FAB component — usado em múltiplas telas, sem mudança

---

## 7. Estado e navegação

- **Unidade selecionada** vive em URL search param: `?unit=<uuid>`. Persiste
  ao navegar entre Hub ↔ telas internas. Default = unidade do collaborator
  ou Barra.
- **Filtros das telas internas** vivem em estado local (não persistem). Se
  o user precisar de filtro padrão, escolhemos um único default (ex:
  Histórico = "30 dias", Reservas = "Ativas").
- **Back nas telas internas** volta pro Hub (não pro `/inventario`). Hub
  back volta pro `/inventario`.

---

## 8. Design tokens

Sem token novo. Usa o que existe no DS:
- `bg-bg-surface`, `bg-bg-app`, `bg-bg-elevated`
- `text-fg`, `text-fg-muted`
- `border-border`
- `text-tom` (verde primário, `#a8e643`)
- `bg-warning/10`, `text-warning`, `bg-danger/20`, `text-danger`

Espaçamento: usa as utilities Tailwind atuais (`p-md`, `gap-sm`, `space-y-md`).

---

## 9. Acessibilidade e mobile

- Chips com `min-height: 44px` (Apple HIG touch target)
- Search input com `inputMode="search"`
- Cards do Hub com `role="button"` + `tabIndex={0}` (navegação por teclado)
- BottomSheet de unidade (UnidadeChip) com handle visual pra swipe-down
- Lazy load das telas internas via `React.lazy` (cada uma é uma rota
  separada, reduz bundle inicial do Hub)

---

## 10. Fora de escopo (Fase 3+)

- TOM ganhar handlers pra criar/editar produto, transferir, finalizar
  reserva (continua só PWA)
- Comparativo entre unidades no Resumo (gráfico/sparkline)
- Notificações push de reserva vencendo
- Pesquisa global (todas unidades)
- Filtro por categoria de produto no Hub
- Histórico de reservas com timeline

---

## 11. Critérios de aceite

- [ ] Tela `/inventario/loja` renderiza Hub (cards + resumo + FAB)
- [ ] Click em "Produtos" navega pra `/inventario/loja/produtos`
- [ ] Click em "Histórico" navega pra `/inventario/loja/historico`
- [ ] Click em "Reservas" navega pra `/inventario/loja/reservas`
- [ ] Cada tela interna tem header, chips e lista funcionando
- [ ] Chips horizontais NÃO mostram barra de scroll em nenhum browser
- [ ] Unidade selecionada persiste via URL param ao navegar
- [ ] Back nas telas internas volta pro Hub (não pro /inventario)
- [ ] FAB funciona em todas as 4 telas com as 5 ações originais
- [ ] Validar visualmente no Simple Browser (localhost:4173) antes de
      pedir pro Alf retestar
- [ ] Zero regressão funcional: vender, registrar entrada, transferir,
      cadastrar/desativar produto, estornar, criar/cancelar/finalizar
      reserva

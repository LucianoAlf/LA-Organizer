# Inventário — Drill-down dos cards ATENÇÃO e EM MANUTENÇÃO

**Data:** 2026-06-22
**Pedido por:** Rafinha (via Alf)
**Tipo:** Bugfix + Feature (PWA, sem migration)

## Goal

Na tela **Mais → Inventário → aba de unidade**, clicar nos cards **ATENÇÃO** e **EM MANUTENÇÃO** deve abrir uma lista dos itens exatos que compõem aquele número, com possibilidade de agir sobre cada item — em vez de quebrar a navegação.

## Contexto e causa raiz do bug

A tela `screens/inventario/ListaPage.tsx` mostra 4 cards totalizadores (`components/StatsCards.tsx`), alimentados por `hooks/useInventarioStats.ts`, que lê do projeto Supabase **LA Performance Report** via `laReportClient` (tabela `inventario`).

Regras atuais dos contadores (em `useInventarioStats.ts`):

| Card | Regra atual |
|---|---|
| TOTAL ITENS | `ativo = true` |
| VALOR TOTAL | soma `valor_compra` onde `ativo = true` |
| EM MANUTENÇÃO | `status = 'manutencao'` (+ `ativo`? **não** — só status) |
| ATENÇÃO | `proxima_revisao <= hoje+30d` (**sem** `ativo = true`) |

**Bug:** `ListaPage.tsx:70` faz `navigate('/inventario/atencao?unit=...')`, mas essa rota **não existe** em `App.tsx`. O React Router cai no catch-all `<Route path="*" element={<Navigate to="/hoje" replace />} />` → o usuário é jogado para a tela "Pra Hoje". Não é crash de JS, é rota fantasma. Some assim que trocarmos o `navigate` por abrir um sheet.

**Inconsistência detectada (aprovada para correção):** o card ATENÇÃO conta até itens inativos/baixados (os demais filtram `ativo = true`). Item dado baixa não deveria pedir revisão. Decisão do Alf: **alinhar — contar só ativos** no card E na lista.

## Decisões aprovadas (brainstorm)

1. **Formato:** bottom-sheet / modal (`AdaptiveSheet`) — padrão da casa; não sai da tela; resolve o bug trocando o `navigate` por abrir o sheet.
2. **Escopo:** ATENÇÃO **+** EM MANUTENÇÃO viram clicáveis (hoje só ATENÇÃO tenta, e quebra; MANUTENÇÃO nem é clicável). TOTAL ITENS e VALOR TOTAL ficam **fora** (YAGNI).
3. **Tocar no item:** lista + abrir o **mesmo menu de ações** já usado na `SalaPage` (`ItemAcoesMenu` → Editar / Mover / Registrar manutenção / Dar baixa).
4. **Regra de ATENÇÃO:** alinhar com `ativo = true` (card e lista usam a mesma regra).
   - **Efeito colateral assumido:** como o filtro é compartilhado, o card **EM MANUTENÇÃO** também passa a exigir `ativo = true`. Impacto esperado ~nulo (item em manutenção é ativo); se algum item baixado tiver ficado com `status = 'manutencao'`, ele sai da contagem — o que é o comportamento correto. **Confirmado pelo Alf (22/06): alinhar os dois.**

## Princípio central: fonte de verdade única do filtro

Para a lista **sempre** bater com o número do card, o filtro de cada status (e o cálculo da data-limite) vive em **um único módulo** consumido tanto pelo contador (`useInventarioStats`) quanto pela lista (`useInventarioItensPorStatus`). Paridade por construção — impossível divergir depois.

## Arquitetura

### Arquivos NOVOS

**1. `web/src/lib/inventario-status.ts`** — helpers puros (testáveis, sem rede):

```ts
export type InventarioStatusTipo = 'atencao' | 'manutencao';

// Data-limite da janela de "atenção": hoje + 30 dias, YYYY-MM-DD.
// Recebe `now` injetável p/ teste. Mantém a MESMA fórmula do contador atual
// (Date + 30*86400000 → toISOString().slice(0,10)) para paridade exata.
export function proximaRevisaoLimite(now?: Date): string;

// Aplica o filtro do status numa query do laReportClient (builder fluente).
// SEMPRE inclui .eq('ativo', true). Depois:
//   atencao    → .lte('proxima_revisao', proximaRevisaoLimite(now))
//   manutencao → .eq('status', 'manutencao')
// Usado pelo contador (count head:true) E pela lista (select *).
export function aplicaFiltroStatus<Q>(query: Q, tipo: InventarioStatusTipo, now?: Date): Q;

// Label humana da revisão p/ o card de ATENÇÃO. Função pura.
//   proxima_revisao no passado → { texto: 'Revisão venceu há Nd', tom: 'danger' }
//   hoje                       → { texto: 'Revisão vence hoje', tom: 'danger' }
//   futuro (≤30d)              → { texto: 'Revisão em Nd', tom: 'warning' }
//   null                       → null (não renderiza)
export function statusRevisao(proxima_revisao: string | null, now?: Date):
  { texto: string; tom: 'danger' | 'warning' } | null;
```

**2. `web/src/hooks/useInventarioItensPorStatus.ts`** — busca a lista:

```ts
export function useInventarioItensPorStatus(
  unidadeId: string | undefined,
  tipo: InventarioStatusTipo | null,   // null = sheet fechado, query desabilitada
): UseQueryResult<ReportInventarioItem[]>
```

- queryKey: `['lareport', 'por-status', tipo, unidadeId, access.unitFilter]`
- `enabled: access.allowed && Boolean(unidadeId) && tipo != null`
- query: `laReportClient.from('inventario').select('*')`, aplica `unidade_id`/`unitFilter` (mesmo `applyFilters` do stats) **e** `aplicaFiltroStatus(q, tipo)`.
- ordenação: `atencao` → `proxima_revisao` asc (mais urgente no topo); `manutencao` → `nome` asc.

**3. `web/src/screens/inventario/components/ItemListSheet.tsx`** — o drill-down:

```ts
interface Props {
  open: boolean;
  onClose: () => void;
  tipo: InventarioStatusTipo | null;
  unidadeId?: string;
}
```

- `AdaptiveSheet` com título por tipo: `atencao` → "Itens em atenção" · `manutencao` → "Em manutenção".
- usa `useInventarioItensPorStatus`; `LoadingState` enquanto carrega; `EmptyState` se vazio.
- renderiza cada item com `ItemCard` (componente compartilhado com a `SalaPage` — **não é modificado**). No tipo `atencao`, o badge de `statusRevisao(item.proxima_revisao)` é renderizado **por fora**, num wrapper acima/junto do `ItemCard` dentro do próprio `ItemListSheet` — zero alteração no `ItemCard` (sem risco de regressão na SalaPage).
- tocar num item replica o padrão da `SalaPage`: estados locais `acoesItem / editItem / moverItemSt / manutItem / baixaItem` + `useInventarioMutations()` + os sheets `ItemAcoesMenu`, `ItemSheet` (editar), `MoverItemSheet`, `ManutencaoSheet`, `BaixaConfirmSheet`.

### Arquivos MODIFICADOS

**4. `web/src/hooks/useInventarioStats.ts`** — usar `aplicaFiltroStatus` para manutenção e atenção (em vez dos filtros inline). Efeito: ATENÇÃO passa a filtrar `ativo = true` (decisão #4). Total/Valor seguem como estão.

**5. `web/src/screens/inventario/components/StatsCards.tsx`** — card EM MANUTENÇÃO também clicável; callback unificado:

```ts
interface Props { unidadeId?: string; onCardClick?: (tipo: InventarioStatusTipo) => void; }
```
- ATENÇÃO: `onClick = data.atencao > 0 ? () => onCardClick('atencao') : undefined`
- EM MANUTENÇÃO: `onClick = data.manutencao > 0 ? () => onCardClick('manutencao') : undefined`

**6. `web/src/screens/inventario/ListaPage.tsx`** — estado `drillTipo`; `<StatsCards onCardClick={setDrillTipo} />`; renderiza `<ItemListSheet open={!!drillTipo} tipo={drillTipo} unidadeId={unidadeId} onClose={() => setDrillTipo(null)} />`. **Remove** o `navigate('/inventario/atencao')` (mata o bug). Não cria rota nova.

**7. `web/src/hooks/useInventarioMutations.ts`** — estender `invalidate()` com `qc.invalidateQueries({ queryKey: ['lareport', 'por-status'] })`, para a lista atualizar após Editar/Mover/Manutenção/Baixa.

## Comportamento e edge cases

- `proxima_revisao = null` → não entra em ATENÇÃO (Postgres: `null` não satisfaz `<=`). Correto.
- Registrar manutenção com nova `data_proxima_revisao` futura → item sai de ATENÇÃO ao invalidar. Esperado.
- Mover/Baixa → invalida → item some da lista. Esperado.
- Permissões: a tela já está sob `requireAccess="inventario"`; `ItemAcoesMenu` já filtra ações por acesso (`invAccess`, `movAccess`, `isProf`) — reuso mantém as regras.
- `useInventarioMutations()` é chamado sem `salaId` no sheet (itens são de várias salas); o `salaId` só serve à invalidação — `'salas'`, `'stats'` e `'por-status'` cobrem o que o drill-down mostra.

## Guardrail desktop

`ListaPage` não tem variante `*Desktop` separada (é responsiva). `AdaptiveSheet` já entrega bottom-sheet no mobile e modal no desktop. Nenhum split mobile/desktop é tocado. Validar em 375px e 1440px mesmo assim.

## Testes

- **TDD (vitest) em `lib/inventario-status.ts`:**
  - `statusRevisao`: passado ("venceu há Nd"/danger), hoje ("vence hoje"/danger), futuro ("em Nd"/warning), null (→ null).
  - `proximaRevisaoLimite(now)`: data injetada → exatamente hoje+30d em `YYYY-MM-DD`.
  - `aplicaFiltroStatus`: com um mock de builder fluente, prova que sempre chama `.eq('ativo', true)` e a cláusula certa por tipo.
- **Manual no preview (localhost:4173):** clicar ATENÇÃO/MANUTENÇÃO abre o sheet; contagem da lista == número do card; tocar no item abre ações; registrar manutenção remove o item da lista; clicar não joga mais pra "Pra Hoje". `tsc --noEmit` + `vite build` limpos.

## Fora de escopo (YAGNI)

- Cards TOTAL ITENS e VALOR TOTAL clicáveis.
- Rota dedicada `/inventario/atencao` (não é necessária com o sheet).
- Filtros/busca dentro do drill-down.
- Alinhamento de timezone do cálculo de data (mantemos a fórmula atual idêntica nos dois lados; trocar por `todaySP()` exigiria mudar contador e lista juntos — outro trabalho).

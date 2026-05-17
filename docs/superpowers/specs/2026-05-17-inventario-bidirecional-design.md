# Inventário Bidirecional (LA Report ↔ PWA ↔ TOM) — Design

**Data:** 2026-05-17
**Sprint:** Fase A (Inventário CRUD + cards ricos + FAB + realtime)
**Sprint seguinte (Fase B, documentado):** Lojinha bidirecional

---

## Objetivo

PWA do LA Organizer vira a interface primária do Rafinha pra gestão de inventário. CRUD completo, cards de sala enriquecidos com info da própria sala (capacidade, tipo, buffer), FAB contextual pra cadastro rápido, realtime entre clientes, e TOM ganha consulta `/inv ver`. Tudo refletindo bidirecional com o LA Report (Supabase cross-project `ouqwbbermlzqqvtqwlul`).

---

## Princípios

- **LA Report é fonte única de verdade.** Nenhuma duplicação de dados.
- **Auditoria preservada.** Toda escrita do PWA grava "via PWA por &lt;nome&gt;" em `observacoes`/`motivo` (mesmo padrão R1 do TOM).
- **Segurança escalável ao uso atual.** Anon key do LA Report no bundle (single-org, single-tenant operacional) é aceitável; gating de escrita acontece no serverless.
- **YAGNI.** Lojinha CRUD fica pra Fase B (separada).

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│  PWA (Vite/React PWA, Vercel)                       │
│                                                     │
│  READ + REALTIME  ───────────► laReportClient       │
│  (supabase-js direto)          ANON KEY + RLS       │
│                                                     │
│  WRITE  ─────► /api/lareport/inventario/... ───►    │
│  (serverless, valida JWT → role → injeta auditoria) │
└────────┬────────────────────────────┬───────────────┘
         │ realtime channel           │ HTTPS POST/PATCH/DELETE
         ▼                            ▼
┌─────────────────────────────────────────────────────┐
│  LA Report Supabase (ouqwbbermlzqqvtqwlul)          │
│  Tables: inventario, inventario_movimentacoes,      │
│          inventario_manutencoes, salas, unidades    │
│  Storage bucket: inventario-fotos                   │
└─────────────────────────────────────────────────────┘
         ▲
         │ service-role (server-side only)
┌────────┴────────────────────────────────────────────┐
│  TOM (VPS, WhatsApp agent)                          │
│  src/services/inventario-service.js (já existe)     │
│  Novo: buscarItemPorNome() + handler /inv ver       │
└─────────────────────────────────────────────────────┘
```

### Leituras (PWA)

- Novo módulo `web/src/lib/lareport-client.ts` — cria cliente Supabase apontando pra LA Report com `VITE_LA_REPORT_URL` + `VITE_LA_REPORT_ANON_KEY`.
- Hooks TanStack Query (`useReportSalas`, `useReportSalaDetalhe`, `useReportLoja`, `useReportAlertas`) refatoram pra usar esse client direto.
- Sem hop pelo serverless pra reads — mais rápido, sem custo Vercel.

### Realtime (PWA)

- Wrapper `web/src/lib/lareport-realtime.ts` expõe `useRealtimeSubscription(table, filter, onChange)`.
- `useReportSalaDetalhe` subscribe em:
  - `inventario` filtro `sala_id=eq.{id}`
  - `inventario_movimentacoes` filtro `or(sala_origem_id.eq.{id},sala_destino_id.eq.{id})`
  - `inventario_manutencoes` (sem filter direto — checa via `inventario.sala_id` no callback)
- No evento, invalida cache do TanStack Query (`queryClient.invalidateQueries`).
- `useReportSalas` subscribe em mudanças globais de `inventario` (refetch lista de contagem).

### Escritas (PWA)

Todas via Vercel serverless. Endpoints novos:

```
web/api/lareport/inventario/index.ts        POST   criar item
web/api/lareport/inventario/[id].ts         PATCH  editar campos
                                            DELETE soft-delete (status=baixa, ativo=false)
web/api/lareport/inventario/[id]/mover.ts   POST   transferência entre salas
web/api/lareport/inventario/[id]/manutencao.ts  POST  registrar manutenção
web/api/lareport/upload.ts                  POST   multipart, upload de foto pro Storage
```

Cada endpoint segue o mesmo fluxo do `[...path].ts` existente:

1. Extrai JWT do `Authorization: Bearer`
2. Valida via `supabase.auth.getUser(token)` (cliente do LA Organizer)
3. Busca `collaborators` por `auth_user_id` → pega `role` e `full_name`
4. Checa `role IN ALLOWED_WRITE_ROLES` (ver §Permissões)
5. Antes de gravar, monta payload com:
   - `observacoes = "via PWA por ${full_name}\n\n${payload.observacoes ?? ''}".trim()`
   - Em manutenções/movimentações, prefixo análogo no campo `motivo`/`descricao`
   - `created_by = null` (R1: cross-project user mapping não é possível)
6. Cliente Supabase do LA Report (service-role) executa
7. Retorna `{ ok: true, data: row }` ou erro

### Upload de foto

- `multer` ou parsing manual de multipart (max 5MB, JPEG/PNG/WebP)
- Upload pro bucket `inventario-fotos` do LA Report Storage
- Nome do arquivo: `${unidade_id}/${sala_id ?? 'sem-sala'}/${uuid()}.${ext}`
- Bucket policy: public read, write apenas com service-role
- Retorna `{ url: 'https://.../storage/v1/object/public/inventario-fotos/...' }`
- PWA usa esse URL no campo `foto_url`

### TOM

- `src/services/inventario-service.js` ganha `buscarItemPorNome(nome, unidadeId?)` — fuzzy search por nome com limit 5.
- `src/prompts/system.js` ganha bloco `[INVENTARIO_CONSULTA]` quando user pergunta sobre item específico (ex: "como tá o piano da Amy?").
- `src/engine.js` parser de `<<INVENTORY_ACTION>>` aceita `action: "ver"` com campo `nome` (obrigatório) + `unidade` (opcional). Resposta formatada:
  ```
  🎹 Piano Digital (Amy · Barra)
  • Condição: bom · Status: ativo
  • Marca/Modelo: Yamaha P-125
  • Valor: R$ 4.500 · NF: 12345
  • Próx revisão: 2026-08-15 ✅
  • Última manutenção: nenhuma
  ```

---

## Componentes PWA novos

```
web/src/screens/inventario/
  ListaPage.tsx                 modificado (stats 4 cards + sala cards médios)
  SalaPage.tsx                  modificado (FAB contextual + menu de ações no item)
  components/
    SalaCardMedio.tsx           NOVO — substitui SalaCard atual
    StatsCards.tsx              NOVO — 4 cards (Total / Valor / Manut / Atenção)
    ItemFAB.tsx                 NOVO — botão flutuante contextual (bottom-right)
    ItemSheet.tsx               NOVO — bottom sheet full-screen pra criar/editar
    MoverItemSheet.tsx          NOVO — escolhe sala destino + motivo
    ManutencaoSheet.tsx         NOVO — registra manutenção
    BaixaConfirmSheet.tsx       NOVO — confirma soft-delete
    ItemAcoesMenu.tsx           NOVO — bottom sheet com ações disponíveis
    FotoUploader.tsx            NOVO — preview + upload

web/src/lib/
  lareport-client.ts            NOVO — supabase-js direto ao LA Report
  lareport-mutations.ts         NOVO — funções fetch pros endpoints write
  lareport-realtime.ts          NOVO — wrapper de channel subscription

web/src/hooks/
  useInventarioMutations.ts     NOVO — createItem/updateItem/moveItem/registrarManutencao/darBaixa
  useRealtimeSala.ts            NOVO — subscribe nas mudanças da sala atual
  useRealtimeSalas.ts           NOVO — subscribe na lista de salas
  useLaReport.ts                modificado — refatora pra usar laReportClient direto
```

### SalaCardMedio (layout)

```
┌────────────────────────────────────────┐
│ 🎤  Amy                  [Sala Coringa]│
│     Canto/Vocal                        │
│                                        │
│ Capacidade: 5 alunos  ·  Buffer: 10min │
│ Itens: 8  ·  Manutenções pendentes: 0  │
└────────────────────────────────────────┘
```

Click no card → SalaPage. Sem botões inline (mantém zona de tap limpa).

### StatsCards (4 cards, grid 2×2 no mobile)

| Total itens | Valor total |
| ----------- | ----------- |
| Em manutenção (warn) | Atenção (danger) |

- "Total itens" = COUNT(inventario WHERE unidade_id=X AND ativo=true)
- "Valor total" = SUM(valor_compra WHERE ...)
- "Em manutenção" = COUNT(... AND status='manutencao')
- "Atenção" = COUNT(... AND proxima_revisao <= NOW() + alerta_revisao_dias)
- Click no "Atenção" navega pra `/inventario/atencao` (lista filtrada). Os outros 3 são informativos.

### ItemSheet (modal de criar/editar)

Bottom sheet full-screen com 5 seções (cada uma é um `<section>` separado, scroll vertical único):

1. **Identificação** — Nome\*, Categoria\* (select com emojis CATEGORIA_INVENTARIO_META), Marca, Modelo, Núm Série, Qtd (default 1)
2. **Localização** — Unidade\* (auto-selecionada pelo contexto), Sala (auto-selecionada na SalaPage)
3. **Financeiro** — Valor compra, Data compra, NF, Fornecedor
4. **Status & Condição** — Status (select), Condição (select), Próx revisão, Alertar dias antes (default 30)
5. **Foto + Observações** — FotoUploader (drag & drop ou tap pra escolher) + textarea

CTA fixo no rodapé: "Cadastrar Equipamento" (criação) / "Salvar Alterações" (edição). Validação client-side antes de submeter.

### ItemAcoesMenu

Tap no item → bottom sheet com:
- ✏️ Editar
- ↔️ Mover de sala
- 🔧 Registrar manutenção
- 🗑️ Dar baixa
- ❌ Cancelar

---

## Permissões

### Roles autorizadas pra escrita

Confirmar antes da implementação: `collaborator.role` em uso no LA Organizer DB tem apenas **director, coordinator, manager** (verificado em App.tsx). O usuário mencionou também "Rafinha, AP, Farmers" — esses provavelmente são:
- Rafinha → usuário específico, provavelmente `coordinator` ou `director`
- AP (Assistente Pedagógico) → pode ser `function_role` (campo separado) ou role atual
- Farmers → texto em `unidades.farmers_nomes`, não system role

**Decisão pra Fase A:** começar com `ALLOWED_WRITE_ROLES = ['director', 'coordinator', 'manager']` (paridade com reads). Se Rafinha não tiver um desses roles, ajustar antes do deploy. Documentar essa lista em `web/api/lareport/_common/auth.ts` (helper compartilhado) pra fácil ajuste futuro.

### RLS no LA Report

Permanece frouxa (`true` pra authenticated). Não é prioridade apertar agora porque:
- Acesso ao bundle exige login no LA Organizer (Supabase auth do LA Organizer)
- Anon key do LA Report sem JWT do LA Report ainda permite reads via RLS frouxa — aceitável (não há dado sensível por unidade)
- Gate real fica no serverless (writes)

---

## Storage bucket

**Setup manual no LA Report Supabase Dashboard antes da Fase A:**

1. Criar bucket `inventario-fotos`
2. Policy de read: `true` (public read)
3. Policy de write/delete: apenas `service_role` (não usuário)
4. Limite por arquivo: 5MB

---

## Realtime — estratégia de subscriptions

| Tela | Tabelas observadas | Estratégia |
| --- | --- | --- |
| ListaPage | `inventario` (qualquer mudança) | Invalida queries `lareport/salas` (recalcula itens_count) e `lareport/stats` |
| SalaPage | `inventario` (sala_id=X), `inventario_movimentacoes`, `inventario_manutencoes` | Invalida `lareport/sala/X` |
| LojaPage | `loja_estoque` (sem mudança nesta fase, mas hook pronto pra Fase B) | (futuro) |

Subscriptions são montadas no `useEffect` do hook e desmontadas no cleanup. Limite de 1 channel por tabela por hook (evita duplicação).

---

## Variáveis de ambiente novas

### Vercel (production + preview)
- `VITE_LA_REPORT_URL = https://ouqwbbermlzqqvtqwlul.supabase.co`
- `VITE_LA_REPORT_ANON_KEY = <anon_key_do_LA_Report>`

### `.env.local` (dev local — gitignored)
- Idem acima

### TOM `.env` (já existem, sem mudança)
- `LA_REPORT_URL`, `LA_REPORT_SERVICE_ROLE_KEY`

---

## Out-of-scope (Fase B, documentado)

**Sprint seguinte:** Lojinha bidirecional

- CRUD de produtos (`loja_produtos`): admin pode criar/editar/desativar
- Lançamento operacional de estoque (`loja_estoque`): entrada (compra), saída (venda/perda)
- FAB na LojaPage com 2 ações: "Novo produto" e "Lançar entrada/saída"
- Realtime de estoque (mesma estratégia)
- TOM: estender markers existentes `/loja add`, `/loja saida` (parser já existe, validar e refinar)
- Reaproveitar 90% da infra desta Fase A (lareport-client, mutations pattern, FAB pattern)

---

## Testes

### TOM service
- Smoke test: `curl -X POST /internal/lareport/inventario/buscar-por-nome -d '{"nome":"piano"}'` retorna 5 items max
- Engine: enviar mensagem "como tá o piano da Amy?" no WhatsApp → confirmar card formatado

### PWA (validação visual via Claude Preview)
- Após cada componente: screenshot + smoke flow
- Final: 2 abas abertas → editar em uma → confirmar update na outra sem refresh (realtime)
- Mobile width 360px: confirmar que bottom sheets funcionam sem overflow

### Serverless endpoints
- Smoke test cada endpoint com role autorizada → 200 + auditoria gravada
- Com role não autorizada → 403
- Sem JWT → 401

---

## Decisões abertas pra confirmar antes da implementação

1. **Roles autorizadas:** confirmar que `['director', 'coordinator', 'manager']` cobre Rafinha + Coord + Gerentes + Diretores. Se AP/Farmers precisarem escrever, definir como mapear.
2. **Bucket de fotos:** confirmar nome `inventario-fotos` ou outro padrão.
3. **Limite de tamanho de foto:** 5MB é razoável? (já é grande pra mobile)

---

## Riscos

- **Anon key no bundle:** mesmo padrão tomEngine — aceito como tech debt.
- **RLS frouxa do LA Report:** mantém. Single-org, single-tenant operacional — sem dado sensível por unidade pra leituras anônimas.
- **Realtime overhead:** com 5-10 users simultâneos é trivial. Acima disso, considerar throttling no client.
- **Cross-project user mapping:** R1 aplicado (created_by=null, "via PWA por &lt;nome&gt;" em observacoes). Sem regressão.

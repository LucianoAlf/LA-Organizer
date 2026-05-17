# Inventário Bidirecional (LA Report ↔ PWA ↔ TOM) — Design

**Data:** 2026-05-17 (v2 — incorpora 3 camadas de governança)
**Sprint:** Fase A (Inventário CRUD + cards ricos + FAB + realtime + governança)
**Sprint seguinte (Fase B, documentado):** Lojinha bidirecional

**Referências obrigatórias:**
- `matriz-governanca-la-report.md` (aprovada pelo Alf)
- `spec-camadas-protecao-la-report.md` (3 camadas de proteção)

---

## Objetivo

PWA do LA Organizer vira a interface primária do Rafinha pra gestão de inventário. CRUD completo, cards de sala enriquecidos com info da própria sala (capacidade, tipo, buffer), FAB contextual pra cadastro rápido, realtime entre clientes, e TOM ganha consulta `/inv ver`. Tudo refletindo bidirecional com o LA Report (Supabase cross-project `ouqwbbermlzqqvtqwlul`).

---

## Princípios

- **LA Report é fonte única de verdade.** Nenhuma duplicação de dados.
- **Governança via `checkAccess()` — fonte única.** PWA, TOM e Vercel serverless consultam a MESMA tabela de regras (`la-report-access-rules.json`). Zero listas duplicadas de roles.
- **Auditoria preservada.** Toda escrita do PWA grava "via PWA por &lt;nome&gt;" em `observacoes`/`motivo` (mesmo padrão R1 do TOM).
- **Defesa em profundidade.** Filtros aplicados no client (PWA), revalidados no serverless. RLS frouxa do LA Report aceita porque gate está no nosso código.
- **Segurança escalável ao uso atual.** Anon key do LA Report no bundle (single-org, single-tenant operacional) é aceitável; gating de escrita acontece no serverless.
- **YAGNI.** Lojinha CRUD fica pra Fase B (separada).

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│  PWA (Vite/React PWA, Vercel)                                       │
│                                                                     │
│  READ + REALTIME ──► checkAccess(collab,'inventario') ──► filtros  │
│                      laReportClient (anon key)                      │
│                      .from('inventario')                            │
│                      .eq('unidade_id', unitFilter)                  │
│                                                                     │
│  WRITE ──► /api/lareport/inventario/... ──► serverless              │
│                  ├─ valida JWT                                      │
│                  ├─ checkAccess(collab,'inventario') [revalidação] │
│                  ├─ injeta "via PWA por <nome>"                     │
│                  └─ writes via service-role                         │
│                                                                     │
│  FIELD GATING ──► campo "Valor compra" só renderiza se              │
│                   checkAccess(collab,'valor_patrimonial').allowed   │
└────────┬───────────────────────────────────────┬────────────────────┘
         │ realtime channel                      │ HTTPS
         ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LA Report Supabase (ouqwbbermlzqqvtqwlul)                          │
│  Tables: inventario, inventario_movimentacoes,                      │
│          inventario_manutencoes, salas, unidades                    │
│  Storage bucket: inventario-fotos                                   │
└─────────────────────────────────────────────────────────────────────┘
         ▲
         │ service-role (server-side only)
┌────────┴────────────────────────────────────────────────────────────┐
│  TOM (VPS, WhatsApp agent)                                          │
│  src/services/la-report-access.js (NOVO) ──► checkAccess()         │
│  src/services/inventario-service.js (já existe + buscarItemPorNome)│
│  src/prompts/system.js (modificado: injeta bloco dinâmico)         │
│  skills/governanca-dados.md (NOVO)                                  │
│  skills/inventario.md (modificado: passa por checkAccess)          │
└─────────────────────────────────────────────────────────────────────┘
```

### Fonte única de verdade: `la-report-access-rules.json`

Arquivo de regras (DATA_LEVELS + ACCESS_RULES) vive em **um único lugar**:

```
_remote/src/services/la-report-access-rules.json
```

- TOM (`la-report-access.js`) faz `require('./la-report-access-rules.json')`.
- PWA (`access-control.ts`) importa via `import rules from '../../../src/services/la-report-access-rules.json'` (Vite resolve build-time, sem cross-bundle).
- Alternativa se Vite não conseguir: símbolo soft-link `web/src/lib/la-report-access-rules.json` → `../../../src/services/la-report-access-rules.json` ou copy via build script.

**Zero duplicação de listas de roles.** Mudar regra de governança = editar 1 arquivo.

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

### Governança aplicada nas leituras (PWA)

Cada hook de leitura passa por `checkAccess()`:

```ts
// useInventarioSala.ts (exemplo)
const { collaborator } = useAuth();
const access = checkAccess(collaborator, 'inventario', { unit: targetUnit });

if (!access.allowed) {
  return { data: null, error: 'Acesso negado', allowed: false };
}

let query = laReportClient.from('inventario').select('*').eq('sala_id', salaId);
if (access.unitFilter) {
  // unitFilter pode ser uuid (1 unidade) ou uuid[] (multi-unidade, ex: professor)
  if (Array.isArray(access.unitFilter)) {
    query = query.in('unidade_id', access.unitFilter);
  } else {
    query = query.eq('unidade_id', access.unitFilter);
  }
}
```

**Filtros aplicados automaticamente:**
- Manager Barra → `WHERE unidade_id = barra_id`
- Farmer CG → `WHERE unidade_id = cg_id`
- Professor 1 unidade → `WHERE unidade_id = sua_unidade`
- Professor multi-unidade → `WHERE unidade_id IN (suas_unidades)`
- Rafinha (ops_tecnicas, unit=all) → sem filtro

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

Cada endpoint segue o mesmo fluxo:

1. Extrai JWT do `Authorization: Bearer`
2. Valida via `supabase.auth.getUser(token)` (cliente do LA Organizer)
3. Busca `collaborators` completo: `id, role, unit, full_name, function_role, pedagogical_role, sala_id`
4. **Chama `checkAccess(collab, dataType)`** onde `dataType` depende do endpoint:
   - POST `/inventario` (criar) → `dataType='inventario'`
   - PATCH `/inventario/[id]` → `dataType='inventario'`. Se payload contém `valor_compra` ou `nota_fiscal`, **adicional `checkAccess(collab, 'valor_patrimonial')`** — senão remove esses campos do payload (defesa em profundidade contra request manipulado).
   - DELETE `/inventario/[id]` → `dataType='inventario'`
   - POST `/inventario/[id]/mover` → `dataType='movimentacoes'`
   - POST `/inventario/[id]/manutencao` → `dataType='inventario'`
5. Se `!access.allowed` → 403 com `{ ok: false, error: access.reason }`
6. Se `access.unitFilter` definido, valida que o registro pertence àquela unidade (consulta antes do UPDATE/DELETE):
   - PATCH/DELETE: `SELECT unidade_id FROM inventario WHERE id=X` → se `!= access.unitFilter`, 403
7. Antes de gravar, monta payload com:
   - `observacoes = "via PWA por ${full_name}\n\n${payload.observacoes ?? ''}".trim()`
   - Em manutenções/movimentações, prefixo análogo no campo `motivo`/`descricao`
   - `created_by = null` (R1: cross-project user mapping não é possível)
8. Cliente Supabase do LA Report (service-role) executa
9. Retorna `{ ok: true, data: row }` ou erro

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

## Componentes — PWA + TOM + serverless

### Governança (novos, transversais)

```
_remote/src/services/
  la-report-access-rules.json   NOVO — DATA_LEVELS + ACCESS_RULES (FONTE ÚNICA)
  la-report-access.js           NOVO — checkAccess() para TOM/Node (CommonJS)

_remote/web/src/lib/
  access-control.ts             NOVO — checkAccess() para PWA (TS port, importa o JSON)

_remote/web/api/_lib/
  access-control.ts             NOVO — checkAccess() para Vercel serverless (TS, importa o JSON)

_remote/skills/
  governanca-dados.md           NOVO — skill markdown carregada quando LA Report ativo
```

**Teste de paridade obrigatório:** snapshot test comparando outputs de `checkAccess()` em JS vs TS pra um set de fixtures (Rafinha, Jereh, Krissya, professor, farmer CG, etc).

### PWA — invent ário

```
web/src/screens/inventario/
  ListaPage.tsx                 modificado (StatsCards condicional + Lojinha condicional + sala cards médios)
  SalaPage.tsx                  modificado (FAB contextual + menu de ações no item)
  components/
    SalaCardMedio.tsx           NOVO — substitui SalaCard atual
    StatsCards.tsx              NOVO — 3 ou 4 cards baseado em checkAccess('valor_patrimonial')
    ItemFAB.tsx                 NOVO — botão flutuante (só renderiza se checkAccess('inventario').allowed)
    ItemSheet.tsx               NOVO — bottom sheet criar/editar; campos sensíveis condicionais
    MoverItemSheet.tsx          NOVO — checkAccess('movimentacoes')
    ManutencaoSheet.tsx         NOVO — checkAccess('inventario')
    BaixaConfirmSheet.tsx       NOVO — checkAccess('inventario')
    ItemAcoesMenu.tsx           NOVO — só mostra ações permitidas pelo role
    FotoUploader.tsx            NOVO — preview + upload
    AcessoNegadoState.tsx       NOVO — empty state pra quando access.allowed===false

web/src/lib/
  lareport-client.ts            NOVO — supabase-js direto ao LA Report (anon key)
  lareport-mutations.ts         NOVO — fetch wrappers pros endpoints write
  lareport-realtime.ts          NOVO — wrapper de channel subscription
  access-control.ts             NOVO — re-export checkAccess + helpers de field-gating

web/src/hooks/
  useInventarioMutations.ts     NOVO — createItem/updateItem/moveItem/registrarManutencao/darBaixa
  useRealtimeSala.ts            NOVO — subscribe nas mudanças da sala atual
  useRealtimeSalas.ts           NOVO — subscribe na lista de salas
  useLaReport.ts                modificado — aplica unitFilter/scopeFilter de checkAccess
  useAccess.ts                  NOVO — hook conveniente: useAccess('inventario') → {allowed, unitFilter, scopeFilter}
```

### TOM

```
_remote/src/services/
  la-report-access.js           NOVO (descrito acima)
  inventario-service.js         modificado — buscarItemPorNome() + todas funções recebem `collab` e checam access

_remote/src/prompts/
  system.js                     modificado — bloco dinâmico de governança quando LA Report ativo

_remote/src/engine.js           modificado — handler /inv ver + revalida checkAccess antes de cada query

_remote/skills/
  inventario.md                 modificado — invoca checkAccess; resposta de recusa padronizada
  governanca-dados.md           NOVO
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

### StatsCards (condicional 3 ou 4 cards)

**Comportamento:**
- `checkAccess(collab, 'valor_patrimonial').allowed === true` → renderiza **4 cards** (grid 2×2): Total / Valor total / Em manutenção / Atenção
- Caso contrário → renderiza **3 cards** (grid 3×1 ou 2+1): Total / Em manutenção / Atenção

**Quem vê "Valor total":** apenas Direção, Rafinha (ops_tecnicas), Rose (backoffice_fin).

**Queries:**
- "Total itens" = COUNT(inventario WHERE ativo=true [+ unitFilter se aplicável])
- "Valor total" = SUM(valor_compra WHERE ativo=true [+ unitFilter])
- "Em manutenção" = COUNT(... AND status='manutencao')
- "Atenção" = COUNT(... AND proxima_revisao <= NOW() + alerta_revisao_dias)

Click no "Atenção" → `/inventario/atencao` (lista filtrada). Outros são informativos.

### Lojinha card na ListaPage (condicional)

`checkAccess(collab, 'loja_produtos').allowed === false` → card "Lojinha" não renderiza.

**Quem NÃO vê Lojinha:** Coordenação (Juliana, Quintela), Marketing, Pedagógico, Professores, Hunters, Tech.

**Quem vê:** Direção, Gerentes (🔒u), Ops (Rafinha), Farmers (🔒u), Backoffice (Rose).

### ItemSheet (modal de criar/editar)

Bottom sheet full-screen com 5 seções (cada uma é um `<section>` separado, scroll vertical único):

1. **Identificação** — Nome\*, Categoria\* (select com emojis CATEGORIA_INVENTARIO_META), Marca, Modelo, Núm Série, Qtd (default 1)
2. **Localização** — Unidade\* (auto-selecionada pelo contexto + restrita a `unitFilter` se houver), Sala (auto-selecionada na SalaPage; opções filtradas pra unidade permitida)
3. **Financeiro** *(toda a seção condicional)* — só renderiza se `checkAccess(collab, 'valor_patrimonial').allowed`. Campos: Valor compra, Data compra, NF, Fornecedor. Pra quem não vê, esses campos são `null` no payload.
4. **Status & Condição** — Status (select), Condição (select), Próx revisão, Alertar dias antes (default 30)
5. **Foto + Observações** — FotoUploader (drag & drop ou tap pra escolher) + textarea

CTA fixo no rodapé: "Cadastrar Equipamento" (criação) / "Salvar Alterações" (edição). Validação client-side antes de submeter.

**Defesa em profundidade:** Se um cliente malicioso enviar `valor_compra` no payload sem ter acesso, o serverless **remove o campo silenciosamente** (não rejeita o request — apenas ignora o campo restrito). Loga warning no console pra auditoria.

### ItemAcoesMenu

Tap no item → bottom sheet com:
- ✏️ Editar
- ↔️ Mover de sala
- 🔧 Registrar manutenção
- 🗑️ Dar baixa
- ❌ Cancelar

---

## Permissões — `checkAccess()` é fonte única

**Zero listas hardcoded de roles.** Tudo passa por `checkAccess(collab, dataType, opts)` que consulta `la-report-access-rules.json`.

### Mapeamento operacional

Reusamos a tabela aprovada na `matriz-governanca-la-report.md`:

| Quem | role | function_role | unit | inventario | valor_patrim. | loja | movimentações |
|---|---|---|---|---|---|---|---|
| Luciano Alf | director | — | all | ✔ | ✔ | ✔ | ✔ |
| Anne Susan | director | — | all | ✔ | ✔ | ✔ | ✔ |
| Rafinha | collaborator | ops_tecnicas | all | ✔ | ✔ | ✔ | ✔ |
| Juliana (coord) | coordinator | — | all | ✔ | ✘ | ✘ | ✔ |
| Jereh (gerente CG) | manager | — | CG | ✔ 🔒u | ✘ | ✔ 🔒u | ✔ 🔒u |
| Krissya (gerente Barra) | manager | — | Barra | ✔ 🔒u | ✘ | ✔ 🔒u | ✔ 🔒u |
| Farmer Barra | collaborator | farmer | Barra | ✔ 🔒u | ✘ | ✔ 🔒u | ✔ 🔒u |
| Professor (1 unid) | collaborator | professor | Barra | ✔ 🔒u (Barra) | ✘ | ✘ | ✘ (só manutenção) |
| Professor (multi) | collaborator | professor | all | ✔ (suas unid) | ✘ | ✘ | ✘ (só manutenção) |
| Pedagógico (Dai) | collaborator | — (pedagogical_role=true) | all | ✔ | ✘ | ✘ | ✘ |
| Hugo (tech) | collaborator | tech | all | ✔ | ✘ | ✘ | ✔ |
| Marketing (Yuri) | collaborator | marketing | all | ✘ | ✘ | ✘ | ✘ |

(Lista completa vive no JSON; tabela acima é resumo pra contexto.)

### Aplicação

- **Reads (PWA):** hook `useAccess('inventario')` retorna `{ allowed, unitFilter, scopeFilter }`. Hook de query aplica os filtros automaticamente.
- **Writes (serverless):** revalida `checkAccess()` antes de cada mutation. Se `unitFilter` setado, valida que o registro alvo pertence a essa unidade.
- **Field gating (PWA + serverless):** `valor_compra`/`nota_fiscal` só passam se `checkAccess(collab, 'valor_patrimonial').allowed`.
- **TOM:** `engine.js` chama `checkAccess()` antes de qualquer query no `laReportClient`. Skill `governanca-dados.md` instrui o LLM a respeitar a frase de recusa padrão.

### RLS no LA Report

Permanece frouxa (`true` pra authenticated). Aceito porque:
- Acesso ao bundle exige login no LA Organizer (Supabase auth nosso)
- Bundle não expõe service-role do LA Report
- Gate real está no `checkAccess()` (3 lugares: PWA, serverless, TOM)

**Reavaliar na Fase C** (depois de Lojinha): apertar RLS do LA Report pra auth-based row policies. Por ora, não é prioridade.

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

### Paridade JS↔TS de `checkAccess()`

Fixture com 12 collaborators (Luciano, Anne, Rafinha, Jereh, Krissya, Clayton, Juliana, farmer CG, professor Barra, Dai pedagógico, Hugo, Yuri marketing) × 12 dataTypes → 144 cenários. Output JS == output TS pra cada cenário.

### TOM
- Smoke: `node -e "console.log(require('./src/services/la-report-access').checkAccess(rafinha, 'inventario'))"` → allowed:true
- Engine: "como tá o piano da Amy?" enviado por Rafinha → card formatado; enviado por Marketing → "Essa informação é restrita ao seu perfil"
- `/inv add` enviado por professor → recusado com frase padrão

### PWA (validação visual via Claude Preview)
- Login como Rafinha → vê 4 stats cards + Lojinha + FAB + campo Valor compra
- Login como Manager Barra → vê 3 stats cards + Lojinha (só Barra) + FAB + SEM campo Valor compra
- Login como Coordenação → vê 3 stats cards, SEM Lojinha, FAB sim
- Login como Professor → vê só inventário da sua sala, FAB só pra Manutenção (sem criar/mover/baixa)
- 2 abas abertas → editar em uma → confirmar update na outra (realtime)
- Mobile 360px: bottom sheets sem overflow

### Serverless endpoints
- POST /inventario com Rafinha → 200, auditoria gravada
- POST /inventario com Marketing → 403
- PATCH /inventario/[id] com Manager Barra editando item da CG → 403 (unitFilter mismatch)
- PATCH /inventario/[id] com `valor_compra` enviado por Manager → 200 mas campo removido do payload + warning log
- Sem JWT → 401

### Cenários da matriz (E2E PWA)
| Cenário | Collaborator | Ação | Esperado |
|---|---|---|---|
| Inventário liberado all | Rafinha | abrir SalaPage Hendrix Barra | Lista equipamentos |
| Inventário filtrado | Farmer CG | abrir ListaPage | Vê só CG, não Barra/Recreio |
| Inventário prof (1 unid) | Professor Barra | abrir ListaPage | Vê todas salas da Barra |
| Inventário prof (multi) | Professor Barra+CG | abrir ListaPage | Vê salas da Barra e CG |
| Valor patrim. bloqueado | Manager Barra | abrir ItemSheet | Sem seção Financeiro |
| Lojinha bloqueada | Juliana coord | abrir ListaPage | Sem card Lojinha |
| Edit unit mismatch | Manager Barra | tentar editar item CG via URL direta | 403 |
| Manutenção liberada | Professor | abrir ItemAcoesMenu em qualquer item | Só vê "🔧 Registrar manutenção", sem "Editar/Mover/Baixa" |
| Tentativa criar item | Professor | tentar acionar FAB | FAB não renderiza |

---

## Decisões fechadas (2026-05-17)

1. **Bucket de fotos:** `inventario-fotos` ✅
2. **Limite tamanho foto:** 5MB ✅
3. **Permissões por role:**
   - Roles autorizadas pra **ler/escrever** inventário: as que `checkAccess('inventario').allowed === true`
   - **Professor:** pode VER inventário de QUALQUER sala (precisa saber o que tem antes de dar aula) + REGISTRAR MANUTENÇÃO. NÃO cria, NÃO move, NÃO dá baixa. Sem conceito de "sala fixa".
   - **Filtro de unidade pra professor:** se trabalha em 1 unidade só, `unitFilter` = essa unidade. Se trabalha em 2+, `unitFilter = null` (vê todas as suas).
   - **ItemAcoesMenu** condicional: pra professor mostra só "🔧 Registrar manutenção" + "❌ Cancelar"
4. **Schema do `collaborators`:**
   - `pedagogical_role` ✅ existe (valores: `lead`, `assistant`, `mentor`)
   - `function_role` ✅ existe (nullable, criado Sprint 22.51)
   - **NÃO precisa de `sala_id`** — professor não tem sala fixa.
   - **Migration pendente:** `_remote/docs/migrations/2026-05-17-collaborators-function-roles.sql` popula `function_role` pra Rafinha (ops_tecnicas), Hugo (tech), Yuri (marketing). Aplicar antes da implementação.

### Resolução de `unitFilter` para professor (STUB nesta Fase A)

**Status atual do DB (verificado 2026-05-17):**
- `collaborators.la_report_professor_id` ❌ NÃO existe
- Zero collaborators com `function_role='professor'` (17 nulls, 3 populados)
- Conclusão: **professor logando na PWA é cenário teórico nesta Fase A**

**Decisão:** implementar `unidadesDoProfessor(collab)` como **stub que retorna `[]`** (acesso negado). Mantém a regra na matriz `ACCESS_RULES` por consistência, mas a função real só será implementada na Fase B+ quando professores forem cadastrados como collaborators.

```ts
// web/src/lib/access-control.ts (stub Fase A)
async function unidadesDoProfessor(collab: Collaborator): Promise<string[]> {
  // TODO Fase B+: implementar quando professores forem cadastrados como collaborators
  // Opções de mapping na Fase B:
  //   1. Adicionar coluna la_report_professor_id em collaborators (limpo)
  //   2. Fuzzy match por full_name vs professores.nome no LA Report (rápido)
  //   3. Query em turmas_explicitas / aulas_emusys por professor_nome
  console.warn('unidadesDoProfessor: stub Fase A — retornando [] (acesso negado)');
  return [];
}

// No checkAccess, quando function_role==='professor':
if (rule.professor_seus_unidades && function_role === 'professor') {
  const unidades = await unidadesDoProfessor(collab);
  if (unidades.length === 0) {
    return { allowed: false, reason: 'Professor sem unidades vinculadas — fala com a coordenação.' };
  }
  return {
    allowed: true,
    unitFilter: unidades.length === 1 ? unidades[0] : unidades,  // string ou string[]
    scopeFilter: null,
    reason: 'ok'
  };
}
```

**Teste:** caso "Professor logando" da matriz será marcado como **PENDENTE Fase B** no plan. Ação permitida no ItemAcoesMenu pra professor segue sendo só "🔧 Registrar manutenção" — mas como nenhum professor existe, comportamento real é "acesso negado".

---

## Riscos

- **Anon key no bundle:** mesmo padrão tomEngine — aceito como tech debt.
- **RLS frouxa do LA Report:** mantém. Single-org, single-tenant operacional — sem dado sensível por unidade pra leituras anônimas.
- **Realtime overhead:** com 5-10 users simultâneos é trivial. Acima disso, considerar throttling no client.
- **Cross-project user mapping:** R1 aplicado (created_by=null, "via PWA por &lt;nome&gt;" em observacoes). Sem regressão.

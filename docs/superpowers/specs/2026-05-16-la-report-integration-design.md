# LA Report Integration — Spec de Design

**Data:** 2026-05-16
**Owner:** Luciano Alf
**Usuário-alvo principal:** Rafinha (Operações Técnicas)
**Stack:** Node.js (TOM) + Supabase cross-project + React/TS (PWA)
**Status:** Spec — aguardando aprovação antes de `writing-plans`
**PRD origem:** `PRD-integracao-la-report.md` (anexo do usuário)

---

## 1. Goal

Integrar o TOM (agente WhatsApp do LA Organizer) ao banco **LA Report** (Supabase `ouqwbbermlzqqvtqwlul`) para que o Rafinha possa **consultar e popular inventário, salas e lojinha pelo WhatsApp ou pelo PWA**. LA Report é a fonte de verdade — nada se duplica no LA Organizer. TOM lê e escreve diretamente lá via service_role.

Escopo desta sprint: **Fases 1, 2 e 3 do PRD** (consultas + escrita inventário + loja + PWA). **Fase 4 (professores/alunos/evasão/CRM) fica fora** — abre escopo e mexe em dados sensíveis (1.472 alunos).

---

## 2. Auditoria do banco LA Report (confirmada via MCP em 2026-05-16)

| Tabela | Estado real | Cols críticas | Notas |
|---|---|---|---|
| `unidades` | 3 (Barra, Campo Grande, Recreio) | `id uuid, nome varchar` | IDs UUID já mapeados |
| `salas` | 53 total / **42 ativas** | `id int, unidade_id uuid, nome, tipo_sala, recursos array, ativo bool` | `sala_id` é INT (não UUID) |
| `inventario` | 0 linhas, 26 colunas | `id int, sala_id int, unidade_id uuid, nome, categoria, marca, modelo, valor_compra numeric, status, condicao, quantidade int, foto_url, proxima_revisao date, created_by uuid` | Schema completo, vazio |
| `inventario_movimentacoes` | 0 linhas | `id int, item_id int, tipo, sala_origem_id int, sala_destino_id int, motivo, data_movimentacao, usuario_id uuid` | `usuario_id` UUID, NÃO bate com IDs do LA Organizer |
| `inventario_manutencoes` | 0 linhas | `id int, item_id int, tipo, descricao, custo numeric, data_manutencao, data_proxima_revisao, responsavel, fornecedor_servico, created_by uuid` | `created_by` UUID |
| `loja_produtos` | 10 | `id int, nome, sku, preco numeric, custo, estoque_minimo, foto_url, disponivel_whatsapp bool, ativo` | Tem flag `disponivel_whatsapp` ✨ |
| `loja_estoque` | 2 | `id int, produto_id int, variacao_id int, unidade_id uuid, quantidade int` | Per-unidade |
| `loja_movimentacoes_estoque` | — | `id, produto_id, variacao_id, unidade_id, tipo, quantidade, saldo_apos, colaborador_id int` | **`colaborador_id` é INT** (inconsistência com outras tabelas — referencia `colaboradores.id` do LA Report) |
| `loja_categorias` / `loja_variacoes` | — | standard | Usar só para enriquecer UI |
| `colaboradores` (LA Report) | — | tabela separada de `collaborators` do LA Organizer | **NÃO usar mapping cross-project** (R1) |
| `professores`, `alunos`, `turmas` | 52 / 1472 / 0 | — | **Fora do escopo desta sprint** |
| Storage buckets | `inventario-fotos`, `lojinha-produtos`, `avatars`, etc | todos públicos | Usar `inventario-fotos` para fotos de patrimônio |

---

## 3. Guardrails aprovados (R1-R4)

### R1 — Mapeamento de usuário cross-project
**Decisão:** Em todos os INSERTs do LA Report feitos pelo TOM/PWA, gravar `NULL` em `created_by`/`usuario_id`/`colaborador_id` e prefixar `observacoes` (campo TEXT presente em todas as tabelas) com `"via TOM por <nome>"`.
- Sem mapping table.
- Sem refactor de schema do LA Report.
- Pode evoluir depois se precisar (e.g., adicionar coluna `external_user_label`).

### R2 — Skill detection contextual
**Decisão:** Triggers genéricos ("sala", "estoque", "baqueta", "corda") só ativam quando combinados com **contexto operacional**:
- Palavras-chave fortes (acionam sozinhas): `inventário`, `inventario`, `patrimônio`, `lojinha`, `loja`, `estoque baixo`
- Palavras de unidade (Barra, Recreio, Campo Grande, CG) — acionam com qualquer curso/sala
- Nomes conhecidos de sala (Hendrix, Amy, Drum Kids, etc — lookup dinâmico)
- Comandos `/inv`, `/loja`
- Palavras genéricas isoladas (corda, sala, bateria, canto) **NÃO** acionam — viram contexto adicional só se já houver outra trigger

### R3 — Escopo Fases 1+2+3 nesta sprint
**Incluído:**
- ✅ Client cross-project + endpoints internal-api
- ✅ Skill `inventario.md` + skill `pesquisa-preco.md`
- ✅ Slash commands `/inv` e `/loja` (incluindo subcomandos)
- ✅ Marker `<<INVENTORY_ACTION>>` + parser no engine
- ✅ PWA `/inventario`, `/inventario/sala/:id`, `/inventario/loja`
- ✅ Cron alertas (estoque baixo, manutenção pendente, revisão programada)
- ✅ Storage de fotos no bucket `inventario-fotos`

**Excluído (Fase 4 do PRD, outro spec):**
- ❌ Acesso a `professores`/`alunos`/`turmas`
- ❌ Evasão e performance
- ❌ CRM / leads
- ❌ Sync bidirecional LA Report ↔ LA Organizer

### R4 — Slash commands + Marker JSON
**Decisão:** Dois caminhos de escrita, mesma lógica:
- **Slash command** (early return sem LLM): rápido, baixo custo de tokens, para ações conhecidas
- **Marker JSON** (`<<INVENTORY_ACTION>>`): LLM extrai intent de linguagem natural e emite ação estruturada, engine valida + executa

---

## 4. UX aprovado (4 mockups)

| Tela | URL/contexto | Status |
|---|---|---|
| `01-inventario-unidades.html` | PWA `/inventario` — tabs unidade + stats + cards de sala + atalho lojinha | ✅ |
| `02-sala-detalhe.html` | PWA `/inventario/sala/:id` — header com recursos + tabs (Itens/Movimentações/Manutenção) + filtros por categoria | ✅ |
| `03-loja.html` | PWA `/inventario/loja` — tabs unidade + alerta estoque baixo + cards produto | ✅ |
| `04-tom-whatsapp.html` | TOM WhatsApp — 5 cenários (slash, NL→marker, transferência, manutenção+preço, cron alerta) | ✅ |

Mockups salvos em `.superpowers/brainstorm/10175-1778969313/content/` (não comitar — é workspace).

---

## 5. Design system — REGRA OBRIGATÓRIA

**ZERO componente nativo do navegador.** Toda a UI usa componentes já existentes em `_remote/web/src/components/`:

| Necessidade | Componente DS |
|---|---|
| Header + back nav | `PageHeader` (props `title, subtitle?, backTo?, right?`) |
| Tabs (unidade, abas internas) | `Tabs` |
| Stats no topo | `StatCard` |
| Cards de sala/produto/item | `Card` |
| Loading | `LoadingState` |
| Vazio | `EmptyState` |
| Toast/feedback | `Toast` (`showToast`) |
| Badge de status (condição, estoque) | `Badge` (tones success/warning/danger) |
| Chips de filtro | (inline buttons, padrão do projeto) |
| Modal de confirmação | `ConfirmDialog` |

Tokens Tailwind: `bg-bg-app`, `bg-bg-surface`, `text-fg`, `text-fg-muted`, `text-tom`, `border-border`, `bg-success`, `bg-warning`, `bg-danger`. Botões `bg-tom` usam `text-black` (padrão LA Organizer).

---

## 6. Rotas PWA

Em `_remote/web/src/App.tsx`, adicionar dentro de `<AppShell>` (após bloco LA Journey):

```tsx
{/* INVENTÁRIO — dados vêm do LA Report via internal-api do TOM. Read-only.
    Visível pra coord/director/manager + collaborator com permissão (Rafinha). */}
<Route element={<ProtectedRoute requireRoles={['coordinator', 'director', 'manager']} />}>
  <Route path="inventario" element={<InventarioListaPage />} />
  <Route path="inventario/loja" element={<InventarioLojaPage />} />
  <Route path="inventario/sala/:salaId" element={<InventarioSalaPage />} />
</Route>
```

(Rafinha é `manager` no LA Organizer, então o gating funciona. Verificar se outros collaborators precisam de acesso — se sim, adicionar `'collaborator'` à lista.)

Link no `/mais` (após link LA Journey): `📦 Inventário · Salas e lojinha`. Oculto se `role === 'leader'` (não-operacional).

---

## 7. Backend — Camada de dados cross-project

### 7.1 `_remote/src/services/la-report-client.js` (NOVO)

```js
const { createClient } = require('@supabase/supabase-js');

if (!process.env.LA_REPORT_SUPABASE_URL || !process.env.LA_REPORT_SERVICE_ROLE_KEY) {
  console.warn('[la-report-client] credenciais LA Report não configuradas — feature inventário desabilitada');
}

const laReportClient = createClient(
  process.env.LA_REPORT_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.LA_REPORT_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { persistSession: false } }
);

function isLaReportConfigured() {
  return !!(process.env.LA_REPORT_SUPABASE_URL && process.env.LA_REPORT_SERVICE_ROLE_KEY);
}

module.exports = { laReportClient, isLaReportConfigured };
```

### 7.2 `_remote/src/services/inventario-service.js` (NOVO)

Encapsula TODAS as queries ao LA Report. Único módulo que importa `laReportClient`. Engine/skills/api só chamam funções deste service.

**Funções de leitura:**
```js
listarUnidades()                                  // → [{id, nome}]
listarSalasPorUnidade(unidadeId)                  // → [{id, nome, tipo_sala, recursos, ...}] WHERE ativo=true
buscarSalaPorNome(nome, unidadeId?)               // fuzzy lookup: ilike '%nome%' + opcional filtro unit
detalheSala(salaId)                               // → {sala, itens, movimentacoes, manutencoes}
listarItensDeSala(salaId)                         // → [{...}]
listarLojaPorUnidade(unidadeId)                   // → [{produto, estoque, abaixoMinimo}]
listarProdutosAtivos()                            // → [{id, nome, preco, custo, estoque_minimo}]
buscarProdutoPorNome(nome)                        // fuzzy
listarManutencoesPendentes(diasMin = 14)          // → [...]
listarEstoqueBaixo(unidadeId?)                    // → [...]
listarRevisoesProgramadas(diasAtePrazo = 7)       // → [...]
```

**Funções de escrita (todas com observacoes prefixadas):**
```js
inserirItem({nome, salaId, unidadeId, categoria, marca, modelo, valorCompra, ...}, viaTomLabel)
registrarMovimentacao({itemId, tipo, salaOrigemId?, salaDestinoId?, motivo}, viaTomLabel)
registrarManutencao({itemId, tipo, descricao, custo?, fornecedor?}, viaTomLabel)
darEntradaEstoque({produtoId, unidadeId, quantidade, notaFiscal?}, viaTomLabel)
darSaidaEstoque({produtoId, unidadeId, quantidade, motivo}, viaTomLabel)
uploadFotoItem(itemId, bufferOrUrl)               // → URL do bucket inventario-fotos
```

**Constante:** `const viaTom = nomeRafinha => 'via TOM por ' + nomeRafinha;`

### 7.3 `_remote/src/internal-api.js` (MODIFICAR)

Adicionar endpoints (após bloco LA Journey):

```js
// ─── INVENTÁRIO (cross-project LA Report) ─────────────────────
app.get('/internal/lareport/unidades', requireInternalSecret, async (_req, res) => { ... });
app.get('/internal/lareport/salas', requireInternalSecret, async (req, res) => {
  // ?unit=<uuid> → lista salas da unidade com contagem de itens
});
app.get('/internal/lareport/sala/:salaId', requireInternalSecret, async (req, res) => {
  // detalhe completo: header + itens + movimentações + manutenções
});
app.get('/internal/lareport/loja', requireInternalSecret, async (req, res) => {
  // ?unit=<uuid> → produtos + estoque + flag baixo
});
app.get('/internal/lareport/alertas', requireInternalSecret, async (_req, res) => {
  // estoque baixo + manutenções pendentes + revisões próximas (consolidado)
});
```

Esses endpoints são chamados pelo PWA (browser → TOM via cookie+secret) — **NÃO** expor `LA_REPORT_SERVICE_ROLE_KEY` ao browser.

### 7.4 `_remote/web/src/lib/lareport.ts` + `useLaReport.ts` (NOVOS)

PWA usa fetch HTTP nos endpoints acima (mesmo padrão do que já existe pro `/internal` do LA Organizer). Hooks TanStack Query:

```ts
useLaReportUnidades()
useLaReportSalas(unidadeId)
useLaReportSalaDetalhe(salaId)
useLaReportLoja(unidadeId)
useLaReportAlertas()
```

---

## 8. TOM — Slash commands + Marker JSON

### 8.1 Slash commands no `engine.js`

Pattern idêntico ao `/journey`. Subcomandos:

| Comando | Ação | Implementação |
|---|---|---|
| `/inv [unidade]` | lista salas com contagem | `inventarioService.listarSalasPorUnidade(...)` |
| `/inv [sala] [unidade?]` | detalhe de uma sala | fuzzy lookup por nome |
| `/inv add` | abre fluxo guiado | TOM pergunta sala/nome/qtd/valor |
| `/inv mov [item] [origem→destino] [motivo]` | transferência | parse + insert movimentacao |
| `/inv manutencao [item] [problema]` | abre manutenção | insert manutencao + cria task pro Rafinha |
| `/inv alertas` | resumo de alertas pendentes | mesmo que cron |
| `/loja [unidade]` | lista produtos + estoque | `listarLojaPorUnidade` |
| `/loja entrada [qtd] [produto] [unidade] [NF?]` | recebimento | `darEntradaEstoque` |
| `/loja saida [qtd] [produto] [unidade] [motivo]` | saída manual | `darSaidaEstoque` |
| `/loja encomenda [unidade?]` | gera lista de compra (estoque baixo) | leitura + retorna lista |

Todas as ações de escrita pedem **confirmação inline** antes de gravar (mostra interpretação, espera "sim").

### 8.2 Marker `<<INVENTORY_ACTION>>` (JSON)

Quando usuário descreve ação em linguagem livre, LLM emite:

```json
<<INVENTORY_ACTION>>
{
  "action": "add_item|move_item|maintenance|shop_movement|query_room|query_shop",
  "params": { ... }
}
<<END>>
```

Engine intercepta o marker, valida via JSON schema, executa via `inventarioService`. Padrão idêntico ao `<<CHECKLIST_ACTION>>` já existente.

**Validações antes de gravar (server-side):**
- `nome` obrigatório (≥3 chars)
- `sala_id` resolvido por fuzzy lookup; se ambíguo, TOM pede para o usuário escolher
- `unidade_id` UUID válido na tabela `unidades`
- `quantidade` positiva
- `valor_compra` numérico ≥ 0

### 8.3 Skill `_remote/skills/inventario.md` (NOVA)

Documenta triggers contextuais (R2), exemplos de uso (R4), formato do marker. Triggers fortes: `inventário`, `patrimônio`, `lojinha`, `loja`, `/inv`, `/loja`. Triggers contextuais: combinação `[sala conhecida] + [unidade]`, ou `[curso] + (Barra|Recreio|Campo Grande|CG)`.

### 8.4 Skill `_remote/skills/pesquisa-preco.md` (NOVA)

Triggers: "quanto custa", "preço de", "orçamento de", "pesquisa preço" + nome de equipamento musical.

TOM usa **WebSearch tool** (já disponível no engine) com query `[item] [marca?] preço Mercado Livre OR Audiotec`. Retorna 3 ofertas + média estimada + link. Pode auto-preencher `valor_estimado` em `inventario_manutencoes` se solicitado.

---

## 9. Cron alertas (`_remote/src/rituals/inventario-alertas.js` NOVO)

Funções:
```js
runInventarioEstoqueBaixo()      // SELECT WHERE quantidade < estoque_minimo
runInventarioManutencoesPendentes()  // SELECT WHERE created_at < now()-14d AND status != 'concluido'
runInventarioRevisoesProgramadas()  // SELECT WHERE proxima_revisao BETWEEN now() AND now()+7d
```

Cada uma enfileira mensagens em `la_organizer.notifications` (tabela já existente — **NÃO** criar nova). Destinatário: Rafinha (sempre) + gerente da unidade quando aplicável.

`dispatcher.js` wiring (segunda 09h, único trigger para os 3):

```js
if (dow === 1 && hour === 9 && !(await logExists('inventario_alertas_semanal'))) {
  console.log('[dispatcher] rodando alertas inventário');
  try {
    await runInventarioEstoqueBaixo();
    await runInventarioManutencoesPendentes();
    await runInventarioRevisoesProgramadas();
    await logRitual('inventario_alertas_semanal');
  } catch (e) { console.error('[dispatcher] falha alertas inventário:', e); }
}
```

Fila já processada pelo `processarFilaNotificacoes` existente — não precisa novo processor.

---

## 10. Permissões e filtragem

| Role | Vê | Faz via TOM |
|---|---|---|
| `manager` (Rafinha) | Todas unidades | CRUD completo |
| `manager` (outros gerentes futuro) | Sua unidade só | Consulta + escrita restrita |
| `coordinator` | Todas | Consulta (escrita opcional) |
| `director` | Todas | Consulta (escrita opcional) |
| `collaborator` | (não vê nesta fase) | — |
| `leader` | (não vê) | — |

**Implementação:**
- RLS do LA Report é bypassado (service_role) — filtragem é **no engine/api**
- `req.user.unit` (vem do cookie/auth do LA Organizer) → adiciona `WHERE unidade_id = X` quando o role é `manager` não-Rafinha
- Rafinha identificado por `collaborator_id` ou flag `unit='all'` (padrão atual)

---

## 11. Storage — Fotos

Bucket: `inventario-fotos` (LA Report, público).

Fluxo:
1. Usuário envia foto no WhatsApp ao TOM
2. TOM baixa a foto da UAZAPI
3. Upload para `inventario-fotos/<sala_id>/<timestamp>.jpg` via `laReportClient.storage.from('inventario-fotos').upload(...)`
4. URL pública salva em `inventario.foto_url`

Nome do arquivo inclui timestamp para evitar conflito.

---

## 12. Variáveis de ambiente (.env da VPS)

```env
LA_REPORT_SUPABASE_URL=https://ouqwbbermlzqqvtqwlul.supabase.co
LA_REPORT_SERVICE_ROLE_KEY=<rotacionar após sprint>
INTERNAL_API_SECRET=<existente>
```

Adicionar checagem no startup do TOM (`engine.js` boot): se `LA_REPORT_*` ausente, logar aviso e desabilitar handlers de inventário (não derrubar processo).

---

## 13. Out of scope (próximos sprints)

- ❌ Professores / alunos / turmas (Fase 4 PRD)
- ❌ Vendas reais via WhatsApp (loja_vendas)
- ❌ Migração de inventário de planilha → LA Report (Rafinha vai popular orgânica via TOM)
- ❌ Auditoria dos dados de cada unidade (atividade subsequente)
- ❌ App externo de gerentes pra entrar com dados (versão futura)
- ❌ Reimplementar dashboards do LA Report no LA Organizer

---

## 14. Critérios de aceite

- [ ] Conexão cross-project funciona via `laReportClient` (smoke test: `listarUnidades()` retorna 3)
- [ ] Endpoints internal-api respondem com dados reais do LA Report
- [ ] PWA `/inventario` renderiza tabs/stats/cards conforme mockup 1
- [ ] PWA `/inventario/sala/:id` renderiza conforme mockup 2
- [ ] PWA `/inventario/loja` renderiza conforme mockup 3
- [ ] `/inv hendrix barra` retorna a sala correta (fuzzy lookup OK)
- [ ] Marker `<<INVENTORY_ACTION>>` parseado, insert chega no LA Report com `observacoes='via TOM por <nome>'`
- [ ] `/loja entrada 50 caderno violão barra` aumenta estoque corretamente
- [ ] Foto enviada no WhatsApp é salva em `inventario-fotos` e linkada ao item
- [ ] Cron seg 09h enfileira notificações em `la_organizer.notifications` para Rafinha
- [ ] Skill `pesquisa-preco.md` retorna 3 ofertas via WebSearch
- [ ] Manager não-Rafinha (futuro) vê só sua unidade
- [ ] PWA NÃO tem `LA_REPORT_SERVICE_ROLE_KEY` no bundle (verificar via grep do dist)
- [ ] TypeScript build limpo (`npx tsc --noEmit`) e `npx vite build` ok
- [ ] `node --check` em todos os arquivos `.js` modificados
- [ ] Validação visual no Simple Browser das 3 telas do PWA
- [ ] Zero componente nativo no PWA

---

## 15. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Service role do LA Report exposto | Rotacionar key após sprint; nunca embarcar no PWA |
| Schema do LA Report mudar (Hugo) | Detectar via JSON schema validation; quebrar graciosamente |
| Concorrência: TOM escreve + LA Report UI escreve | Last-write-wins aceitável nesta fase; sem locks |
| Volume de queries cross-project | Rate limit natural do Supabase é suficiente (3 unidades, 42 salas, ~10 produtos) |
| Fuzzy lookup de sala retorna múltiplas | TOM pergunta qual; só executa após confirmação |
| Foto grande no WhatsApp consome banda | Limite 5MB; resize antes do upload se > 2MB |
| Usuário escreve "comprei coisa" sem detalhes | LLM pede esclarecimento, não emite marker incompleto |

---

**Aprovação:** mockups visuais aprovados em sessão de brainstorm 2026-05-16. Auditoria do banco LA Report concluída. Decisões R1-R4 aprovadas pelo Owner. Aguardando validação deste spec antes de gerar plano de implementação via `superpowers:writing-plans`.

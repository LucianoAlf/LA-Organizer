# LA Journey — Spec de Design

**Data:** 2026-05-16
**Owner:** Luciano (CEO LA Music)
**Sponsor pedagógico:** Quintela
**Stack:** Supabase + React/TypeScript (PWA Vercel) + TOM (Node/PM2)
**Status:** Spec aprovado — pronto para `writing-plans`
**Referências:** `docs/PRD-LA-Journey-Modulo-LA-Organizer.md` · `docs/la-journey-template.html`

---

## 1. Goal

Implementar o módulo **LA Journey** dentro do LA Organizer — governança pedagógica da jornada do aluno. Mentores preenchem o template pedagógico de cada curso/checkpoint; coordenação revisa e publica; TOM lembra/cobra via WhatsApp.

**Não é MVP.** Escopo completo desde o dia 1: School (Foundation/Grow/Advance/Master) **e** Kids (Musicalização + Iniciação), todos editáveis. Sem "Em breve".

---

## 2. Estado atual (auditado em 2026-05-16)

Banco 100% pronto — **não precisa de migration**. Verificado via `execute_sql`:

| Item | Status |
|---|---|
| 9 tabelas `la_journey_*` criadas | ✓ |
| RLS habilitado nas 9 tabelas + 13 policies | ✓ |
| 2 programas seed (`school`, `kids`) | ✓ |
| 5 cursos seed (Bateria, Canto, Cordas, Teclas, Musicalização Geral) | ✓ |
| 12 checkpoints seed (4 School + 6 Musicalização + 2 Iniciação) | ✓ |
| 11 mentores atribuídos | ✓ (Peterson+Jordan/Bateria, Juliana+Dai/Canto, Kinho+Quintela+Rodrigo/Cordas, Leo+Kinho/Teclas, Quintela+Matheus/Musicalização Kids) |
| Realtime publication nas 4 tabelas operacionais | ✓ |
| Tabelas operacionais (conteudo/marcos/campos/historico/lembretes) | vazias — aguardando UI |

**Decisão de modelagem confirmada:** Musicalização Kids usa `curso_id='musicalizacao_geral'` (não NULL). Simplifica RLS e UI.

---

## 3. UX — Mobile-first (sem sidebar)

O HTML de referência (`docs/la-journey-template.html`) é desktop com sidebar fixa. O PWA é mobile-first. Adaptação aprovada via 4 mockups:

| Mockup | Tela | Aprovação |
|---|---|---|
| `01-lista-checkpoints.html` | `/la-journey` — Tabs + Select + 4 cards de checkpoint com % | ✓ |
| `02-edicao-checkpoint.html` | `/la-journey/:cpId` — Header + 2 textareas + marcos colapsáveis | ✓ |
| `03-dashboard-governanca.html` | `/la-journey/admin` — Stats + alert + matriz de cursos + pendências | ✓ |
| `04-tom-whatsapp.html` | TOM no WhatsApp — 5 cenários (cron, evento, query livre, comando, atraso) | ✓ |

Mockups persistidos em `.superpowers/brainstorm/9430-1778959107/content/` para referência durante implementação.

---

## 4. Design system — REGRA OBRIGATÓRIA

**ZERO componente nativo do navegador.** Toda a UI usa componentes já existentes em `_remote/web/src/components/`:

| Necessidade | Componente do DS |
|---|---|
| Header da página + back nav | `PageHeader` (prop `backTo`, `right`) |
| Tabs School/Kids, Musicalização/Iniciação | `Tabs` |
| Select de curso (NÃO usar `<select>`) | `CustomSelect` |
| Modal/sheet de remover marco | `BottomSheet` + `ConfirmDialog` |
| Cards de checkpoint, cards de curso | `Card` |
| Botões | `Button` |
| FAB "+ adicionar" | `Fab` |
| Loading | `LoadingState` |
| Vazio | `EmptyState` |
| Feedback de save | `Toast` (`showToast`) |
| Estatísticas no dashboard | `StatCard` |
| Badges de status (rascunho/em revisão/publicado) | `Badge` |
| Textareas | `Field` + `<textarea>` estilizado igual aos formulários existentes |
| Date inputs (se precisar) | `DateInput` (NUNCA `<input type="date">`) |
| Proteção de rota por papel | `ProtectedRoute requireRoles={[...]}` |

**Tokens Tailwind:** somente da paleta LA Organizer (`bg-bg-app`, `bg-bg-surface`, `text-fg`, `text-fg-muted`, `text-tom`, `border-border`, `bg-success`, `bg-warning`, `bg-danger`). Sem cores hardcoded — segue o padrão do `la-educa`.

**Botões pretos sobre `bg-tom`:** o padrão do app é `bg-tom text-black` (não `text-white`). Reforçar nesse módulo.

---

## 5. Rotas e gating

Em `_remote/web/src/App.tsx`, adicionar dentro do `<AppShell>`:

```tsx
{/* LA JOURNEY — RLS filtra o que mentor vê. Admin gated por role. */}
<Route path="la-journey" element={<LaJourneyListaPage />} />
<Route path="la-journey/:checkpointId" element={<LaJourneyCheckpointPage />} />
<Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
  <Route path="la-journey/admin" element={<LaJourneyAdminPage />} />
</Route>
```

**Acesso por papel:**
- `mentor` (collaborator + tag em `la_journey_curso_mentores`): vê só os cursos atribuídos. RLS garante.
- `coordinator` / `director`: vê e edita tudo + acessa `/la-journey/admin`.
- `manager`: **NÃO vê LA Journey** (não é pedagógico). Sem link no `/mais`. Mesmo se digitar a URL, RLS bloqueia leitura.

**Link no hub `/mais`:** adicionar ícone `🎵 LA Journey` na lista, oculto pra `manager`.

---

## 6. Modelo de dados (referência — já criado)

Detalhado no PRD seção 6. Resumo do shape que o frontend consome:

```
la_journey_programas (seed, 2 linhas)
  → la_journey_checkpoints (seed, 12 linhas)
       → la_journey_conteudo_checkpoint  (1 por programa+curso+checkpoint)
            → la_journey_marcos          (1..N filhos)
                 → la_journey_marco_campos (chave-valor)

la_journey_cursos (seed, 5 linhas)
  → la_journey_curso_mentores → collaborators

la_journey_historico (auditoria, trigger PG)
la_journey_lembretes_log (fila TOM)
```

**Chaves dos campos** (`la_journey_marco_campos.campo_chave`):

| Tipo de marco | Campos |
|---|---|
| `aprendizado` (Marcos 1-3 School/Heart) | `tema_foco`, `teoria_conceitos`, `tecnica`, `ritmo_percepcao`, `repertorio_aplicacao`, `evidencia_ancoragem`, `musica_desafio` |
| `consolidacao` (Marco 4 School/Heart) | `ancoragens_reforcadas`, `lapidacao_tecnica`, `repertorio_recital`, `formato_celebracao` |
| `ancoragem_radial` (Marcos 1-5 Musicalização Kids) | `conquista_musical`, `manifestacao_crianca`, `vivencias_atividades`, `recursos_pedagogicos` |

---

## 7. Data layer — `lib/lajourney.ts` + `lib/lajourney-types.ts`

Espelha o padrão de `lib/laeduca.ts`. Funções esperadas:

### Tipos
```ts
type Programa = 'school' | 'kids';
type TipoCheckpoint = 'checkpoint' | 'musicalizacao' | 'iniciacao';
type TipoMarco = 'aprendizado' | 'consolidacao' | 'ancoragem_radial';
type StatusConteudo = 'rascunho' | 'em_revisao' | 'publicado';

interface JourneyCheckpoint { id, programa_id, codigo, nome, equivalencia, foco, tipo, separa_por_curso, marcos_total, tem_consolidacao, sort_order }
interface JourneyCurso { id, nome, icone }
interface JourneyMentor { collaborator_id, full_name, papel: 'mentor_principal'|'mentor_apoio' }
interface JourneyConteudo { id, programa_id, curso_id, checkpoint_id, perfil_entrada, transformacao_esperada, status, publicado_em, publicado_por, updated_at, updated_by }
interface JourneyMarco { id, conteudo_id, numero, tipo, titulo, tema_foco, sort_order, updated_at }
interface JourneyMarcoCampo { id, marco_id, campo_chave, campo_valor, updated_at, updated_by }
```

### Funções

```ts
// Leitura (todas chaveadas em programa+curso+checkpoint)
fetchProgramas(): Promise<Programa[]>
fetchCheckpoints(programaId): Promise<JourneyCheckpoint[]>
fetchCursosVisiveis(programaId): Promise<JourneyCurso[]>      // filtra por mentor RLS automaticamente
fetchMentoresPorCurso(programaId, cursoId): Promise<JourneyMentor[]>
fetchConteudo(programaId, cursoId, checkpointId): Promise<{
  conteudo: JourneyConteudo | null;
  marcos: Array<JourneyMarco & { campos: Record<string, string> }>;
  progresso: { preenchidos: number; total: number; percentual: number };
}>
fetchListaProgresso(programaId): Promise<Array<{
  curso_id; curso_nome; curso_icone;
  mentor_principal_nome; mentores_apoio_nomes;
  checkpoints: Array<{ checkpoint_id; nome; status; percentual; updated_at; dias_sem_editar }>;
  total_percentual; ultima_edicao;
}>>
fetchPendenciasRevisao(): Promise<Array<{ programa_id; curso_id; checkpoint_id; nome; mentor_nome }>>

// Escrita (auto-save + ações)
upsertConteudoHeader(input: { programaId, cursoId, checkpointId, perfilEntrada?, transformacaoEsperada? }): Promise<string>  // retorna conteudo_id
adicionarMarco(input: { conteudoId, numero, tipo }): Promise<string>
removerMarco(marcoId): Promise<void>                                 // bloqueia se tipo='consolidacao'
upsertMarcoCampo(input: { marcoId, campoChave, campoValor }): Promise<void>
upsertMarcoHeader(input: { marcoId, titulo?, temaFoco? }): Promise<void>
reordenarMarcos(input: { conteudoId, ordemIds: string[] }): Promise<void>   // futuro — não no escopo inicial

// Workflow
submeterParaRevisao(conteudoId): Promise<void>     // status → em_revisao
publicarConteudo(conteudoId, publicadoPorCollab): Promise<void>     // status → publicado
reverterParaRascunho(conteudoId): Promise<void>    // só coord/director

// Mentores (admin)
adicionarMentor(input: { cursoId, programaId, collaboratorId, papel }): Promise<void>
removerMentor(input: { cursoId, programaId, collaboratorId }): Promise<void>
```

### Hooks (TanStack Query)
- `useLaJourneyCheckpoints(programaId)`
- `useLaJourneyCursos(programaId)`
- `useLaJourneyConteudo(programaId, cursoId, checkpointId)` — com `staleTime: 0` e realtime invalidation
- `useLaJourneyListaProgresso(programaId)`
- `useLaJourneyPendencias()`

---

## 8. Telas — comportamento detalhado

### 8.1 `LaJourneyListaPage` (`/la-journey`)

- `PageHeader title="LA Journey" backTo="/mais"` + prop `right` com botão `⚙ Admin` (só pra coord/director).
- `Tabs` programa: `[School][Kids]` — estado em `useState` ou query string.
- `CustomSelect` curso: aparece quando `programa==='school'` ou quando `programa==='kids' && fase.separa_por_curso=true`. Pra Musicalização Kids, mostra `Tabs` secundárias `[Musicalização][Iniciação]` no lugar do select.
- Lista de checkpoints como `Card` clicáveis:
  - Badge numerado (`<Badge>` ou span estilizado)
  - Nome do checkpoint + status (`<Badge variant="success|warning|default">`)
  - Equivalência (texto sutil)
  - Barra de progresso (componente local `ProgressBar` igual `_remote/web/src/screens/laeduca/components/ProgressBar.tsx`)
  - `%` + `X/Y campos`
  - Chevron `›`
- Vazio (`EmptyState`): "Você não está atribuído como mentor de nenhum curso ainda."
- Click no card → `navigate('/la-journey/:checkpointId?curso=' + cursoId)`.

### 8.2 `LaJourneyCheckpointPage` (`/la-journey/:checkpointId`)

URL: `/la-journey/school_foundation?curso=bateria`

- `PageHeader title={checkpoint.nome} subtitle={`${cursoIcone} ${cursoNome} · ${programa}`} backTo="/la-journey"`
- Right slot do header: badge `✓ salvo` (verde) que aparece 800ms após cada save bem-sucedido.
- Barra de status logo abaixo do header: `bg-bg-surface border` mostrando `Status: rascunho · 60% · 17/28 campos`.
- **Bloco "Perfil de entrada"**: `Field` + textarea controlada. Auto-save debounce 600ms via `useMemo(() => debounce(...))`. Pra musicalização Kids o label vira "Onde a criança chega".
- **Bloco "Transformação esperada"**: idem. Label "O que se desenvolve" pra Kids.
- **Banner Radial** (só pra `tipo='musicalizacao'`): `Card` com fundo azul claro: "◎ Ensino Radial. Sem marco de consolidação. A consolidação dos fundamentos acontece na Iniciação ao Instrumento."
- **Seção Marcos** com header `── Marcos do Checkpoint (N) ──` (ou "Marcos do Desenvolvimento Musical" pra musicalização).
- **Marco component** (novo, `screens/lajourney/components/MarcoCard.tsx`):
  - Header sempre visível: badge numerado, tipo (Aprendizado/Consolidação/Radial), título, contador `X/Y campos`, chevron de toggle.
  - Body expansível (state local `useState(false)`, primeiro marco abre por padrão):
    - Para `aprendizado`: input `Tema/foco` + grid 2x2 com 4 axis cards (Teoria, Técnica, Ritmo, Repertório) + textarea Evidência + input Música desafio.
    - Para `consolidacao`: banner dourado fixo + 4 textareas (reforçar, lapidar, recital, celebração).
    - Para `ancoragem_radial`: 4 textareas (conquista, manifestação, vivências, recursos).
  - Botão `🗑 Remover marco` no rodapé (BottomSheet de confirmação via `ConfirmDialog`). Oculto se `tipo='consolidacao'`.
- **Botão `+ Adicionar marco`** no fim da lista (estilo dashed, `Button variant="ghost"`). Abre `BottomSheet` perguntando o tipo (aprendizado/consolidação, ou só "novo marco radial" se for musicalização).
- **Botão de workflow** no rodapé sticky:
  - Mentor: `[Enviar pra revisão]` (verde, full-width). Disabled se algum campo obrigatório vazio. Tooltip explicando o que falta.
  - Coord/director vendo um `em_revisao`: `[Publicar]` (verde) + `[Devolver pra rascunho]` (outline).
  - Status `publicado`: barra de aviso "Publicado em DD/MM por X. Edição bloqueada." + coord pode clicar `Reverter pra revisão`.
- **Auto-save desabilitado** quando `status='publicado'` (textareas com `readOnly`).

### 8.3 `LaJourneyAdminPage` (`/la-journey/admin`)

- `PageHeader title="Governança" subtitle="LA Journey" backTo="/la-journey"`
- `Tabs` programa.
- 3 `StatCard` no topo: % preenchido global / # em revisão / # publicado.
- Banner de alerta (`Card border-warning`) listando cursos com `dias_sem_editar > 14`.
- Lista de `Card` por curso (componente `CursoStatusCard`):
  - Header: ícone + nome do curso + mentores
  - Grid 4 colunas (matriz de checkpoints) — cada célula colorida pelo status, com nome e %.
  - Rodapé: "Última edição: ontem" / "⚠ X dias sem editar" + link "Revisar [checkpoint] →"
- Seção "Pendências de revisão": lista das `fetchPendenciasRevisao()`.
- Cada pendência clica → abre o checkpoint com banner "Modo revisão" no topo.

---

## 9. Auto-save mechanics

**Debounce 600ms** por campo (igual `la-educa`):

```ts
const debouncedSave = useMemo(
  () => debounce(async (campoChave: string, valor: string) => {
    setSavingState('saving');
    try {
      await upsertMarcoCampo({ marcoId, campoChave, campoValor: valor });
      setSavingState('saved');
      setTimeout(() => setSavingState('idle'), 1500);
    } catch (e) {
      setSavingState('error');
      showToast({ kind: 'error', title: 'Falha ao salvar', msg: (e as Error).message });
    }
  }, 600),
  [marcoId]
);
```

**Optimistic update** no cache do React Query: o input usa estado local, só invalida a query quando salva.

**Invalidate o progresso** (`useLaJourneyConteudo`) só a cada N segundos pra evitar re-render exagerado (usa `setTimeout` controlado).

**Conflito de edição:** se 2 mentores editam o mesmo campo, last-write-wins. Realtime sub avisa o outro: "Outro mentor está editando este checkpoint."

---

## 10. Status transitions

```
rascunho ─[mentor: submeter]→ em_revisao
em_revisao ─[coord: publicar]→ publicado
em_revisao ─[coord: devolver]→ rascunho
publicado ─[coord: reverter]→ em_revisao
```

Toda transição:
1. UPDATE em `la_journey_conteudo_checkpoint` (status + publicado_em + publicado_por se aplicável).
2. Trigger PG `notify_la_journey_status_change` enfileira em `la_journey_lembretes_log` com tipo `transicao_status`.
3. TOM dispatcher (tick 5min) processa a fila e manda WhatsApp.

**Validação de submeter:** server-side checa que todos os campos obrigatórios estão preenchidos. RPC: `la_journey_can_submit(conteudo_id) RETURNS boolean`.

---

## 11. TOM — Integração WhatsApp

### 11.1 Skill `_remote/skills/la-journey.md`

Triggers (no system prompt, igual `la-educa.md`):
- "como tá o LA Journey", "como tá a journey", "status journey"
- "[nome do curso]" — "bateria", "canto", "cordas", "teclas", "musicalização"
- "atrasados journey", "pendências journey", "publicado journey"

Quando detecta, injeta no system prompt o snapshot `[LA_JOURNEY_STATUS]`:
```
[LA_JOURNEY_STATUS]
School: 42% preenchido
- Bateria (Peterson+Jordan): Foundation✅100% | Grow🟡75% | Advance⚪18% | Master⚪0%
- Canto (Juliana+Dai): Foundation🟡82% | ...
[...]
Pendências de revisão: Bateria Grow, Canto Foundation, Cordas Foundation
Atrasados >14d: Cordas (16d), Teclas (21d)
```

### 11.2 Cron `dispatcher.js`

```js
// Segunda 09:00 — lembrete semanal
if (dow === 1 && hour === 9 && !logExists('la_journey_lembrete_semanal')) {
  await runLaJourneyLembreteSemanal();
  logRitual('la_journey_lembrete_semanal');
}

// Segunda 09:00 — alerta de atraso (>14d)
if (dow === 1 && hour === 9 && !logExists('la_journey_alerta_atraso')) {
  await runLaJourneyAlertaAtraso();
  logRitual('la_journey_alerta_atraso');
}

// Tick 5min — processar fila la_journey_lembretes_log
await processarFilaLaJourney();
```

Funções no novo arquivo `_remote/src/rituals/la-journey-lembretes.js`:
- `runLaJourneyLembreteSemanal()`: query `fetchListaProgresso('school')` + `'kids'`, agrupa por mentor, enfileira 1 msg por mentor com lista de checkpoints pendentes.
- `runLaJourneyAlertaAtraso()`: query checkpoints com `updated_at < now()-'14 days'::interval AND status != 'publicado'`, agrupa por mentor + coord, enfileira.
- `processarFilaLaJourney()`: poll `la_journey_lembretes_log WHERE enviado_em IS NULL`, switch por `tipo` (`lembrete_semanal`, `alerta_atraso`, `transicao_status`, `kickoff`), monta msg, manda via UAZAPI, marca `enviado_em = now()`.

### 11.3 Comando rápido `/journey`

No `engine.js`, handler tipo o `/educa`:
- `/journey` → resumo geral (mesmo conteúdo do `[LA_JOURNEY_STATUS]`).
- `/journey [curso]` → drill-down do curso (Foundation/Grow/Advance/Master com status).
- Early return sem chamar LLM. Query direta.

### 11.4 Internal API

Em `_remote/src/internal-api.js` (já existe):
- `POST /internal/la-journey/notify-event` — body `{ conteudoId, tipo, destinatarios }`. Enfileira em `la_journey_lembretes_log`. Usado por edge functions que escutam triggers PG (se necessário) ou direto pela tela (admin "Pingar mentor manualmente").
- `GET /internal/la-journey/status` — snapshot JSON pra debug/admin.

Ambos com middleware `requireInternalSecret`.

---

## 12. Triggers PG (a criar)

Migration adicional (única migration deste módulo) — em `_remote/docs/superpowers/specs/migrations/2026-05-16-la-journey-triggers.sql`:

```sql
-- 1. Trigger de auditoria → historico
CREATE OR REPLACE FUNCTION la_journey_log_historico() RETURNS TRIGGER AS $$ ... $$;
CREATE TRIGGER trg_la_journey_conteudo_audit AFTER UPDATE ON la_journey_conteudo_checkpoint FOR EACH ROW EXECUTE FUNCTION la_journey_log_historico();
CREATE TRIGGER trg_la_journey_marcos_audit AFTER INSERT OR UPDATE OR DELETE ON la_journey_marcos FOR EACH ROW EXECUTE FUNCTION la_journey_log_historico();
CREATE TRIGGER trg_la_journey_campos_audit AFTER INSERT OR UPDATE ON la_journey_marco_campos FOR EACH ROW EXECUTE FUNCTION la_journey_log_historico();

-- 2. Trigger de notificação em mudança de status
CREATE OR REPLACE FUNCTION la_journey_notify_status_change() RETURNS TRIGGER AS $$ ... $$;
CREATE TRIGGER trg_la_journey_status_notify AFTER UPDATE OF status ON la_journey_conteudo_checkpoint FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION la_journey_notify_status_change();

-- 3. Trigger de kickoff (mentor recém-atribuído)
CREATE OR REPLACE FUNCTION la_journey_notify_kickoff() RETURNS TRIGGER AS $$ ... $$;
CREATE TRIGGER trg_la_journey_kickoff AFTER INSERT ON la_journey_curso_mentores FOR EACH ROW EXECUTE FUNCTION la_journey_notify_kickoff();

-- 4. RPC pra validação server-side antes de submeter
CREATE OR REPLACE FUNCTION la_journey_can_submit(p_conteudo_id uuid) RETURNS jsonb AS $$
  -- retorna { ok: bool, campos_faltando: text[], marcos_incompletos: int[] }
$$;
```

---

## 13. Out of scope (próximas iterações)

Apesar de "escopo completo", essas features não fazem parte deste spec:
- Drag-and-drop de reordenação de marcos (UI envia `sort_order`, mas sem DnD — usar setas ↑↓ se necessário).
- Exportação em PDF do checkpoint publicado.
- Histórico visualizável na UI (auditoria já é gravada, mas sem tela).
- Modo "comparar versões" de revisão (diff entre rascunho e publicado anterior).
- Migration legada pra importar dados do `localStorage` do HTML standalone (Quintela vai recadastrar do zero).

---

## 14. Critérios de aceite

- [ ] Rotas `/la-journey`, `/la-journey/:cpId`, `/la-journey/admin` funcionando.
- [ ] Link `🎵 LA Journey` no `/mais` (oculto pra `manager`).
- [ ] Mentor logado vê só seus cursos (RLS testada com 2 collaborators diferentes).
- [ ] Coord vê tudo + acessa `/la-journey/admin`.
- [ ] Edição de qualquer campo persiste após 600ms de inatividade. Badge `✓ salvo` aparece.
- [ ] Adicionar/remover marcos funciona. Marco de consolidação não removível.
- [ ] Tipo de marco respeita o tipo do checkpoint (aprendizado/consolidação pra School+Heart; ancoragem_radial pra Musicalização).
- [ ] Workflow rascunho→em_revisao→publicado funciona com transições corretas.
- [ ] Auto-save desabilitado em `publicado`.
- [ ] Dashboard mostra matriz de cursos × checkpoints com cores corretas.
- [ ] Dashboard alerta cursos parados >14d.
- [ ] Skill `la-journey.md` responde "como tá o LA Journey" com snapshot.
- [ ] Comando `/journey [curso]` retorna sem chamar LLM.
- [ ] Cron seg 09h envia lembrete semanal pra mentores com pendência.
- [ ] Cron seg 09h envia alerta de atraso quando aplicável.
- [ ] Trigger de status enfileira corretamente.
- [ ] Trigger de auditoria popula `la_journey_historico`.
- [ ] TypeScript build limpo (`npx tsc --noEmit`).
- [ ] Vite build sem erros (`npx vite build`).
- [ ] Nenhum `<select>`, `<input type="date">` ou componente nativo do navegador usado — só design system.
- [ ] Validado visualmente no Simple Browser via `mcp__Claude_Preview` antes de aprovar tarefa.

---

## 15. Arquitetura final (referência rápida)

```
PWA (Vercel)                     Supabase (cesnbnrynvxvgdhfmaua)            TOM (VPS PM2)
─────────────                    ──────────────────────────────             ────────────────
/la-journey            ──read──► la_journey_* (RLS)              ◄─poll──── dispatcher.js
/la-journey/:id        ──write─►   ↑ trigger PG ─────► fila ─────────────► processar fila → UAZAPI
/la-journey/admin      ──read──►   (auditoria)         lembretes_log
                                                                            skill la-journey.md ──► system prompt
                       ◄─realtime invalidation──                            engine.js handler /journey
```

---

**Aprovação:** mockups visuais aprovados em sessão de brainstorm 2026-05-16. Aguardando validação deste spec antes de gerar plano de implementação via `superpowers:writing-plans`.

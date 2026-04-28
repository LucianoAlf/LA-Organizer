# LA Organizer — PWA (`web/`)

Frontend mobile-first do TOM. **Espelho visual do banco** — não duplica regra de negócio (lógica fica no engine TOM/backend; PWA só lê e dispara mutations simples). Per `docs/06-prd-la-organizer-v3.md` §5.2.

---

## Estado atual

- **Sprint 0** — Fundação técnica + 6 telas P0 + auth ✅
- **Sprint 1** — Configurações, Histórico, criar tarefa rápida, reagendar, privacy hardening ✅
- **Sprint 2** — Magic link via WhatsApp (canônico), URL pública via Cloudflare tunnel, fallback email/password, piloto multiusuário real ✅
- **Sprint 3** — Modelo `events` separado de `tasks` + criação unificada (Tarefa | Compromisso) + categorias + RLS hardening crítico ✅
- **Sprint 4** — Auditoria + hardening RLS multiusuário (5 leaks fechados, 16 invariantes verdes em `scripts/rls-test.js`), `docs/RLS-MATRIX.md` congelada. TOM aprende a criar compromissos via marker `<<EVENT_CREATE>>` (skill `criar-compromisso`); briefings exibem **Compromissos hoje** com horário/modalidade ✅
- **Sprint 5** — Maturidade do modelo events: `EditEventSheet` no PWA (tap em event → editar título, horário, local, link, status), TOM aprende `<<EVENT_UPDATE>>` (reschedule/cancel/complete) via skill estendida, convivência task↔event mínima (skill pergunta antes de duplicar), webhook ganha middleware HMAC com 3 modos (disabled/permissive/strict). Hardening operacional final (rotação Supabase + URL estável) **diferido** para janela pré-prod ✅ (parcial)
- **Sprint 6** — Coordenação enxerga events do time + Pessoa-Detalhe. `DashboardTime` ganha bloco "Compromissos hoje" agregado e contagem de events nos badges; `/time/:id` (PessoaDetalhe, guard coord/director) mostra header com PII básica mascarada, 3 KPIs (Tarefas abertas / Compromissos hoje / Rituais enviados 7d), tasks pendentes work read-only, events próximos 7d, faixa visual de rituais 7d. Helpers de events centralizados em `src/lib/events.ts` (`fetchEventsForTeamDay`, `fetchEventsForCollabRange`). Harness ganha 3 invariantes ritual_logs (19/19 verdes) ✅

---

## Stack

| Camada | Escolha |
|---|---|
| Framework | React 18 + TypeScript (strict) |
| Build | Vite 5 (SWC) |
| PWA | `vite-plugin-pwa` + workbox (autoUpdate, runtime cache para Google Fonts) |
| Estilo | Tailwind CSS + tokens em CSS vars (rgb-channel, suporta alpha modifiers) |
| Estado | TanStack Query (server) + React Context (auth/theme) |
| Backend | Supabase (PostgREST + Auth + RLS) |
| Ícones | `lucide-react` |
| Tipografia | Prompt via Google Fonts (300/400/500/600/700/900) |

---

## Setup local

```bash
cd web
cp .env.example .env       # preencha VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (anon, NÃO service_role)
npm install
npm run dev                # http://localhost:5173
```

Gerar os PNGs do ícone (uma vez):

```bash
npm i -D sharp
node scripts/generate-icons.mjs
```

Build de produção:

```bash
npm run build              # gera dist/ (estático)
npm run preview            # serve dist/ em :4173 (host:true → acessível na rede)
```

Para visualização em frame de celular durante dev: abrir `http://localhost:5173/dev-frame.html`. Suporta iPhone 14 Pro / SE / Pro Max, Pixel 7, Galaxy S20, iPad mini.

---

## Estrutura

```
web/
├── public/                 # favicon, ícones PWA, logos LA Music (8 variantes), Avata-Tom.png
├── scripts/                # generate-icons.mjs
├── src/
│   ├── components/         # AppShell, Header, BottomNav, Button, Card, TaskRow,
│   │                       # ProjectCard, StatCard, Badge, Tabs, EmptyState,
│   │                       # LoadingState, ProtectedRoute, LogoMark, Fab,
│   │                       # BottomSheet, QuickTaskSheet, RescheduleSheet
│   ├── contexts/           # AuthContext, ThemeContext
│   ├── lib/                # supabase, queryClient
│   ├── screens/            # Login, Hoje, Semana, Projetos, ProjetoDetalhe,
│   │                       # DashboardTime, Configuracoes, Historico, Mais
│   ├── utils/              # date helpers (todaySP, dowShort, brShort, workWeekDays)
│   ├── App.tsx             # routes + role gating
│   ├── main.tsx
│   ├── index.css           # tokens em CSS vars + utility .surface
│   └── types.ts
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## Rotas

| Rota | Tela | Sprint | Acesso |
|---|---|---|---|
| `/login` | Login | 0 | público |
| `/hoje` | Hoje | 0 | autenticado |
| `/semana` | Semana | 0 | autenticado |
| `/projetos` | Projetos (lista) | 0 | autenticado |
| `/projetos/:id` | Projeto detalhe | 0 | autenticado |
| `/time` | Dashboard do time | 0 | coord+ |
| `/mais` | Menu Mais | 0 | autenticado |
| `/configuracoes` | Configurações | 1 | autenticado (próprio) |
| `/historico` | Histórico (30 dias) | 1 | autenticado (próprio) |

Tudo o que não bate cai em `/hoje` (catch-all). Rotas privadas usam `ProtectedRoute` com variant `requireRoles`.

---

## Tema dark/light

- **Dark é padrão** (PRD §5.2). Light é suportado.
- `ThemeContext` persiste em `localStorage` (`la-theme`), sincroniza `document.documentElement.dataset.theme` e o `<meta name="theme-color">` (status bar iOS).
- Tokens vivem em `src/index.css` como CSS vars rgb-channel:
  - `--bg-app`, `--bg-surface`, `--bg-elevated`, `--bg-subtle`
  - `--fg-primary`, `--fg-secondary`, `--fg-muted`
  - `--border`
- Tailwind expõe via aliases (`bg-bg-surface`, `text-fg-muted`, `border-border` etc).
- Light mode tem soft shadow nos cards via `.surface` utility (`@layer components` em `index.css`); dark mode usa contraste de cor (zero shadow).
- Tokens de marca (`brand`, `brand-shade`, `brand-deep`, `brand-light`, `brand-dark`) e semânticos (`success`, `warning`, `danger`, `info`, `project`) são fixos em ambos os temas.

Regras detalhadas: `docs/LA-Organizer-UI-SYSTEM.md` §5–§7.

---

## Autenticação

**Atual: Email/Password** (`supabase.auth.signInWithPassword`).

Fluxo:
1. User entra com email/senha em `/login`
2. Supabase Auth retorna `session.user.email`
3. `AuthContext` faz `SELECT` em `collaborators` filtrando por email
4. Role/perfil populados no contexto, disponíveis via `useAuth()`
5. `ProtectedRoute` checa session + opcionalmente `requireRoles`

**Pendente: Magic Link via WhatsApp** (canônico per PRD §5.2). Sprint 2 endereça.

---

## Telas e fluxos entregues

### Sprint 0

- **Login** — hero brand-strong (halftone soft + watermark "LA" outline + h1 "Bom dia de produção" com pink em "Bom") + logo oficial `logo-la-music-dark-completa.svg` + form
- **Hoje** — 3 stat cards responsivos (mobile 28px, desktop 40px), tabs work/personal, TaskRow com toggle complete via mutation
- **Semana** — container único denso: today expandido com bg pink/5 + barra accent; outros dias compactos single-line; header com ratio "X/Y DA SEMANA" + barra de progresso pink
- **Projetos** — lista com role gating (criador/membro vs coord/dir vê todos); ProjectCard com progress bar + categoria badge
- **Projeto detalhe** — header com progresso + 4 tabs (Resumo / Checkpoints / Tarefas / Time)
- **Dashboard do time** (`/time`, coord+ only) — stat cards + listas respondeu/sem-resposta + atrasos por pessoa. Privacy contract enforçado.
- **Mais** (`/mais`) — entry point para itens P1+, toggle tema, sair

### Sprint 6

- **DashboardTime** (`src/screens/DashboardTime.tsx`) ganha bloco "Compromissos hoje" agregado: total + lista compacta dos próximos 5 (horário · primeiro nome do colab · título), ordem por `start_at`. Contagem de events do dia aparece nos badges existentes (`Anne · 2📅`). Badges agora são `<Link to={/time/:id}>`.
- **Helpers centralizados** em `src/lib/events.ts`:
  - `fetchEventsForTeamDay(ymd, ctx='work')` — RLS é a única autoridade (coord/director recebe `work` do time, collab comum só os próprios). Sem filtro por collaborator no call-site.
  - `fetchEventsForCollabRange(collabId, start, end, ctx='work')` — events de um colaborador num período. Usado pela PessoaDetalhe.
- **Rota** `/time/:id` em `src/App.tsx`, dentro do guard `<ProtectedRoute requireRoles={['coordinator','director']}>`. Collab comum acessando por URL é redirecionado.
- **PessoaDetalhe** (`src/screens/PessoaDetalhe.tsx`):
  - Header: avatar/inicial, nome, role, function_title, telefone mascarado (`••••XXXX`).
  - 3 StatCards: **Tarefas abertas** (`tasks` work pending), **Compromissos hoje** (events work do dia), **Rituais enviados (7d)** (count `ritual_logs.status='sent'`). Subtítulo do KPI ritual deixa explícito que é métrica de envio do TOM, não aderência real do colaborador.
  - Bloco "Tarefas em aberto · trabalho" — `TaskRow` com prop nova `readOnly` que esconde checkbox.
  - Bloco "Próximos 7 dias · compromissos" — `EventRow` sem `onClick` (já era read-only por design).
  - Bloco "Rituais enviados · últimos 7 dias" — grid de 7 dots: verde quando há ritual `sent`, fim de semana neutro, dia útil sem envio em warning.
- **PRIVACY** — query do PessoaDetalhe seleciona apenas `reference_date, ritual_type, status` de `ritual_logs`; `detail` (potencial PII de resposta) nunca chega ao cliente, apesar de `auth_read_ritual_logs_coord` permitir.
- **Harness `scripts/rls-test.js`** ganha 3 invariantes ritual_logs (Sprint 6): `alice lê próprios`, `alice NÃO lê de bob`, `coord lê do time`. 19/19 verdes pós-deploy.

### Sprint 5

- **EditEventSheet** (`src/components/EditEventSheet.tsx`) — bottom sheet acionado por tap em `EventRow` (em `/hoje` e `/semana`). Edita `title`, `start_at`, `end_at`, `location_text`, `meeting_url`. Botões "Concluir" (status=done) e "Cancelar evento" (status=cancelled). RLS `auth_update_own_events` cobre.
- **TOM aprende `<<EVENT_UPDATE>>`** — parser + Guard 3 + applier em `src/engine.js`; skill `skills/criar-compromisso.md` ensina actions `reschedule`, `cancel`, `complete`. `pickSkill` priority 4.9 detecta verbos de update sobre termos de evento. Smoke E2E real validou os 3 caminhos.
- **Convivência task↔event** — skill orientada a perguntar UMA vez antes de criar event quando há task pendente com título muito similar. Sem refactor de engine.
- **Middleware HMAC do webhook** (`src/webhook.js`) — 3 modos via env: `disabled` (default; sem `WEBHOOK_SECRET`), `permissive` (loga warning, processa) e `strict` (rejeita 401). `index.js` captura raw body via `verify` callback. 8 cenários validados em isolamento + smoke real permissive.
- **Diferido para pré-prod**: rotação real de `SUPABASE_SERVICE_ROLE_KEY`, URL estável (Cloudflare nomeado/Vercel), ativação de `WEBHOOK_HMAC_ENFORCE=true`. Em dev seguimos com Cloudflare quick tunnel + key Sprint 4.

### Sprint 4

- **Auditoria RLS completa** — 30 tabelas / 41 policies mapeadas. `docs/RLS-MATRIX.md` é o contrato vigente, congelado, com matriz de SELECT/INSERT/UPDATE/DELETE por papel.
- **Harness automatizado** — `scripts/rls-test.js` cria 4 test users (alice, bob, coord, dir) + 8 fixtures e valida 16 invariantes de privacidade (collab×collab, coord×personal, tabelas TOM-only, regressão Sprint 3). Rodar: `ssh tom 'cd /opt/LA-Organizer && SUPABASE_ANON_KEY=... node scripts/rls-test.js'`. Cleanup integral mesmo se falha.
- **5 leaks fechados** (migration `sprint4_rls_hardening_leaks`):
  - `collaborators` — `qual=true` vazava PII de todos → restrito a self por email OR coord/director.
  - `project_checkpoints` — vazava todos → filtra por projetos visíveis.
  - `project_members` — vazava grafo → self OR projetos visíveis OR coord/director.
  - `marker_logs` — RLS desligado → habilitado, service_role-only.
  - `task_reminders` — RLS desligado → habilitado, service_role-only.
- **2 gaps funcionais cobertos** — `auth_read_own_ritual_logs` (PWA Histórico precisa) + `auth_insert_own_prefs` (self-onboarding futuro).
- **TOM cria compromissos** — nova skill `criar-compromisso` ativada por padrões em `pickSkill` priority 4.9 (termo de evento+horário, range "das X às Y", verbo agendar+horário+modalidade). Engine valida schema (`title`, ISO -03:00 com end>start, `modality` enum, `category` enum, `meeting_url` só online/hibrido) e insere com `source='tom'`.
- **Briefings reconhecem events** — `fetchCollaboratorContext` adiciona `todayEvents`. `buildContext` renderiza bloco "Compromissos hoje" entre Tarefas e Projetos, ordenado por horário, com filtro por ritual (briefing_pessoal só personal; trabalho/fechamento só work).

### Sprint 3

- **Modelo `events` separado** — compromissos/eventos com `start_at`, `end_at`, `modality`, `location_text`, `meeting_url`, `category`. Não é "task com hora"; é entidade própria. Decisão arquitetural detalhada em `docs/MODELO-EVENTS-VS-TASKS.md`.
- **`tasks.category`** opcional adicionada (mesmo enum de events, informacional, NÃO impacta RLS).
- **Criação unificada** — `QuickCreateSheet` substitui `QuickTaskSheet`. Seletor inicial Tarefa | Compromisso, forms divergentes (tarefa: title+context+due_date; compromisso: title+category+start/end+modality+location/meeting_url).
- **`/hoje` feed unificado** — bloco "Compromissos" com horário (HH:MM–HH:MM, modality icon, link "entrar" se online) sobre "Tarefas".
- **`/semana`** — eventos com horário em destaque (pink) + tasks como bullets.
- **`/historico`** — KPIs separados Tarefas (X/Y, %) + Compromissos (count) + Dias ativos.
- **Categorias enum fechado**: `la_music`, `mentoria`, `aula_particular`, `outra_escola`, `estudio`, `pessoal`. Visual: badges semânticos reutilizando paleta existente.
- **🚨 Fix RLS crítico (regressão Sprints 0-2):** policies "Service role full access" estavam `TO public USING (true)`, vazando todas as linhas para qualquer authenticated. Re-escopo `TO service_role` aplicado em todas as tabelas. Service_role bypassa RLS via privilege próprio.

### Sprint 1

- **Configurações** (`/configuracoes`) — edição de `user_preferences` em 3 sections:
  - Horários: `briefing_time`, `personal_briefing_time`, `closing_time`, `planning_day`
  - Intensidade: radio cards `light` / `normal` / `hard` (`coaching_intensity`)
  - Notificações: toggles `notify_deadline_alerts`, `notify_overdue_alerts`
- **Histórico** (`/historico`) — 30 dias de aderência:
  - 3 KPIs (Concluídas / Total / Aderência%)
  - Lista de dias com dot semântico (idle/briefed/low/mid/good) + ratio + %
  - Filtra fim-de-semana sem atividade pra remover ruído
- **Criar tarefa rápida** — `Fab` em `/hoje` e `/semana` abre `QuickTaskSheet` com 3 campos: title (obrigatório), context (work|personal), due_date (default: hoje). INSERT direto em `tasks`; React Query invalidate atualiza lista.
- **Reagendar tarefa** — tap em tarefa pendente em `/semana` abre `RescheduleSheet` com date picker. Detecta "mesma data" e desabilita submit. Flips `status='overdue' → 'pending'` ao reagendar.
- **Privacy hardening** — coord/dir não lê mais `conversation_history.content`; `briefing_response_count(collab_id, since)` (SECURITY DEFINER) é a única via para detecção de resposta a briefing.

---

## Privacy contract enforçado

Por design, no PWA:

| Tabela | Quem lê |
|---|---|
| `tasks WHERE context='personal'` | Apenas o próprio (RLS) |
| `tasks WHERE context='work'` | Próprio + coord/director |
| `events WHERE context='personal'` | Apenas o próprio (RLS) |
| `events WHERE context='work'` | Próprio + coord/director |
| `events.category` | Informacional, NÃO entra em RLS |
| `collaborator_memory` | Apenas service_role (PWA nunca lê) |
| `habits`, `habit_logs` | Apenas service_role (PWA nunca lê) |
| `conversation_history` | Service_role; coord/director só via `briefing_response_count(...)` (count, nunca content) |
| `user_preferences` | Apenas o próprio (SELECT + UPDATE) |
| `ritual_logs` | Coord/director (read-only via RLS) |

---

## Decisões temporárias ainda abertas

| Item | Razão | Quando revisar |
|---|---|---|
| Auth via email/password (não magic link WhatsApp) | Velocidade Sprint 0; magic link exige Edge Function + UAZAPI integration + UX OTP | Sprint 2 |
| `eisenhower_quadrant` fica `null` em criações via PWA | Engine recalcula no próximo briefing/closing cycle; trigger novo seria over-engineering | Quando aparecer queixa real de prioridade ruim em Sprint 1+ tasks |
| `source='manual'` em criações via PWA | CHECK constraint não aceita `'pwa'`; `'manual'` é semanticamente correto (criação humana direta) | Permanente |
| `collaborators.email` placeholders `<nome>.<sobrenome>@lamusic.local` para Anne/Juliana/Quintela | Auth real só para Alf hoje | Substituir quando outros usuários forem cadastrados no Supabase Auth |
| ~~Hosting de produção~~ | **Resolvido na Sprint 6 (28/04/2026):** deploy em Vercel — `https://la-organizer.vercel.app`. CI a partir de `main`. | — |
| `Avata-Tom.png` (645KB) catalogado mas não carregado | Nenhuma tela atual justifica os bytes em main path | Quando vier onboarding visual / empty state de histórico / 404 |

---

## Comandos úteis

```bash
# dev
npm run dev                # localhost:5173 com HMR

# preview de build production
npm run build && npm run preview

# debugar build size
npm run build && du -h dist/assets/*

# fixture de visualização em telefone CSS
# http://localhost:5173/dev-frame.html
```

---

## Deploy (Vercel — produção)

**URL oficial:** [`https://la-organizer.vercel.app`](https://la-organizer.vercel.app)

- **Hosting:** Vercel, plano free.
- **Branch de deploy:** `main` (push → build automático → produção).
- **Build:** `npm run build` em `web/`, output `dist/`. `vite-plugin-pwa` em `generateSW` mode produz service worker + manifest no precache.
- **Domínio assignado:** `la-organizer.vercel.app`. Domínio próprio fica para quando houver demanda; Vercel deixa adicionar a qualquer momento sem recriar projeto.
- **Supabase Auth — Site URL e Redirect URLs:** atualizadas para `https://la-organizer.vercel.app`. Magic link via WhatsApp e fallback email/password redirecionam para a URL definitiva.
- **`vite.config.ts preview.allowedHosts`:** `['.vercel.app', 'localhost']`. Tunnel Cloudflare das Sprints 2–6 (`*.trycloudflare.com`) foi descontinuado.

### Histórico de hosting

| Período | Solução | Status |
|---|---|---|
| Sprints 0–1 | `vite preview` local + IDE preview | dev only |
| Sprints 2–5 | Cloudflare quick tunnel (`*.trycloudflare.com`) | provisório, URL volátil |
| Sprint 6 hot-fix em diante | **Vercel — `la-organizer.vercel.app`** | oficial, estável, HTTPS |

---

## Documentos de referência

- `docs/06-prd-la-organizer-v3.md` — PRD do produto
- `docs/05-mapa-telas-pwa-v3.md` — mapa de telas com priorização P0/P1/Fase 2+
- `docs/LA-Organizer-UI-SYSTEM.md` — design system oficial
- `docs/TOM-AGENTS.md` — regras operacionais do TOM (privacidade, role gating)
- `docs/secrets-audit.md` — audit + estado da rotação (deferred)

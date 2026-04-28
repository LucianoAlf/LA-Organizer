# LA Organizer — PWA (`web/`)

Frontend mobile-first do TOM. **Espelho visual do banco** — não duplica regra de negócio (lógica fica no engine TOM/backend; PWA só lê e dispara mutations simples). Per `docs/06-prd-la-organizer-v3.md` §5.2.

---

## Estado atual

- **Sprint 0** — Fundação técnica + 6 telas P0 + auth ✅
- **Sprint 1** — Configurações, Histórico, criar tarefa rápida, reagendar, privacy hardening ✅
- **Sprint 2** — Magic link via WhatsApp (canônico), URL pública via Cloudflare tunnel, fallback email/password, piloto multiusuário real ✅
- **Sprint 3** — Modelo `events` separado de `tasks` + criação unificada (Tarefa | Compromisso) + categorias + RLS hardening crítico ✅
- Próximo: Sprint 4 (a planejar)

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
| Hosting de produção | Build estático em `dist/` pronto; aguarda decisão Vercel/Netlify/nginx | Sprint 2 |
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

## Deploy (a definir em Sprint 2)

Build estático em `dist/`. Candidatos:

- **Vercel** / Netlify / Cloudflare Pages — CDN + previews + integração GH (recomendado para PWA)
- Supabase Storage + Edge Functions — concentra na stack já em uso
- Nginx no próprio VPS — mesmo host do TOM backend; sem CDN global

Service worker + manifest são gerados automaticamente pelo `vite-plugin-pwa` (`generateSW` mode, precache 9 arquivos / ~497 KB).

---

## Documentos de referência

- `docs/06-prd-la-organizer-v3.md` — PRD do produto
- `docs/05-mapa-telas-pwa-v3.md` — mapa de telas com priorização P0/P1/Fase 2+
- `docs/LA-Organizer-UI-SYSTEM.md` — design system oficial
- `docs/TOM-AGENTS.md` — regras operacionais do TOM (privacidade, role gating)
- `docs/secrets-audit.md` — audit + estado da rotação (deferred)

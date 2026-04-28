# LA Organizer — PWA (web/)

Frontend mobile-first do TOM. Espelho visual do banco — não duplica regra de negócio (PRD §5.2).

## Stack

| Camada | Escolha |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite (SWC) |
| PWA | `vite-plugin-pwa` (workbox) |
| Estilo | Tailwind CSS + tokens em CSS vars |
| Estado | TanStack Query |
| Backend | Supabase (PostgREST + Auth) |
| Ícones | `lucide-react` |
| Tipografia | Prompt via Google Fonts |

## Setup

```bash
cd web
cp .env.example .env       # preencha com a chave anon do Supabase
npm install
npm run dev                # http://localhost:5173
```

Para gerar os PNGs do ícone (uma vez):

```bash
npm i -D sharp
node scripts/generate-icons.mjs
```

Build de produção:

```bash
npm run build              # gera dist/
npm run preview            # serve dist/ em :4173
```

## Estrutura

```
web/
├── public/                 # favicon.svg, icons, manifest gerado pelo plugin
├── scripts/                # generate-icons.mjs
├── src/
│   ├── components/         # AppShell, Header, BottomNav, Button, Card, TaskRow,
│   │                       # ProjectCard, StatCard, Badge, Tabs, EmptyState,
│   │                       # LoadingState, ProtectedRoute, LogoMark
│   ├── contexts/           # AuthContext, ThemeContext
│   ├── lib/                # supabase, queryClient
│   ├── screens/            # Login, Hoje, Semana, Projetos, ProjetoDetalhe,
│   │                       # DashboardTime, Mais
│   ├── utils/              # date helpers
│   ├── App.tsx             # routes + role gating
│   ├── main.tsx
│   ├── index.css           # tokens + Tailwind base
│   └── types.ts
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

## Tokens (LA-Organizer-UI-SYSTEM)

Tokens vivem em `src/index.css` (CSS vars dark/light) e são expostos via `tailwind.config.js`:

- `bg-bg-app`, `bg-bg-surface`, `bg-bg-elevated`, `bg-bg-subtle`
- `text-fg`, `text-fg-secondary`, `text-fg-muted`
- `border-border`
- `bg-brand`, `bg-brand-shade`, `bg-brand-deep`, `bg-brand-light`
- semânticos: `success`, `warning`, `danger`, `info`, `project`
- escala tipográfica: `text-screen-title`, `text-section-title`, `text-card-title`, `text-body-lg/md/sm`, `text-label`, `text-hero`, `text-h1-brand`, `text-h2-brand`

Veja regras de uso (quando usar pink, halftone, watermark, sombra offset) em `docs/LA-Organizer-UI-SYSTEM.md` §5–§6.

## Auth (Sprint 0)

Email/senha via `supabase.auth.signInWithPassword`. A `AuthContext` resolve `collaborators` por email para popular role/perfil. Magic link via WhatsApp (especificado em PRD §5.3) fica para Sprint 1+.

## Telas P0 entregues

- `/login` — hero brand + form
- `/hoje` — tarefas do dia (work/personal tabs)
- `/semana` — 5 colunas seg–sex
- `/projetos` — lista (gating: lider/membro vs coord/dir vê tudo)
- `/projetos/:id` — detalhe com Tabs (Resumo / Checkpoints / Tarefas / Time)
- `/time` — dashboard coord/dir (briefing response, atrasos, contagens)
- `/mais` — entry point para itens P1+

## Fora de escopo Sprint 0

Hábitos, Checklists operacionais, Aderência geral, Pessoa detalhe, Dashboard executivo, Broadcast no PWA, Agenda Emusys, Histórico — todos catalogados com prioridade no `docs/05-mapa-telas-pwa-v3.md`.

## Deploy

Build estático em `dist/`. Pode ser servido por:

- Vercel / Netlify / Cloudflare Pages (recomendado para CDN + previews)
- Supabase Storage + CDN
- Nginx no próprio VPS (mesmo host do TOM backend)

Service worker + manifest gerados automaticamente pelo `vite-plugin-pwa`.

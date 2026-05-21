# Foundation Mockups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Definir a linguagem visual desktop do LA Organizer através de 6 mockups HTML estáticos aprovados visualmente em `localhost:55825`, antes de qualquer código de produção.

**Architecture:** Mockups são arquivos HTML standalone com Tailwind CDN, servidos por `http-server` na porta 55825. Cada mockup foca um aspecto específico da Foundation (shell, tokens, primitives, views, drawer, estados). Após aprovação visual de TODOS os 6 mockups, um plano separado de implementação React será criado.

**Tech Stack:** HTML5 + Tailwind 3.4 (via CDN), Lucide icons (via CDN), zero JavaScript de domínio — só interações visuais simples.

**Spec base:** [docs/superpowers/specs/2026-05-21-desktop-redesign-master-design.md](../specs/2026-05-21-desktop-redesign-master-design.md)

---

## File Structure

```
_remote/docs/mockups/                 # NEW — pasta de mockups (gitignored opcional)
├── index.html                    # menu navegação entre mockups
├── 00-shell-projetos.html        # Shell + página Projetos completa
├── 01-tokens.html                # Styleguide de tokens
├── 02-page-shell.html            # PageShell + Toolbar + FilterPill isolados
├── 03-views.html                 # DenseTable + Kanban + Calendar + Timeline + PersonGrid
├── 04-detail-drawer.html         # DetailDrawer right-side
├── 05-empty-loading.html         # Empty states + Loading skeletons
└── assets/
    └── tom-tokens.css            # tokens compartilhados entre mockups (single source of truth)
```

`index.html` é um menu que linka pros outros 6 — facilita navegação no Simple Browser.

`assets/tom-tokens.css` carrega os tokens (cores, fonts, spacing) usados por todos os mockups. Quando você ajusta um token, vale pra todos.

---

## Task 1: Setup do servidor de mockups

**Files:**
- Create: `_remote/docs/mockups/index.html`
- Create: `_remote/docs/mockups/assets/tom-tokens.css`

- [ ] **Step 1: Criar pasta `.mockups` e subpasta `assets`**

```bash
mkdir -p "D:/la-organizer/_remote/docs/mockups/assets"
```

- [ ] **Step 2: Criar `assets/tom-tokens.css` com tokens base**

```css
/* tom-tokens.css — design tokens compartilhados pelos mockups da Foundation */
:root {
  /* Cores — base do LA Organizer (Tom green) */
  --tom: #a8e643;
  --tom-hover: #b8f053;
  --tom-active: #98d633;

  /* Surfaces — 4 níveis de hierarquia (vs 2 do mobile) */
  --bg-app: #0a0a0a;          /* fundo da página */
  --bg-surface: #141414;       /* cards, sidebar */
  --bg-elevated: #1c1c1c;      /* hover, modais */
  --bg-elevated-2: #242424;    /* nested cards */

  /* Bordas */
  --border: #2a2a2a;
  --border-strong: #383838;

  /* Foreground */
  --fg: #f5f5f5;
  --fg-secondary: #c0c0c0;
  --fg-muted: #8a8a8a;
  --fg-disabled: #555;

  /* Status */
  --success: #4ade80;
  --warning: #fbbf24;
  --danger: #f87171;
  --info: #60a5fa;

  /* Tipografia desktop — escala mais densa */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --fs-11: 11px;
  --fs-12: 12px;
  --fs-13: 13px;
  --fs-14: 14px;
  --fs-16: 16px;
  --fs-20: 20px;
  --fs-24: 24px;

  /* Spacing granular */
  --sp-xs: 4px;
  --sp-sm: 6px;
  --sp-md: 8px;
  --sp-lg: 12px;
  --sp-xl: 16px;
  --sp-2xl: 24px;
  --sp-3xl: 32px;

  /* Densidades alvo */
  --row-height: 40px;
  --card-padding: 14px;
  --sidebar-width: 240px;
  --sidebar-collapsed: 64px;
  --topbar-height: 52px;          /* menor que mobile (56) */
  --drawer-width: 450px;

  /* Sombras (sutis pra dark mode) */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg: 0 12px 32px rgba(0,0,0,0.6);

  /* Radius */
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 8px;
  --r-xl: 12px;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  line-height: 1.4;
  background: var(--bg-app);
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}

/* Scrollbar fina global (consistente com produção) */
* { scrollbar-width: thin; scrollbar-color: rgba(158,158,158,0.3) transparent; }
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: rgba(158,158,158,0.3); border-radius: 4px; }
*::-webkit-scrollbar-thumb:hover { background: rgba(158,158,158,0.5); }
```

- [ ] **Step 3: Criar `index.html` (menu de navegação dos mockups)**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>LA Organizer Desktop · Mockups Foundation</title>
  <link rel="stylesheet" href="assets/tom-tokens.css" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen p-12">
  <div class="max-w-2xl mx-auto">
    <h1 class="text-2xl font-bold mb-1">LA Organizer Desktop · Foundation</h1>
    <p class="text-[13px] text-[color:var(--fg-muted)] mb-8">
      Mockups visuais antes da implementação. Cada arquivo é standalone.
    </p>
    <div class="space-y-2">
      <a href="00-shell-projetos.html" class="block p-4 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border)] hover:border-[color:var(--tom)] transition-colors">
        <div class="text-base font-semibold">00 · Shell + Projetos (página completa)</div>
        <div class="text-[12px] text-[color:var(--fg-muted)]">Sidebar v2 · Topbar v2 · Toolbar · ViewSwitcher · KanbanBoard denso</div>
      </a>
      <a href="01-tokens.html" class="block p-4 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border)] hover:border-[color:var(--tom)] transition-colors">
        <div class="text-base font-semibold">01 · Tokens (styleguide)</div>
        <div class="text-[12px] text-[color:var(--fg-muted)]">Tipografia · Paleta · Espaçamentos · Sombras</div>
      </a>
      <a href="02-page-shell.html" class="block p-4 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border)] hover:border-[color:var(--tom)] transition-colors">
        <div class="text-base font-semibold">02 · Page primitives</div>
        <div class="text-[12px] text-[color:var(--fg-muted)]">PageShell · PageHeaderDesktop · Toolbar · FilterPill isolados</div>
      </a>
      <a href="03-views.html" class="block p-4 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border)] hover:border-[color:var(--tom)] transition-colors">
        <div class="text-base font-semibold">03 · View patterns</div>
        <div class="text-[12px] text-[color:var(--fg-muted)]">DenseTable · Kanban · MonthCalendar · WeekCalendar · TimelineGantt · PersonGrid</div>
      </a>
      <a href="04-detail-drawer.html" class="block p-4 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border)] hover:border-[color:var(--tom)] transition-colors">
        <div class="text-base font-semibold">04 · Detail drawer</div>
        <div class="text-[12px] text-[color:var(--fg-muted)]">Right-side drawer 450px · preview rápido sem sair da lista</div>
      </a>
      <a href="05-empty-loading.html" class="block p-4 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border)] hover:border-[color:var(--tom)] transition-colors">
        <div class="text-base font-semibold">05 · Empty + Loading</div>
        <div class="text-[12px] text-[color:var(--fg-muted)]">EmptyStateDesktop · Skeletons · Error</div>
      </a>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 4: Subir o http-server na porta 55825**

```bash
cd "D:/la-organizer/_remote/docs/mockups" && npx http-server -p 55825 -c-1 --cors -s
```

Esperado: servidor sobe, deixar rodando em background. Acessível em `http://localhost:55825/`.

⚠️ Usar `run_in_background: true` no Bash tool pra não bloquear o turno.

- [ ] **Step 5: Validar que o servidor responde**

Abrir `http://localhost:55825/` no Simple Browser via `mcp__Claude_Preview__` (registrar nova preview se necessário) ou validar com `curl`:

```bash
curl -s http://localhost:55825/ | head -3
```

Esperado: HTML do `index.html` com `<title>LA Organizer Desktop · Mockups Foundation</title>`.

- [ ] **Step 6: Aprovação do menu**

Mostrar screenshot do menu pro usuário. Confirmar que a navegação está OK.

---

## Task 2: Mockup 00 — Shell + Projetos (página completa)

**Files:**
- Create: `_remote/docs/mockups/00-shell-projetos.html`

**Objetivo:** estabelecer a linguagem visual COMPLETA num único mockup. Esse é o mais importante — todos os outros são variantes/refinamentos dele.

**Conteúdo do mockup:**
- Sidebar v2 fixa esquerda (240px expandida)
- Topbar v2 (52px, com breadcrumb "Projetos / Todos" e quick-action global)
- Page header desktop ("Projetos · 86 itens" + actions à direita)
- Toolbar com:
  - View switcher: Dashboard · Lista · Kanban · Calendário · Timeline · Por pessoa (Kanban ativo)
  - Filtros pill: Status · Responsável · Programa · Unidade
  - Busca à direita
  - Botão "+ Novo Projeto" primário
- KanbanBoard denso com 6 colunas: Brainstorm · Planejamento · A Fazer · Captando · Editando · Aguardando Aprovação · Aprovado/Agendado · Publicado
- Cards de projeto: 240px largura, padding 12px, com:
  - Título (1 linha truncado)
  - Badge de programa (KIDS/SCHOOL com cor)
  - Eyebrow tags (categoria)
  - Avatar responsável + prazo
- Densidade Stripe-like (linha 40px, font 13px)

- [ ] **Step 1: Criar o arquivo `00-shell-projetos.html` com markup completo**

Estrutura (código real abaixo):

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>00 · Shell + Projetos</title>
  <link rel="stylesheet" href="assets/tom-tokens.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: {
        colors: {
          tom: 'var(--tom)',
          'bg-app': 'var(--bg-app)',
          'bg-surface': 'var(--bg-surface)',
          'bg-elevated': 'var(--bg-elevated)',
          'bg-elevated-2': 'var(--bg-elevated-2)',
          border: 'var(--border)',
          'border-strong': 'var(--border-strong)',
          fg: 'var(--fg)',
          'fg-secondary': 'var(--fg-secondary)',
          'fg-muted': 'var(--fg-muted)',
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
        },
      } }
    };
  </script>
</head>
<body class="h-screen overflow-hidden flex">
  <!-- SIDEBAR -->
  <aside class="w-[240px] shrink-0 bg-bg-surface border-r border-border flex flex-col">
    <!-- Header sidebar com avatar TOM + título -->
    <div class="h-[52px] flex items-center gap-3 px-4 border-b border-border shrink-0">
      <div class="w-9 h-9 rounded-full bg-tom/20 border border-tom/40 flex items-center justify-center text-tom font-bold text-sm">T</div>
      <div>
        <div class="text-[13px] font-semibold text-fg leading-tight">TOM</div>
        <div class="text-[10px] text-fg-muted leading-tight">LA Organizer</div>
      </div>
    </div>

    <!-- Cmd+K busca rápida -->
    <div class="px-3 py-3 border-b border-border">
      <button class="w-full h-8 flex items-center gap-2 px-2.5 rounded-md bg-bg-elevated border border-border text-fg-muted text-[12px] hover:border-border-strong">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        Buscar
        <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-bg-surface border border-border">⌘K</span>
      </button>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-2 px-2 text-[13px]">
      <div class="mb-4">
        <div class="px-2 mb-1 text-[10px] uppercase tracking-wider text-fg-muted/60 font-semibold">Principal</div>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          Agenda
        </a>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md bg-tom/10 border-l-2 border-tom -ml-0.5 pl-2 text-fg font-medium">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
          Projetos
          <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-fg-muted">86</span>
        </a>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Checklists
        </a>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
          Hábitos
        </a>
      </div>

      <div class="mb-4">
        <div class="px-2 mb-1 text-[10px] uppercase tracking-wider text-fg-muted/60 font-semibold">Gestão</div>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">Dashboard time</a>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">Aderência</a>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">Operações</a>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">Comunicados</a>
      </div>

      <div class="mb-4">
        <div class="px-2 mb-1 text-[10px] uppercase tracking-wider text-fg-muted/60 font-semibold">Educação</div>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">LA Educa</a>
        <a class="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg">LA Journey</a>
      </div>
    </nav>

    <!-- User chip embaixo -->
    <div class="border-t border-border p-3 flex items-center gap-2.5">
      <div class="w-7 h-7 rounded-full bg-tom/30 border border-tom/50"></div>
      <div class="min-w-0 flex-1">
        <div class="text-[12px] font-medium text-fg truncate">Luciano Alf</div>
        <div class="text-[10px] text-fg-muted">Diretor</div>
      </div>
      <button class="text-fg-muted hover:text-fg p-1">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
      </button>
    </div>
  </aside>

  <!-- MAIN AREA -->
  <main class="flex-1 flex flex-col overflow-hidden">
    <!-- TOPBAR -->
    <header class="h-[52px] shrink-0 border-b border-border flex items-center px-5 gap-4">
      <!-- Breadcrumb -->
      <nav class="flex items-center gap-1.5 text-[13px]">
        <span class="text-fg-muted">LA Organizer</span>
        <span class="text-fg-muted/40">/</span>
        <span class="text-fg font-medium">Projetos</span>
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <button class="h-8 w-8 rounded-md hover:bg-bg-elevated flex items-center justify-center text-fg-muted">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c1.1 0 2-.9 2-2H10c0 1.1.9 2 2 2zM18 16v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
        </button>
        <button class="h-8 px-3 rounded-md bg-tom text-bg-app font-semibold text-[12px] hover:bg-[color:var(--tom-hover)]">
          + Quick Add
        </button>
      </div>
    </header>

    <!-- PAGE HEADER -->
    <div class="px-6 pt-5 pb-3">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-[11px] uppercase tracking-wider text-fg-muted/70 font-semibold mb-0.5">Gestão</div>
          <h1 class="text-[22px] font-bold leading-tight">Projetos</h1>
          <p class="text-[13px] text-fg-muted mt-0.5">86 projetos · 12 ativos esta semana</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="h-9 px-3 rounded-md bg-bg-elevated border border-border text-fg-muted text-[13px] hover:text-fg">
            Exportar
          </button>
          <button class="h-9 px-3.5 rounded-md bg-tom text-bg-app font-semibold text-[13px] hover:bg-[color:var(--tom-hover)]">
            + Novo Projeto
          </button>
        </div>
      </div>
    </div>

    <!-- TOOLBAR -->
    <div class="px-6 pb-3 flex items-center gap-3 flex-wrap">
      <!-- View switcher -->
      <div class="inline-flex h-9 rounded-md bg-bg-elevated border border-border p-0.5 text-[12px]">
        <button class="px-3 rounded text-fg-muted hover:text-fg">Dashboard</button>
        <button class="px-3 rounded text-fg-muted hover:text-fg">Lista</button>
        <button class="px-3 rounded bg-bg-surface border border-border text-fg font-medium">Kanban</button>
        <button class="px-3 rounded text-fg-muted hover:text-fg">Calendário</button>
        <button class="px-3 rounded text-fg-muted hover:text-fg">Timeline</button>
        <button class="px-3 rounded text-fg-muted hover:text-fg">Por pessoa</button>
      </div>

      <div class="h-6 w-px bg-border"></div>

      <!-- Filtros pill -->
      <button class="h-7 px-2.5 rounded-full bg-bg-elevated border border-border text-[12px] text-fg-muted hover:text-fg flex items-center gap-1.5">
        Status <span class="text-fg-muted/60">·</span> <span class="text-fg">3</span>
      </button>
      <button class="h-7 px-2.5 rounded-full bg-bg-elevated border border-border text-[12px] text-fg-muted hover:text-fg">
        Responsável
      </button>
      <button class="h-7 px-2.5 rounded-full bg-bg-elevated border border-border text-[12px] text-fg-muted hover:text-fg">
        Programa
      </button>
      <button class="h-7 px-2.5 rounded-full border border-dashed border-border text-[12px] text-fg-muted hover:text-fg hover:border-border-strong">
        + Filtro
      </button>

      <div class="ml-auto flex items-center gap-2">
        <div class="relative">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input placeholder="Buscar" class="h-8 w-[200px] pl-8 pr-2 rounded-md bg-bg-elevated border border-border text-[12px] placeholder:text-fg-muted/60 focus:outline-none focus:border-tom" />
        </div>
      </div>
    </div>

    <!-- KANBAN BOARD -->
    <div class="flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6">
      <div class="flex gap-3 h-full">
        <!-- COLUNA Brainstorm -->
        <div class="w-[240px] shrink-0 flex flex-col bg-bg-surface rounded-lg border border-border">
          <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-fg-muted"></span>
              <span class="text-[12px] font-semibold">Brainstorm</span>
              <span class="text-[10px] text-fg-muted px-1.5 rounded bg-bg-elevated">22</span>
            </div>
            <button class="text-fg-muted hover:text-fg">+</button>
          </div>
          <div class="flex-1 overflow-y-auto p-2 space-y-2">
            <div class="p-2.5 rounded-md bg-bg-elevated border border-border hover:border-border-strong cursor-pointer">
              <div class="text-[12px] font-medium mb-1">História da guitarra</div>
              <div class="flex items-center gap-1.5 flex-wrap mb-2">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-semibold">KIDS</span>
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-fg-muted">
                <div class="w-4 h-4 rounded-full bg-bg-elevated-2 border border-border"></div>
                <span>?</span>
              </div>
            </div>
            <div class="p-2.5 rounded-md bg-bg-elevated border border-border hover:border-border-strong cursor-pointer">
              <div class="text-[12px] font-medium mb-1">Músicas emblemáticas dos últimos 50 anos</div>
              <div class="flex items-center gap-1.5 flex-wrap mb-2">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-info/20 text-info font-semibold">SCHOOL</span>
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-fg-muted">
                <div class="w-4 h-4 rounded-full bg-bg-elevated-2"></div>
                <span>?</span>
              </div>
            </div>
          </div>
        </div>

        <!-- COLUNA Planejamento -->
        <div class="w-[240px] shrink-0 flex flex-col bg-bg-surface rounded-lg border border-border">
          <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-info"></span>
              <span class="text-[12px] font-semibold">Planejamento</span>
              <span class="text-[10px] text-fg-muted px-1.5 rounded bg-bg-elevated">3</span>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-2 space-y-2">
            <div class="p-2.5 rounded-md bg-bg-elevated border border-border hover:border-border-strong cursor-pointer">
              <div class="text-[12px] font-medium mb-1">3 Amigas - alunas</div>
              <div class="flex items-center gap-1.5 flex-wrap mb-2">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-semibold">KIDS</span>
                <span class="text-[10px] text-fg-muted">la_kids</span>
              </div>
              <div class="flex items-center justify-between text-[10px]">
                <div class="flex items-center gap-1.5 text-fg-muted">
                  <div class="w-4 h-4 rounded-full bg-purple-500/30 border border-purple-500/50"></div>
                  <span>John</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- COLUNA A Fazer (highlight) -->
        <div class="w-[240px] shrink-0 flex flex-col bg-bg-surface rounded-lg border border-border">
          <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-info"></span>
              <span class="text-[12px] font-semibold">A Fazer</span>
              <span class="text-[10px] text-fg-muted px-1.5 rounded bg-bg-elevated">7</span>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-2 space-y-2">
            <div class="p-2.5 rounded-md bg-bg-elevated border border-border hover:border-border-strong cursor-pointer">
              <div class="text-[12px] font-medium mb-1">Bianca Stoianof - Aula 1 - Pega na Mentira</div>
              <div class="flex items-center gap-1.5 flex-wrap mb-2">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-semibold">KIDS</span>
                <span class="text-[10px] text-fg-muted">la_kids</span>
              </div>
              <div class="flex items-center justify-between text-[10px]">
                <div class="flex items-center gap-1.5 text-fg-muted">
                  <div class="w-4 h-4 rounded-full bg-purple-500/30"></div>
                  <span>John</span>
                </div>
                <div class="flex items-center gap-1 text-fg-muted">
                  <span>📅</span><span>07 de abr.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- COLUNA Captando -->
        <div class="w-[240px] shrink-0 flex flex-col bg-bg-surface rounded-lg border border-border">
          <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-warning"></span>
              <span class="text-[12px] font-semibold">Captando</span>
              <span class="text-[10px] text-fg-muted px-1.5 rounded bg-bg-elevated">5</span>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-2 space-y-2">
            <div class="p-2.5 rounded-md bg-bg-elevated border border-border-strong cursor-pointer">
              <div class="text-[12px] font-medium mb-1">Dia do Guitarrista - Valdo</div>
              <div class="flex items-center gap-1.5 flex-wrap mb-2">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-info/20 text-info font-semibold">SCHOOL</span>
              </div>
              <div class="flex items-center justify-between text-[10px]">
                <div class="flex items-center gap-1.5 text-fg-muted">
                  <div class="w-4 h-4 rounded-full bg-yellow-500/30"></div>
                  <span>Yuri</span>
                </div>
                <div class="flex items-center gap-1 text-fg-muted">
                  <span>📅</span><span>20 de mar.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- COLUNA Editando -->
        <div class="w-[240px] shrink-0 flex flex-col bg-bg-surface rounded-lg border border-border">
          <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-danger"></span>
              <span class="text-[12px] font-semibold">Editando</span>
              <span class="text-[10px] text-fg-muted px-1.5 rounded bg-bg-elevated">15</span>
            </div>
          </div>
        </div>

        <!-- COLUNA Aprovação -->
        <div class="w-[240px] shrink-0 flex flex-col bg-bg-surface rounded-lg border border-border">
          <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-success"></span>
              <span class="text-[12px] font-semibold">Aguardando Aprovação</span>
              <span class="text-[10px] text-fg-muted px-1.5 rounded bg-bg-elevated">2</span>
            </div>
          </div>
        </div>

        <!-- COLUNA Publicado -->
        <div class="w-[240px] shrink-0 flex flex-col bg-bg-surface rounded-lg border border-border">
          <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-tom"></span>
              <span class="text-[12px] font-semibold">Publicado</span>
              <span class="text-[10px] text-fg-muted px-1.5 rounded bg-bg-elevated">9</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 2: Abrir o mockup no Simple Browser**

Acessar `http://localhost:55825/00-shell-projetos.html` no Simple Browser.

- [ ] **Step 3: Screenshot pra validação visual**

```
mcp__Claude_Preview__preview_screenshot
```

(Iniciar uma nova preview com o URL do mockup se necessário.)

- [ ] **Step 4: Aguardar feedback do usuário**

O usuário aprova ou pede ajustes. Iterar até aprovado.

- [ ] **Step 5: Commit do mockup aprovado**

```bash
# (auto-deploy hook cuida disso, mas se quiser forçar:)
# Os arquivos em _remote/docs/mockups/ são sincronizados pelo auto-deploy se forem incluídos. Verificar.
```

✅ Mockups em `docs/mockups/` são sincronizados pelo `auto-deploy.ps1` automaticamente (pasta `docs` já está na lista).

---

## Task 3: Mockup 01 — Tokens (styleguide)

**Files:**
- Create: `_remote/docs/mockups/01-tokens.html`

**Objetivo:** documentação visual dos design tokens. Aparece como página única scrollável com seções:
1. Paleta de cores (Tom, surfaces, fg, status)
2. Tipografia (todas as escalas 11→24px + pesos)
3. Espaçamentos (visuais com régua)
4. Componentes atômicos (button variants, badge variants, chip, input, switch, radio)
5. Sombras + radii
6. Iconografia (set Lucide)

- [ ] **Step 1: Criar o arquivo `01-tokens.html`**

Estrutura visual: sidebar fixa esquerda com âncoras (Cores · Tipografia · Espaçamentos · Componentes · Sombras · Ícones), conteúdo principal scrollável.

Cada seção mostra os tokens com swatch + nome + valor:
- Cor: quadrado 64x64 + nome variável + hex
- Tipografia: exemplo "The quick brown fox" + nome + tamanho/peso
- Espaçamento: barra horizontal com largura proporcional + nome + valor
- Componentes: render real do componente com todas as variantes lado a lado

**Implementação:** vou estruturar com Tailwind utility classes, usando as CSS vars de `tom-tokens.css`. Cada seção tem ~80-120 linhas.

⚠️ Este step contém um arquivo grande (~800 linhas HTML). Será escrito completo no momento da execução — o conteúdo segue o padrão do mockup 00, incluindo todas as seções listadas acima com markup HTML+Tailwind real (sem placeholders).

- [ ] **Step 2: Abrir no Simple Browser e validar**

`http://localhost:55825/01-tokens.html`

- [ ] **Step 3: Aguardar aprovação**

Iterar se necessário.

---

## Task 4: Mockup 02 — Page primitives

**Files:**
- Create: `_remote/docs/mockups/02-page-shell.html`

**Objetivo:** demonstrar os primitivos de página em isolamento, sem contexto de uma página real.

**Seções do mockup (todas em coluna vertical, scrollável):**
1. **PageHeaderDesktop** — 3 variantes lado a lado (com breadcrumb / sem breadcrumb / com actions)
2. **Toolbar** — 2 variantes (cheia: view switcher + filtros + busca + actions; enxuta: só filtros)
3. **FilterPill** — todas as variantes (ativo / inativo / com count / dashed "+ filtro" / removível)
4. **ViewSwitcher** — 3 estados (6 views ativos / 3 views ativos / 2 views ativos)
5. **EmptyStateDesktop** — preview pequeno (versão completa fica no mockup 05)

- [ ] **Step 1: Criar `02-page-shell.html` com as 5 seções**

Estrutura: cada seção tem header (`<h2>`), descrição em 1 linha, e demonstração visual do primitivo.

- [ ] **Step 2: Validar no Simple Browser e aguardar aprovação**

---

## Task 5: Mockup 03 — View patterns

**Files:**
- Create: `_remote/docs/mockups/03-views.html`

**Objetivo:** demonstrar os 6 view patterns reutilizáveis. Cada um ocupa uma seção da página com altura fixa (ex: 480px) pra dar ideia de como fica no contexto real.

**Seções:**
1. **DenseTable** — exemplo: lista de colaboradores com 6 colunas (avatar+nome / role / unidade / status / última atividade / actions). 8-10 linhas.
2. **KanbanBoard** — versão denser do mockup 00 mas com 4 colunas (mais espaço pra ver detalhes do card).
3. **MonthCalendar** — grid 7×6 estilo Google Calendar. Hoje marcado. Eventos com cor por categoria.
4. **WeekCalendar** — timeline horizontal com slots 30min. 5 dias úteis.
5. **TimelineGantt** — 8 projetos com barras coloridas em scale de 3 meses. Linha vertical "hoje".
6. **PersonGrid** — grid 4-col de cards de pessoas com avatar grande + nome + role + 2-3 métricas pequenas.

- [ ] **Step 1: Criar `03-views.html`**

⚠️ Este é o mockup mais denso visualmente. Será dividido em 6 seções com `<details>` colapsáveis pra não sobrecarregar a visualização.

- [ ] **Step 2: Validar no Simple Browser e aguardar aprovação**

---

## Task 6: Mockup 04 — Detail drawer

**Files:**
- Create: `_remote/docs/mockups/04-detail-drawer.html`

**Objetivo:** mostrar como o DetailDrawer aparece sobre uma página de lista, em estado aberto.

**Conteúdo:**
- Fundo: lista de tarefas (DenseTable mockada, 10 linhas)
- Drawer aberto à direita (450px width, full height, slide-in da direita)
- Drawer header: título da tarefa + botões (fechar, expandir, mais opções)
- Drawer body: campos editáveis (título, descrição, prioridade, prazo, responsável, etiquetas)
- Drawer footer: actions primárias (Salvar / Cancelar / Deletar)

- [ ] **Step 1: Criar `04-detail-drawer.html`**

Implementação: usar `position: fixed; right: 0; top: 52px; bottom: 0; width: 450px; transform: translateX(0)` no drawer. Backdrop opcional semi-transparente sobre o conteúdo.

- [ ] **Step 2: Validar no Simple Browser e aguardar aprovação**

---

## Task 7: Mockup 05 — Empty + Loading states

**Files:**
- Create: `_remote/docs/mockups/05-empty-loading.html`

**Objetivo:** padronizar como estados não-felizes aparecem no desktop.

**Seções:**
1. **EmptyStateDesktop** — 4 variantes lado a lado:
   - Empty inicial (CTA "+ Criar primeiro projeto")
   - Empty por filtro (CTA "Limpar filtros")
   - Empty por busca (sem CTA, só "Nenhum resultado para 'xxx'")
   - Empty sem permissão (texto explicativo)
2. **LoadingSkeleton** — 3 variantes:
   - Lista de cards (3 cards skeleton)
   - Tabela densa (5 linhas skeleton)
   - Kanban (1 coluna com 3 cards skeleton)
3. **ErrorState** — 1 variante (ícone alerta + título + mensagem + botão "Tentar novamente")

- [ ] **Step 1: Criar `05-empty-loading.html`**

- [ ] **Step 2: Validar no Simple Browser e aguardar aprovação**

---

## Task 8: Revisão final e aprovação consolidada

- [ ] **Step 1: Revisar o conjunto dos 6 mockups**

Navegar pelo `index.html` no Simple Browser e revisar cada um na ordem. Validar que:
- Linguagem visual é consistente entre todos
- Tokens usados em todos os mockups vêm do `tom-tokens.css` (sem cores hardcoded)
- Densidade é igual em todos (linhas 40px, font 13px corpo)
- Hover/active states funcionam

- [ ] **Step 2: Tirar screenshot de cada mockup para registro**

```
00-shell-projetos.png
01-tokens.png
02-page-shell.png
03-views.png
04-detail-drawer.png
05-empty-loading.png
```

Salvar em `_remote/docs/mockups/screenshots/` para histórico.

- [ ] **Step 3: Confirmação final do usuário**

> "Todos os 6 mockups da Foundation aprovados? Posso seguir para o plano de implementação React (Fase 1b)?"

- [ ] **Step 4: Marcar Fase 1a como concluída**

Atualizar a master spec em `docs/superpowers/specs/2026-05-21-desktop-redesign-master-design.md` com status "Fase 1a (Mockups) — concluída em YYYY-MM-DD".

---

## Próximo passo após este plano

Após os 6 mockups aprovados, escrever o plano de **Fase 1b — Implementação dos Primitivos React**, que cobrirá:
- Criar pasta `web/src/design/`
- Migrar tokens do `tom-tokens.css` pro `tailwind.config.ts` + CSS vars do app
- Implementar cada primitivo com TypeScript strict (PageShell, PageHeaderDesktop, Toolbar, FilterPill, ViewSwitcher, DetailDrawer, EmptyStateDesktop, CommandPalette)
- Implementar cada view pattern (DenseTable, KanbanBoard, MonthCalendar, WeekCalendar, TimelineGantt, PersonGrid)
- Migrar Sidebar v2 + Topbar v2
- Substituir DesktopShell v1 por v2
- Migrar Projetos como POC

Esse plano de implementação terá TDD, granularidade fina, e commits frequentes — diferente deste que é exploratório visual.

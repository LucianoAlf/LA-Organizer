# PRD — LA Organizer Desktop (v2 — pós-auditoria)
## Adaptação Responsiva: Sidebar + Dashboard + Layout Desktop/Tablet
### Versão 2.0 · Maio 2026

---

| Campo | Valor |
|---|---|
| Produto | LA Organizer PWA |
| Módulo | Adaptação Desktop/Tablet |
| Versão PRD | 2.0 (atualizado com auditoria real do código) |
| Data | 21/05/2026 |
| Owner | Luciano Alf |
| Estado real do app | 38 rotas, 75 arquivos de tela, 81 componentes, 22 hooks, 22 libs, 36.583 LOC |
| Stack | React 18 + TypeScript + Tailwind 3.4 + Vite 5 + TanStack Query 5 + Supabase |

---

## 1. Estado atual do app (auditoria real de 21/05/2026)

### 1.1 Navegação atual
- **BottomNav mobile** com 5 tabs: Agenda, Projetos, Checklists, Hábitos, Mais
- **BottomNav desktop (md+)** já existe como `hidden md:flex` top-rail horizontal — mas é placeholder, sem sidebar real
- **Tela "Mais"** é hub com 12+ links escondidos (Time, Comunicados, Agenda, Inventário, Lojinha, etc.)
- **Sidebar: NÃO EXISTE**

### 1.2 Shell atual (`AppShell.tsx`)
```
<AppShell>
  <Header />                    // saudação + avatar + menu
  {showAgendaTabs && <AgendaTabs />}
  <main className="max-w-content">   // ← HARDCODED 720px
    <Outlet />
  </main>
  {!focused && <BottomNav />}
  <ToastHost />
</AppShell>
```

**Problemas identificados:**
- `max-w-content: 720px` — conteúdo fica numa coluna estreita no desktop
- Nenhum breakpoint além de `md` é usado de verdade
- Nenhuma rota usa `React.lazy` — bundle monolítico
- 20+ BottomSheets que precisam virar modais/drawers no desktop
- Breakpoints Tailwind são default (`sm`/`md`/`lg`/`xl`/`2xl`) — apenas `md` usado

### 1.3 Rotas completas (38 rotas)

**Bottom nav direto (4):**
`/hoje`, `/semana`, `/projetos`, `/mais`

**Telas dentro do "Mais" (15):**
`/configuracoes`, `/historico`, `/habitos`, `/habitos/:id`, `/checklists`, `/mais/perfil`, `/mais/agenda-escolar`, `/mais/eventos/:id`, `/mais/gestao-equipe` (+ /novo, /:id), `/mais/comunicados` (+ /:id), `/mais/agenda-escolar/equipe`, `/mais/observabilidade`, `/mais/operacoes` (+ /:id), `/mais/aderencia-checklists` (+ /:id)

**Educação (7):**
`/la-educa` (+ /novo, /admin, /:id, /:id/:pilar), `/la-journey` (+ /admin, /:checkpointId)

**Inventário + Loja (7):**
`/inventario`, `/inventario/sala/:salaId`, `/inventario/loja`, `/inventario/loja/produtos`, `/inventario/loja/historico`, `/inventario/loja/reservas`

**Outros (5):**
`/login`, `/projetos/novo`, `/projetos/:id`, `/time`, `/time/:id`

---

## 2. Arquitetura Desktop

### Layout por breakpoint

| Breakpoint | Sidebar | Bottom Nav | Topbar | Content |
|---|---|---|---|---|
| < 768px (mobile) | hidden | visível (5 tabs) | hidden | 100% (max 720px) |
| 768–1023px (tablet) | colapsada 64px | hidden | visível | flex-1 |
| ≥ 1024px (desktop) | expandida 240px | hidden | visível | flex-1 |

### Layout desktop (≥ 1024px)
```
┌──────────────────────────────────────────────────────────────┐
│  TOPBAR (56px, fixo)                                         │
│  [Logo]  LA Organizer           Bom dia, Quintela    [🔔][👤]│
├────────────┬─────────────────────────────────────────────────┤
│  SIDEBAR   │  CONTENT AREA (scroll, flex-1)                  │
│  (240px)   │                                                 │
│            │                                                 │
│  PRINCIPAL │                                                 │
│  ● Agenda  │                                                 │
│  🚀 Projetos│                                                │
│  📋 Checklists│                                              │
│  💪 Hábitos │                                                │
│            │                                                 │
│  GESTÃO    │  (coord + director + manager)                   │
│  👥 Time    │                                                │
│  📊 Aderência│                                               │
│  🎯 Operações│                                               │
│  📢 Comunicados│                                             │
│  👁 Observ.  │                                               │
│  👤 Equipe   │                                               │
│            │                                                 │
│  EDUCAÇÃO  │                                                 │
│  🎓 LA Educa│                                                │
│  🎵 LA Journey│                                              │
│            │                                                 │
│  OPERAÇÕES │                                                 │
│  📦 Inventário│                                              │
│  🛍 Lojinha  │                                               │
│            │                                                 │
│  SISTEMA   │                                                 │
│  📅 Agenda LA│                                               │
│  📊 Histórico│                                               │
│  ⚙ Config   │                                               │
└────────────┴─────────────────────────────────────────────────┘
```

---

## 3. Sidebar — items por role

### Seção "Principal" (todos)
| Item | Rota | Ícone Lucide |
|---|---|---|
| Agenda | `/hoje` | CalendarDays (ativo em /hoje e /semana) |
| Projetos | `/projetos` | Rocket |
| Checklists | `/checklists` | ClipboardCheck |
| Hábitos | `/habitos` | Sparkles |

### Seção "Gestão" (condicional por role)
| Item | Rota | Role necessário |
|---|---|---|
| Dashboard time | `/time` | coordinator, director |
| Aderência operacional | `/mais/aderencia-checklists` | director, manager |
| Operações | `/mais/operacoes` | director, coordinator, manager |
| Comunicados | `/mais/comunicados` | director, coordinator |
| Observabilidade | `/mais/observabilidade` | director, coordinator |
| Gestão de equipe | `/mais/gestao-equipe` | director, coordinator, manager |

### Seção "Educação" (condicional)
| Item | Rota | Condição |
|---|---|---|
| LA Educa | `/la-educa` | coordinator, director OU isMentor |
| LA Journey | `/la-journey` | role !== 'manager' |

### Seção "Operações" (via checkAccess)
| Item | Rota | Condição |
|---|---|---|
| Inventário | `/inventario` | `useAccess('inventario').allowed` |
| Lojinha | `/inventario/loja` | `useAccess('loja_produtos').allowed` |

### Seção "Sistema" (todos)
| Item | Rota |
|---|---|
| Agenda LA Music | `/mais/agenda-escolar` |
| Histórico | `/historico` |
| Configurações | `/configuracoes` |

---

## 4. Componentes novos (Fase D1)

### `useMediaQuery(query: string): boolean`
Hook que detecta media query. Já usado em `BottomNav.tsx` de forma inline — extrair pra hook reusável.

### `useBreakpoint(): 'mobile' | 'tablet' | 'desktop'`
Wrapper de `useMediaQuery` que retorna o breakpoint ativo.

### `Sidebar.tsx`
Navegação lateral com seções condicionais. Props: `collapsed: boolean`. Tokens: `bg-bg-surface` (ou um step mais escuro `#0F0F0F`), item ativo `bg-tom/10 border-l-2 border-tom`, separadores `border-white/5`.

### `SidebarItem.tsx`
Item individual: ícone Lucide + label + badge opcional + estado ativo. Quando colapsada: só ícone + tooltip.

### `Topbar.tsx`
Header horizontal fixo (56px). Logo LA Music (SVG solo) + "LA Organizer" + saudação + badge notificações + avatar com dropdown (Perfil, Config, Trocar tema, Logout). Reutiliza lógica do `Header.tsx` atual.

### `DesktopShell.tsx`
Shell alternativo que envelve `<Outlet />` com Sidebar + Topbar. Renderizado quando breakpoint ≥ tablet. Mobile continua usando `AppShell.tsx` intacto.

---

## 5. Fases de implementação

### Fase D1 — Shell responsivo (PRIORIDADE — desbloqueia tudo)
- [ ] `useMediaQuery` + `useBreakpoint` hooks
- [ ] `Sidebar` com seções condicionais por role + checkAccess
- [ ] `SidebarItem` com ícones Lucide + estados (ativo, hover)
- [ ] `Topbar` com logo + saudação + avatar dropdown
- [ ] `DesktopShell` com Sidebar + Topbar + Content
- [ ] `App.tsx` renderiza `DesktopShell` quando ≥768px, `AppShell` quando <768px
- [ ] Bottom nav `hidden lg:hidden` (esconde em ≥768px)
- [ ] Sidebar `hidden` em <768px
- [ ] Tela `/mais` continua igual no mobile
- [ ] No desktop, `/mais` redireciona pra `/hoje` (tudo na sidebar)
- [ ] Dark mode + light mode na sidebar e topbar
- [ ] Logo SVG oficial na sidebar (usar `LogoMark.tsx` existente)
- [ ] Conteúdo fica dentro do content area com `max-w-content` (720px) — MANTÉM mobile layout dentro do desktop shell até D2

**Zero regressão no mobile.** O `AppShell.tsx` original não é modificado — o `DesktopShell` é uma alternativa paralela.

### Fase D2 — Liberar largura + layouts 2 colunas
- [ ] Content area no desktop: remover `max-w-content`, usar `max-w-5xl` (1024px) ou `max-w-6xl`
- [ ] `Hoje`: `lg:grid-cols-2` (compromissos | tarefas)
- [ ] `Semana`: `lg:grid-cols-5` (seg-sex lado a lado)
- [ ] `DashboardTime`: `lg:grid-cols-2` ou `lg:grid-cols-3`
- [ ] `PessoaDetalhe`: `lg:grid-cols-2` (info | tarefas)
- [ ] `ProjetoDetalhe`: `lg:grid-cols-2` (info+progresso | tarefas)
- [ ] `InventarioSalaPage`: `lg:grid-cols-2` (itens | manutenções+pendências)

### Fase D3 — Sheets adaptativos
- [ ] `AdaptiveSheet` wrapper — bottom sheet no mobile, modal central ou drawer no desktop
- [ ] `SideDrawer` componente (desliza da direita, 450px)
- [ ] Migrar sheets gradualmente (sem urgência — funcionam OK como bottom sheet)

### Fase D4 — Tablet + polish
- [ ] Sidebar colapsada 64px no tablet (768-1023px) — só ícones, tooltip no hover
- [ ] Toast reposicionado top-right no desktop
- [ ] `React.lazy` nas rotas (code splitting)
- [ ] Testes visuais: 1920, 1440, 1024, 768, 375px

---

## 6. Design tokens (sem mudança — usar existentes)

### Sidebar dark mode
```css
background:      var(--bg-surface) ou #0F0F0F
item-default:    color: var(--fg-muted)
item-hover:      background: rgba(255,255,255,0.05)
item-active:     background: rgba(168,230,67,0.1); border-left: 2px solid #a8e643; color: var(--fg-primary)
separator:       border-top: 1px solid rgba(255,255,255,0.05)
section-label:   font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--fg-muted) 50% opacity
```

### Topbar
```css
height:          56px
background:      var(--bg-surface)
border-bottom:   1px solid var(--border)
position:        fixed; top: 0; z-index: 40
```

---

## 7. O que NÃO muda
- Banco de dados (zero migration)
- Lógica de negócio (hooks, services, mutations, checkAccess)
- TOM WhatsApp
- Funcionalidades existentes
- Design System (mesmos tokens)
- Mobile (zero regressão)

---

*PRD v2.0 · Atualizado com auditoria real de código (21/05/2026) · LA Music · Uso interno*

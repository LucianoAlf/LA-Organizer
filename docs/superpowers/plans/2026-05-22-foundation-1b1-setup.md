# Foundation Setup (1b.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar o terreno técnico pra implementação dos primitivos React: tipografia editorial (Instrument Serif), tokens auditados, pasta `design/` criada e rota viva `/design-system` rodando.

**Architecture:** Os mockups da Fase 1a já validaram a linguagem visual. Agora alinhamos o `tailwind.config.js` e `src/index.css` com a paleta oficial dos mockups, adicionamos a fonte display Instrument Serif, criamos a pasta `web/src/design/` paralela a `components/` (não substitui — coexiste), e disponibilizamos uma rota interna `/design-system` que importa o conteúdo do mockup 01 pra servir como living styleguide.

**Tech Stack:** React 18 + TypeScript + Vite 5 + Tailwind 3.4. Mobile (AppShell) preservado intacto.

**Spec base:** [`docs/superpowers/specs/2026-05-21-desktop-redesign-master-design.md`](../specs/2026-05-21-desktop-redesign-master-design.md)

---

## File Structure

```
_remote/web/
├── index.html                          # MODIFY: adicionar preconnect Google Fonts + Instrument Serif
├── tailwind.config.js                  # MODIFY: adicionar fontFamily.display + verificar tokens
├── src/
│   ├── index.css                       # MODIFY: verificar CSS vars dos 4 níveis de surface
│   ├── design/                         # CREATE: pasta nova pra primitivos desktop
│   │   ├── README.md                   # CREATE: doc do design system
│   │   └── index.ts                    # CREATE: barrel export (vazio por ora)
│   ├── screens/
│   │   └── DesignSystem.tsx            # CREATE: rota viva /design-system
│   └── App.tsx                         # MODIFY: adicionar rota /design-system
```

Nenhum arquivo é deletado. `components/` continua intocado. Mobile/desktop atuais continuam funcionando.

---

## Task 1: Auditar tokens atuais do app

**Files:**
- Read: `web/tailwind.config.js`
- Read: `web/src/index.css`

Antes de tocar em qualquer coisa, mapear o que JÁ EXISTE no app. Isso evita duplicação e identifica gaps.

- [ ] **Step 1: Ler tailwind.config.js**

Use Read tool em `D:/la-organizer/_remote/web/tailwind.config.js`.

Verificar e anotar:
- Tokens `tom` (paleta verde) — esperado: `{ DEFAULT, shade, deep, light, tint }` com hex `#A3BE50`, `#8BA244`, `#728538`, `#BAD179`, `#E8F0CF`
- Tokens `ink` (paleta neutros) — esperado: 13 níveis de 0 a 1000
- Tokens semânticos: `success`, `warning`, `danger`, `info`
- `fontFamily` — esperado: `sans` apenas. Provavelmente NÃO tem `display`.
- `extend.fontSize`, `extend.spacing` se houver

- [ ] **Step 2: Ler src/index.css**

Use Read em `D:/la-organizer/_remote/web/src/index.css`.

Procurar bloco `:root { ... }` com CSS vars. Anotar quais já existem:
- `--bg-app`, `--bg-surface`, `--bg-elevated`
- `--bg-elevated-2` (provável GAP — mockups precisam)
- `--fg`, `--fg-muted`, `--fg-secondary` (verificar)
- `--border`, `--border-strong`
- `--tom` (variações)

- [ ] **Step 3: Reportar gaps**

Listar:
1. Quais tokens já existem (não fazer nada)
2. Quais faltam (atacar nos próximos steps)
3. Tokens com NOMES diferentes entre mockup e app (ex: mockup usa `--tom-hover`, app usa `tom.light`) — decidir qual nomenclatura adotar

**Decisão padrão:** seguir nomenclatura do app (`tom.light` em vez de `--tom-hover`). Os mockups foram exploração; o app é fonte de verdade.

- [ ] **Step 4: Commit do reporte**

Não há commit de código. Esta task gera apenas conhecimento que informa as próximas.

---

## Task 2: Adicionar Instrument Serif ao bundle

**Files:**
- Modify: `web/index.html`
- Modify: `web/tailwind.config.js`

Mockups usam **Instrument Serif** italic nos títulos editoriais (página, view sections). Inter continua nos dados.

- [ ] **Step 1: Adicionar link da fonte no index.html**

Use Read em `D:/la-organizer/_remote/web/index.html` pra ver a estrutura atual.

Localizar a tag de Google Fonts existente (Inter). Logo abaixo, adicionar Instrument Serif. Exemplo do bloco esperado após a edição:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:wght@400&display=swap" rel="stylesheet" />
```

⚠️ Se o app não usa Google Fonts hoje e tem Inter via npm/local — verificar e adicionar tanto via npm quanto manter consistência. Usar Read pra confirmar o método atual antes de editar.

- [ ] **Step 2: Adicionar fontFamily.display no tailwind.config.js**

Use Edit em `D:/la-organizer/_remote/web/tailwind.config.js`. Dentro do `theme.extend`, adicionar:

```js
fontFamily: {
  display: ['"Instrument Serif"', 'Georgia', 'serif'],
  // (não tocar em sans/Inter que provavelmente já existe — se NÃO existir, adicionar também:)
  sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
},
```

⚠️ Se `fontFamily` já existir no `extend`, ADICIONAR `display` ao objeto existente, NÃO sobrescrever.

- [ ] **Step 3: Rodar typecheck**

Run:
```bash
cd "D:/la-organizer/_remote/web" && npx tsc --noEmit
```

Expected: zero erros (Tailwind config não é TypeScript, mas se tsc reclamar do .js, ignorar).

- [ ] **Step 4: Build pra confirmar Tailwind compila**

Run:
```bash
cd "D:/la-organizer/_remote/web" && npx vite build 2>&1 | tail -5
```

Expected: `✓ built in Xs` sem erro.

- [ ] **Step 5: Verificar visualmente no preview**

```bash
# Servidor já roda em localhost:4173 (web-preview)
```

Abrir `localhost:4173` no Simple Browser. Não vai ver mudança ainda (nenhum componente usa `font-display` por enquanto). Só confirmar que nada quebrou (app continua renderizando).

- [ ] **Step 6: Commit**

```bash
# auto-deploy hook cuida do commit ao fim do turno
```

Mas se quiser commit manual:
```bash
git -C "D:/la-organizer/_remote" add web/index.html web/tailwind.config.js
git -C "D:/la-organizer/_remote" commit -m "design: add Instrument Serif as display font

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

⚠️ Lembrete: `_remote/` NÃO é git repo direto. O auto-deploy hook clona pra `C:/la-deploy-work` e commita lá. Não tentar `git init` no `_remote/`.

---

## Task 3: Adicionar CSS vars dos 4 níveis de surface

**Files:**
- Modify: `web/src/index.css`

Mockups usam 4 níveis de surface (`--bg-app`, `--bg-surface`, `--bg-elevated`, `--bg-elevated-2`). App atual pode ter só 3.

- [ ] **Step 1: Ler index.css atual**

Use Read em `D:/la-organizer/_remote/web/src/index.css`. Localizar o `:root { ... }`.

- [ ] **Step 2: Adicionar `--bg-elevated-2` se não existir**

Procurar `--bg-elevated-2` no Read anterior.

Se já existir: pular este step inteiro.

Se NÃO existir: usar Edit pra adicionar logo após `--bg-elevated` no `:root`:

```css
  --bg-elevated-2: #2A2A2A; /* ink-200 — nested cards, modais sobre cards */
```

Valor: `#2A2A2A` (ink-200 do app oficial).

- [ ] **Step 3: Garantir consistência hex entre CSS vars e tailwind config**

Após o Step 2, verificar via Read que TODOS os hex de surfaces batem entre os 2 arquivos:

| Token | CSS var (`index.css`) | Tailwind (`tailwind.config.js`) |
|---|---|---|
| Surface 0 | `--bg-app: #0A0A0A` | `ink.0: '#0A0A0A'` |
| Surface 50 | `--bg-surface: #141414` | `ink.50: '#141414'` |
| Surface 100 | `--bg-elevated: #1A1A1A` | `ink.100: '#1A1A1A'` |
| Surface 200 | `--bg-elevated-2: #2A2A2A` | `ink.200: '#2A2A2A'` |

Se algum hex divergir entre os 2 arquivos, ajustar a CSS var pra bater com `tailwind.config.js` (tailwind é a fonte de verdade — `index.css` segue).

- [ ] **Step 4: Build pra confirmar**

```bash
cd "D:/la-organizer/_remote/web" && npx vite build 2>&1 | tail -3
```

Expected: `✓ built`.

- [ ] **Step 5: Visual sanity check**

Abrir `localhost:4173` (rota qualquer existente, ex: `/hoje`). Verificar que cards e backgrounds continuam idênticos (nada deveria mudar visualmente — ainda nenhum componente usa `--bg-elevated-2`).

- [ ] **Step 6: Commit** (auto-hook ou manual)

---

## Task 4: Criar pasta `web/src/design/` com README

**Files:**
- Create: `web/src/design/README.md`
- Create: `web/src/design/index.ts`

Pasta nova vazia, pronta pra receber primitivos nas próximas fases.

- [ ] **Step 1: Criar README.md**

Use Write em `D:/la-organizer/_remote/web/src/design/README.md`:

```markdown
# LA Organizer Desktop Design System

Pasta de primitivos desktop. **Coexiste com `components/`** — não substitui.

## Estrutura

\`\`\`
design/
├── shell/        # SidebarV2, TopbarV2 (Fase 1b.2)
├── primitives/   # PageShell, Toolbar, FilterPill, ViewSwitcher,
│                 # DetailDrawer, EmptyStateDesktop, LoadingSkeleton (1b.3)
└── views/        # DenseTable, KanbanBoard, MonthCalendar,
                  # WeekCalendar, TimelineGantt, PersonGrid (1b.4)
\`\`\`

## Princípios

- **Mobile intocado**: estes componentes só são renderizados pelo `DesktopShell`.
- **Tipografia**: Inter (dados) + Instrument Serif (títulos editoriais via `font-display`).
- **Densidade**: Stripe-like (13px corpo, linhas 40px, padding card 14px).
- **Paleta**: Tom green oficial (`#A3BE50` família) + ink (4 surfaces) + status oficiais.
- **Atmosfera**: shadow direcional + radial gradient sutil. Não flat raso.

## Referências visuais

- Mockups Fase 1a: `docs/mockups/00-shell-projetos.html` → `05-empty-loading.html`
- Master spec: `docs/superpowers/specs/2026-05-21-desktop-redesign-master-design.md`
- Tokens vivos: `/design-system` (rota interna)

## Como usar

Importa por path completo (não atalho de barrel até estabilizar):

\`\`\`tsx
import { PageShell } from '@/design/primitives/PageShell';
\`\`\`
```

- [ ] **Step 2: Criar index.ts (barrel vazio)**

Use Write em `D:/la-organizer/_remote/web/src/design/index.ts`:

```ts
// LA Organizer Desktop Design System — barrel export
// Componentes serão exportados aqui conforme implementação avança.
export {};
```

- [ ] **Step 3: Confirmar que typecheck passa**

```bash
cd "D:/la-organizer/_remote/web" && npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 4: Commit** (auto-hook ou manual)

---

## Task 5: Criar rota `/design-system` (living styleguide)

**Files:**
- Create: `web/src/screens/DesignSystem.tsx`
- Modify: `web/src/App.tsx`

Living styleguide acessível dentro do app (não precisa subir mockup HTTP separado). Por enquanto: iframe embutido apontando pro mockup 01 da pasta `docs/mockups/`. Quando primitivos React forem implementados, substituímos o iframe por renderização real dos componentes.

- [ ] **Step 1: Criar `DesignSystem.tsx`**

Use Write em `D:/la-organizer/_remote/web/src/screens/DesignSystem.tsx`:

```tsx
import { useEffect } from 'react';

/**
 * Rota interna /design-system — living styleguide.
 *
 * Fase 1b.1: embute o mockup 01-tokens.html (servido por http://localhost:55825
 * em dev, ou copiado pra /public em prod). Conforme primitivos React forem
 * implementados (1b.2+), substituir o iframe por componentes reais.
 */
export function DesignSystem() {
  useEffect(() => {
    document.title = 'Design System · LA Organizer';
  }, []);

  // Em dev, mockups rodam em 55825. Em prod, vamos copiar pra public/mockups.
  const url = import.meta.env.DEV
    ? 'http://localhost:55825/01-tokens.html'
    : '/mockups/01-tokens.html';

  return (
    <div className="fixed inset-0">
      <iframe
        src={url}
        title="LA Organizer Design System"
        className="w-full h-full border-0"
      />
    </div>
  );
}
```

- [ ] **Step 2: Adicionar rota em App.tsx**

Use Read em `D:/la-organizer/_remote/web/src/App.tsx` pra localizar a estrutura de rotas.

Use Edit pra adicionar:

1. Import no topo:
```tsx
import { DesignSystem } from './screens/DesignSystem';
```

2. Dentro do `<Routes>` (FORA do `<ProtectedRoute>` pra ficar acessível sem login durante dev):
```tsx
<Route path="/design-system" element={<DesignSystem />} />
```

Colocar logo após `<Route path="/login" element={<Login />} />` e antes do `<Route element={<ProtectedRoute />}>`.

- [ ] **Step 3: Typecheck**

```bash
cd "D:/la-organizer/_remote/web" && npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 4: Build**

```bash
cd "D:/la-organizer/_remote/web" && npx vite build 2>&1 | tail -3
```

Expected: `✓ built`.

- [ ] **Step 5: Verificar visualmente**

Garantir que o mockup server está rodando (`localhost:55825`). Recarregar `localhost:4173` (web preview) e navegar pra `/design-system`. Deveria ver o styleguide carregado dentro do iframe.

Use:
```
mcp__Claude_Preview__preview_eval(serverId='8d87690f-5380-4871-8350-d43c0325bc8a', expression='location.href = "/design-system"')
```

Depois:
```
mcp__Claude_Preview__preview_screenshot(serverId='8d87690f-5380-4871-8350-d43c0325bc8a')
```

Validar visualmente.

- [ ] **Step 6: Commit** (auto-hook)

---

## Task 6: Verificação visual e revisão de paridade

**Files:**
- (nenhum — só verificação)

Confirmar que tudo até aqui está consistente entre mockups e app real.

- [ ] **Step 1: Abrir /hoje no Simple Browser**

Rota existente `/hoje` em `localhost:4173`. Confirmar:
- Cores ainda corretas (mesmo verde Tom `#A3BE50`)
- Sem regressão visual no mobile/desktop existente
- Layout idêntico ao antes da Task 1

- [ ] **Step 2: Abrir /design-system**

Confirmar que iframe carrega o mockup 01-tokens. Validar visualmente que TODOS os tokens aparecem corretamente (Brand tom, Surfaces ink, Status oficiais, Foreground 4 níveis).

- [ ] **Step 3: Inspecionar CSS vars via preview_eval**

Use `preview_eval` em `localhost:4173/hoje` (não no iframe):

```js
JSON.stringify({
  app: getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim(),
  surface: getComputedStyle(document.documentElement).getPropertyValue('--bg-surface').trim(),
  elevated: getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim(),
  elevated2: getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated-2').trim(),
  tom: getComputedStyle(document.documentElement).getPropertyValue('--tom').trim(),
})
```

Expected resultados (após Task 3):
- `app: "#0A0A0A"`
- `surface: "#141414"`
- `elevated: "#1A1A1A"`
- `elevated2: "#2A2A2A"`
- `tom: "#A3BE50"`

⚠️ Se algum valor não bater, voltar pra Task 3 e ajustar.

- [ ] **Step 4: Reporte final**

Anotar o estado pós-Fase 1b.1:
- ✓ Instrument Serif disponível como `font-display`
- ✓ 4 níveis de surface em CSS vars
- ✓ Paleta tom em Tailwind config
- ✓ Pasta `web/src/design/` criada
- ✓ Rota `/design-system` rodando

Estado destravado: **Fase 1b.2 (Shell v2)** pode começar.

- [ ] **Step 5: Commit final** (auto-hook)

---

## Critérios de sucesso da Fase 1b.1

- [ ] `web/index.html` carrega Instrument Serif
- [ ] `web/tailwind.config.js` tem `fontFamily.display`
- [ ] `web/src/index.css` tem 4 níveis de surface (`--bg-app`, `--bg-surface`, `--bg-elevated`, `--bg-elevated-2`)
- [ ] Pasta `web/src/design/` existe com README + index.ts
- [ ] Rota `/design-system` renderiza o styleguide dentro do app
- [ ] `npx tsc --noEmit` zero erros
- [ ] `npx vite build` passa
- [ ] Visual: zero regressão em `/hoje` (mesmo verde, mesmas surfaces)

## Próximos planos

Após Fase 1b.1 OK, escrevemos a **Fase 1b.2 — Shell v2** (SidebarV2 + TopbarV2 + DesktopShell migra v1→v2). Depois 1b.3 (Page primitives), 1b.4 (View patterns), 1b.5 (POC Projetos).

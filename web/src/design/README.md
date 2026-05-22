# LA Organizer Desktop Design System

Pasta de primitivos desktop. **Coexiste com `components/`** — não substitui.

## Estrutura

```
design/
├── shell/        # SidebarV2, TopbarV2 (Fase 1b.2)
├── primitives/   # PageShell, Toolbar, FilterPill, ViewSwitcher,
│                 # DetailDrawer, EmptyStateDesktop, LoadingSkeleton (1b.3)
└── views/        # DenseTable, KanbanBoard, MonthCalendar,
                  # WeekCalendar, TimelineGantt, PersonGrid (1b.4)
```

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

```tsx
import { PageShell } from '../design/primitives/PageShell';
```

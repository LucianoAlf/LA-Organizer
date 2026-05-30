# Design — Bottom Nav customizável

> **Data:** 2026-05-30 · **Sprint:** 27 (pós-financeiro)
> **Trigger:** após o módulo financeiro, o usuário pediu poder escolher quais módulos aparecem nos 5 slots do nav inferior (cabe só 5; Finanças, LA Educa, Inventário, etc. ficam fora pra quem prefere outros atalhos).

---

## 1. Resumo

Permite que cada colaborador escolha **4 dos 5 slots** do bottom nav mobile (o 5º é sempre "Mais", fixo). Persistência por colaborador via nova coluna `user_preferences.bottom_nav_items text[]`. Tela de configuração mora em `/configuracoes → seção "Navegação rápida"`. UX: lista dos slots editáveis com setas ↑↓ + botão "Trocar" que abre picker dos módulos disponíveis (filtrados por permissão). Escopo **exclusivamente o bloco mobile** (`md:hidden grid-cols-5`) do `BottomNav.tsx`. Desktop continua com SidebarV2 intocada.

## 2. Decisões travadas (brainstorm 2026-05-30)

| # | Tema | Decisão |
|---|---|---|
| N1 | Slots | **4 customizáveis + "Mais" fixo no slot 5.** Padrão Spotify/iOS. Mais nunca some — sempre porta de entrada pro resto. |
| N2 | Localização | **Dentro de `/configuracoes` → seção "Navegação rápida"**. Coerente com outras preferências (briefing/quiet hours). |
| N3 | UX | **Reordenar (↑↓) + tocar slot pra trocar.** Tocar "Trocar" abre `AdaptiveSheet` com módulos disponíveis. |
| N4 | Plataforma | **Só bottom nav mobile** (`md:hidden grid-cols-5`). Desktop = SidebarV2 já mostra tudo. |
| N5 | Persistência | **Coluna nova `bottom_nav_items text[]`** em `user_preferences` (default = paths atuais). Paths/slugs, não uuid. `ADD COLUMN … DEFAULT` backfilla linhas existentes. |
| N6 | Catálogo único | **`web/src/lib/navItems.ts`** (slug + label + Icon + matchPaths + `when()`). Consumido SÓ pelo BottomNav (bloco mobile) e pelo NavCustomizer. **SidebarV2 fica intocada** (DRY total pode esperar). |
| N7 | Gating | **Replicar exatamente o gating da SidebarV2:60-100** no `when()` de cada item (role/access/isMentor). Item sem acesso nunca aparece no picker. |
| N8 | Fallback resiliente | Se a pref do usuário inclui slug inválido (sem acesso, rota removida): drop + recomplete com defaults na ordem. **Sempre devolve 4 slots válidos.** |

## 3. Realidade do código (verificada)

- `App.tsx` → `AppLayout` faz `useBreakpoint()`. Mobile → `<AppShell />` (importa BottomNav, renderiza). Desktop → `<DesktopShell />` (importa **SidebarV2**, **não** importa BottomNav).
- `BottomNav.tsx` tem **dois blocos**: `<ul className="grid grid-cols-5 max-w-content mx-auto md:hidden">` (mobile, ativo) e `<ul className="hidden md:flex …">` (desktop, **código morto** no shell atual). Ambos consomem o mesmo array `items`.
- **Risco preventivo:** se eu trocar `items` por dados customizados, **mesmo o bloco desktop morto** passaria a consumir a pref. Quando alguém ressuscitar o desktop nav (refactor futuro), vai herdar comportamento errado.
- **Mitigação travada em N4:** consumo da pref escopado ao bloco `md:hidden`. O bloco `hidden md:flex` continua com a lista hardcoded atual (intocado).

## 4. Arquitetura

```
user_preferences.bottom_nav_items text[]        ← persistência
        ↑                          ↑
        │ upsert                   │ select
        │                          │
  NavCustomizer                useNavPreferences()
  (em Configuracoes)                ↓
                          BottomNav (md:hidden block)
                                    └─→ 4 slots + Mais
```

**Migration:**
```sql
ALTER TABLE user_preferences
  ADD COLUMN bottom_nav_items text[]
  DEFAULT ARRAY['/hoje','/projetos','/checklists','/habitos']::text[];
```
`DEFAULT` backfilla linhas existentes. Sem regen de RLS — já é owner-only via `collaborator_id`.

**Regra (inegociável) — transcrição literal do SidebarV2.** O plano vai **copiar verbatim** do array `sections` em `SidebarV2.tsx:60-110` (linha por linha): `to` (vira `slug`), `label`, `Icon`, `matchPaths` (quando houver) e a condição de gating (vira `when()`). Razão: (a) `slug` precisa bater com a rota real do router pra não 404; (b) `when()` precisa bater com o gating real pra não oferecer módulo que a pessoa não abre nem sumir módulo que ela tem. A lista abaixo é **ilustrativa** — o autoritativo é o que está na SidebarV2 no momento da execução. Inclui também a query `isMentor` com o **mesmo `queryKey: ['is-mentor', collaborator?.id]`** pra compartilhar cache.

**Imports reais (a copiar do SidebarV2):**
```ts
import {
  CalendarDays, Rocket, ClipboardCheck, Sparkles, Wallet,
  Users, BarChart3, Target, Megaphone, Eye, UserCog, ShieldCheck,
  GraduationCap, Music, Package, ShoppingBag,
  CalendarRange, History, Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAccess } from '../hooks/useAccess';
import { hasCoordLevel } from './permissions';
// (ATENÇÃO: `hasCoordLevel` é util do projeto — `lib/permissions.ts:22` —
//  NÃO é ícone lucide. `useAccess` é hook do PWA — `hooks/useAccess.ts:6`.)

export interface NavCatalogItem {
  slug: string;              // path da rota — chave da persistência
  label: string;             // texto exibido (preserva nuances; ex: '/hoje' → "Agenda")
  Icon: LucideIcon;
  matchPaths?: string[];     // ativa o item em rotas relacionadas
  when?: (ctx: NavGateContext) => boolean;  // espelha gating da SidebarV2
}
export interface NavGateContext {
  role: string | null;
  collaborator: { id: string; /* … */ } | null;
  access: { inventario: boolean; loja_produtos: boolean };
  isMentor: boolean;
}

export const NAV_CATALOG: NavCatalogItem[] = [
  // sempre disponíveis
  { slug: '/hoje',          label: 'Agenda',          Icon: CalendarDays,    matchPaths: ['/hoje','/semana'] },
  { slug: '/projetos',      label: 'Projetos',        Icon: Rocket },
  { slug: '/checklists',    label: 'Checklists',      Icon: ClipboardCheck },
  { slug: '/habitos',       label: 'Hábitos',         Icon: Sparkles },
  { slug: '/financeiro',    label: 'Finanças',        Icon: Wallet,          matchPaths: ['/financeiro'] },
  { slug: '/historico',     label: 'Histórico',       Icon: History },
  { slug: '/configuracoes', label: 'Configurações',   Icon: Settings },
  { slug: '/mais/agenda-escolar', label: 'Agenda LA Music', Icon: CalendarRange },

  // gated por role / access (replica SidebarV2)
  { slug: '/time',                      label: 'Dashboard time', Icon: Users,       when: ({role}) => role === 'coordinator' || role === 'director' },
  { slug: '/mais/aderencia-checklists', label: 'Aderência',      Icon: BarChart3,   when: ({role}) => role === 'director' || role === 'manager' },
  { slug: '/mais/operacoes',            label: 'Operações',      Icon: Target,      when: ({role}) => !!role && ['director','coordinator','manager'].includes(role) },
  { slug: '/mais/comunicados',          label: 'Comunicados',    Icon: Megaphone,   when: ({collaborator}) => hasCoordLevel(collaborator) },
  { slug: '/mais/observabilidade',      label: 'Observabilidade',Icon: Eye,         when: ({role}) => role === 'director' || role === 'coordinator' },
  { slug: '/mais/gestao-equipe',        label: 'Gestão equipe',  Icon: UserCog,     when: ({role}) => !!role && ['director','coordinator','manager'].includes(role) },
  { slug: '/mais/governanca',           label: 'Credenciais',    Icon: ShieldCheck, when: ({role}) => role === 'director' },
  { slug: '/la-educa',                  label: 'LA Educa',       Icon: GraduationCap, when: ({role, isMentor}) => !!role && (['coordinator','director'].includes(role) || isMentor) },
  { slug: '/la-journey',                label: 'LA Journey',     Icon: Music,       when: ({role}) => role !== 'manager' },
  { slug: '/inventario',                label: 'Inventário',     Icon: Package,     when: ({access}) => access.inventario },
  { slug: '/inventario/loja',           label: 'Lojinha',        Icon: ShoppingBag, when: ({access}) => access.loja_produtos },
];

export function availableNavItems(ctx: NavGateContext): NavCatalogItem[] {
  return NAV_CATALOG.filter((it) => !it.when || it.when(ctx));
}
export function resolveSlugs(slugs: string[], ctx: NavGateContext): NavCatalogItem[] {
  const avail = availableNavItems(ctx);
  const bySlug = new Map(avail.map((i) => [i.slug, i]));
  const out: NavCatalogItem[] = [];
  for (const s of slugs) {
    const it = bySlug.get(s);
    if (it && !out.find((x) => x.slug === s)) out.push(it);
    if (out.length === 4) break;
  }
  // recomplete: se faltar slot, puxa do default na ordem (sem duplicar)
  const defaults = ['/hoje','/projetos','/checklists','/habitos'];
  for (const s of defaults) {
    if (out.length === 4) break;
    const it = bySlug.get(s);
    if (it && !out.find((x) => x.slug === s)) out.push(it);
  }
  return out;
}
```

**Hook `web/src/hooks/useNavPreferences.ts`:**
```ts
export function useNavPreferences() {
  const { collaborator, role } = useAuth();
  const { allowed: inventario } = useAccess('inventario');
  const { allowed: loja_produtos } = useAccess('loja_produtos');
  const isMentorQ = useQuery({ /* mesma query da SidebarV2 — la_educa_estagiarios count */ });
  const ctx: NavGateContext = { role: role ?? null, collaborator, access: { inventario, loja_produtos }, isMentor: !!isMentorQ.data };

  const prefsQ = useQuery({
    queryKey: ['nav-prefs', collaborator?.id],
    queryFn: async () => {
      const { data } = await supabase.from('user_preferences')
        .select('bottom_nav_items').eq('collaborator_id', collaborator!.id).maybeSingle();
      return data?.bottom_nav_items ?? ['/hoje','/projetos','/checklists','/habitos'];
    },
    enabled: !!collaborator,
  });

  const items = resolveSlugs(prefsQ.data ?? [], ctx);  // SEMPRE 4 itens válidos

  const qc = useQueryClient();
  const setItems = useMutation({
    mutationFn: async (slugs: string[]) => {
      if (!collaborator) throw new Error('sem sessão');
      // upsert: se a linha de prefs ainda não existe, cria
      const { error } = await supabase.from('user_preferences')
        .upsert({ collaborator_id: collaborator.id, bottom_nav_items: slugs }, { onConflict: 'collaborator_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nav-prefs', collaborator?.id] }),
  });

  return { items, available: availableNavItems(ctx), setSlugs: setItems.mutateAsync, saving: setItems.isPending };
}
```

**`BottomNav.tsx` (modificação cirúrgica):**
- Bloco `md:hidden grid-cols-5` (linha ~46): consome `useNavPreferences().items` e adiciona `{ to: '/mais', label: 'Mais', Icon: Menu }` no fim (5º slot fixo).
- Bloco `hidden md:flex` (linha ~70): **NÃO mexer**. Continua usando o array `items` hardcoded. Comentar 1 linha: `// Sprint X — desktop continua com lista hardcoded (DesktopShell usa SidebarV2; este bloco fica como fallback se BottomNav voltar ao desktop).`

**Tela `NavCustomizer.tsx`** (montada em `Configuracoes.tsx`):
- 5 cards listados: 4 editáveis com `↑`/`↓` (desabilitados nos extremos) + botão "Trocar" + remover (vira slot vazio que recompleta com default); o 5º card "Mais" mostrado read-only com label "fixo".
- "Trocar" → `AdaptiveSheet` com lista de `available` (com check ✓ nos já usados); selecionar substitui aquele slot.
- Botão "Restaurar padrão" → `setSlugs(['/hoje','/projetos','/checklists','/habitos'])`.
- Salva em onChange (otimista) — sem botão "Salvar". Toast/visual de "Salvando…" usando `saving`.

## 5. Plano de testes

| Cenário | Esperado |
|---|---|
| Pessoa sem prefs salvas | `items` retorna defaults; bottom nav mostra Agenda/Projetos/Checklists/Hábitos/Mais |
| Trocar slot 4 (Hábitos→Finanças) | reload → continua Finanças no slot 4; nav mobile atualiza |
| Reordenar slot 2 ↔ slot 3 (↑↓) | ordem persistida |
| Coordinator com Dashboard time no nav perde role | item some do nav; `resolveSlugs` recompleta com default (nav nunca fica com <4 slots) |
| Slot 5 (Mais) | sempre presente, sem controles de edição, nunca editável |
| Modo desktop | nada muda — SidebarV2 segue mostrando todos os módulos como antes |
| `bottom_nav_items` com slug duplicado | `resolveSlugs` dedup + recomplete; nunca renderiza 2 do mesmo |
| Bloco `hidden md:flex` do BottomNav | continua hardcoded; não consome pref (defesa preventiva contra resurreição desktop) |

## 6. Segurança / privacidade

- `bottom_nav_items` é preferência pessoal — `user_preferences` é owner-only via `collaborator_id` (RLS existente).
- Slug do path **não é segredo** (rotas são públicas no client), então não há vazamento se outro usuário acessar. Só o que importa: ninguém escreve na linha de outro colaborador (`WITH CHECK` da policy).
- O `when()` no catálogo NÃO é segurança — é UX. A segurança real continua nas rotas (`<ProtectedRoute>`) e nas policies do banco.

## 7. Out of scope

- Customização do top-rail desktop ou da SidebarV2.
- "Mais" customizável (ele é o fallback universal).
- Sugestão automática de slots baseada em uso.
- Sincronização realtime entre abas (v1 só local; reload pega).
- DRY total: refatorar SidebarV2 pra consumir `NAV_CATALOG` (sprint futura, com seu OK; hoje é guardrail "38 rotas sagradas").

## 8. Pontos a confirmar no plano (não bloqueiam design)

- Hook `useAccess` — existe e retorna `{ allowed: boolean }`. Confirmar API exata na execução.
- Posição da query `isMentor` — replicar EXATAMENTE da SidebarV2 (mesmo `queryKey` permite cache compartilhado).
- `Configuracoes.tsx` — qual é o pattern de seções (cards, abas)? Confirmar antes de criar a `NavCustomizer`.
- `useAuth()` retorna `collaborator` undefined no boot → hook tem que ser tolerante (`enabled: !!collaborator`).

---

*Aprovado por Luciano Alf em 30/05/2026 (pendente revisão da spec).*

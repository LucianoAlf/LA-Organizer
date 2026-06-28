// Catálogo único de módulos disponíveis no nav. Espelha verbatim o array `sections`
// de web/src/design/shell/SidebarV2.tsx:60-110. Mudou item lá? Espelha aqui.
//
// SLUGS usados aqui = paths reais do router. SidebarV2 usa '/agenda?view=day' como slug
// do item Agenda no desktop, MAS o BottomNav mobile sempre usou '/hoje'. Mantemos
// '/hoje' aqui (slug do nav mobile + default do banco). matchPaths['/hoje','/semana']
// preserva ativação cross-route do BottomNav atual.
import {
  CalendarDays, Rocket, ClipboardCheck, Sparkles, Wallet,
  Users, BarChart3, Target, Megaphone, Eye, UserCog, ShieldCheck,
  GraduationCap, Music, Package, ShoppingBag,
  CalendarRange, History, Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
// hasCoordLevel é util do projeto (lib/permissions.ts:22), NÃO é ícone lucide.
import { hasCoordLevel } from './permissions';

export interface NavGateContext {
  role: string | null;
  collaborator: Parameters<typeof hasCoordLevel>[0];
  access: { inventario: boolean; loja_produtos: boolean };
  isMentor: boolean;
}

export interface NavCatalogItem {
  slug: string;
  label: string;
  Icon: LucideIcon;
  matchPaths?: string[];
  when?: (ctx: NavGateContext) => boolean;
}

// Transcrição verbatim de SidebarV2:60-110. Não inventar paths nem gating.
export const NAV_CATALOG: NavCatalogItem[] = [
  // Principal (sempre disponível)
  { slug: '/hoje',          label: 'Agenda',          Icon: CalendarDays,    matchPaths: ['/hoje', '/semana', '/mes'] },
  { slug: '/projetos',      label: 'Projetos',        Icon: Rocket },
  { slug: '/checklists',    label: 'Checklists',      Icon: ClipboardCheck },
  { slug: '/habitos',       label: 'Hábitos',         Icon: Sparkles },
  { slug: '/financeiro',    label: 'Finanças',        Icon: Wallet,           matchPaths: ['/financeiro'] },

  // Gestão (gated por role/coord) — replica SidebarV2:67-93
  { slug: '/time',                      label: 'Dashboard time',  Icon: Users,
    when: (c) => c.role === 'coordinator' || c.role === 'director' },
  { slug: '/mais/aderencia-checklists', label: 'Aderência',       Icon: BarChart3,
    when: (c) => c.role === 'director' || c.role === 'manager' },
  { slug: '/mais/operacoes',            label: 'Operações',       Icon: Target,
    when: (c) => !!c.role && ['director', 'coordinator', 'manager'].includes(c.role) },
  { slug: '/mais/comunicados',          label: 'Comunicados',     Icon: Megaphone,
    when: (c) => hasCoordLevel(c.collaborator) },
  { slug: '/mais/observabilidade',      label: 'Observabilidade', Icon: Eye,
    when: (c) => c.role === 'director' || c.role === 'coordinator' },
  { slug: '/mais/gestao-equipe',        label: 'Gestão equipe',   Icon: UserCog,
    when: (c) => !!c.role && ['director', 'coordinator', 'manager'].includes(c.role) },
  { slug: '/mais/governanca',           label: 'Credenciais',     Icon: ShieldCheck,
    when: (c) => c.role === 'director' },

  // Educação (gated) — replica SidebarV2:96-103
  { slug: '/la-educa',   label: 'LA Educa',  Icon: GraduationCap,
    when: (c) => !!c.role && (['coordinator', 'director'].includes(c.role) || c.isMentor) },
  { slug: '/la-journey', label: 'LA Journey', Icon: Music,
    when: (c) => c.role !== 'manager' },

  // Operações (access) — replica SidebarV2:106-110
  { slug: '/inventario',      label: 'Inventário', Icon: Package,
    when: (c) => c.access.inventario },
  { slug: '/inventario/loja', label: 'Lojinha',    Icon: ShoppingBag,
    when: (c) => c.access.loja_produtos },

  // Sistema (sempre disponível)
  { slug: '/mais/agenda-escolar', label: 'Agenda LA Music', Icon: CalendarRange },
  { slug: '/historico',           label: 'Histórico',       Icon: History },
  { slug: '/configuracoes',       label: 'Configurações',   Icon: Settings },
];

export const DEFAULT_NAV_SLUGS = ['/hoje', '/projetos', '/checklists', '/habitos'] as const;

export function availableNavItems(ctx: NavGateContext): NavCatalogItem[] {
  return NAV_CATALOG.filter((it) => !it.when || it.when(ctx));
}

// Resolve uma lista de slugs em itens válidos. SEMPRE devolve EXATAMENTE 4 itens:
// - dedup (sem duplicar)
// - filtra slugs sem permissão / inválidos
// - recompleta com DEFAULT_NAV_SLUGS na ordem (sem repetir o que já entrou)
export function resolveSlugs(slugs: string[], ctx: NavGateContext): NavCatalogItem[] {
  const avail = availableNavItems(ctx);
  const bySlug = new Map(avail.map((i) => [i.slug, i] as const));
  const out: NavCatalogItem[] = [];
  const seen = new Set<string>();
  for (const s of slugs) {
    if (out.length === 4) break;
    if (seen.has(s)) continue;
    const it = bySlug.get(s);
    if (!it) continue;
    out.push(it);
    seen.add(s);
  }
  for (const s of DEFAULT_NAV_SLUGS) {
    if (out.length === 4) break;
    if (seen.has(s)) continue;
    const it = bySlug.get(s);
    if (!it) continue;
    out.push(it);
    seen.add(s);
  }
  return out;
}

# Foundation 1b.2 — Shell V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir Sidebar e Topbar do DesktopShell por variantes V2 com quick search placeholder, grupos colapsáveis, breadcrumb dinâmico, bell de notificações e CTA Quick Add.

**Architecture:** `SidebarV2` e `TopbarV2` vivem em `web/src/design/shell/` como componentes auto-contidos. `DesktopShell.tsx` é atualizado para importá-los. `Sidebar.tsx` e `Topbar.tsx` originais ficam intactos (preservados para migração gradual de telas). `AppShell` (mobile) não é tocado.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3.4, React Router v6 (`useLocation`, `NavLink`), Lucide React, TanStack Query 5, Supabase

---

## Mapa de arquivos

| Ação | Caminho |
|------|---------|
| Criar | `web/src/design/shell/SidebarV2.tsx` |
| Criar | `web/src/design/shell/TopbarV2.tsx` |
| Modificar | `web/src/design/index.ts` |
| Modificar | `web/src/components/DesktopShell.tsx` |

## Tokens e classes disponíveis

Tailwind custom config em `web/tailwind.config.js`:

- Superfícies: `bg-bg-app`, `bg-bg-surface`, `bg-bg-elevated`, `bg-bg-elevated-2`, `bg-bg-subtle`
- Texto: `text-fg`, `text-fg-secondary`, `text-fg-muted`
- Borda: `border-border`
- Tom verde: `bg-tom`, `text-tom`, `border-tom`, `bg-tom/10`, `border-tom/40`
- Perigo: `text-danger`, `bg-danger/10`
- Utilitário: `.focus-ring`, `.surface`, `shadow-soft`
- Fonte display: `font-display` → Instrument Serif

---

### Task 1: SidebarV2.tsx

Sidebar V2 com quick search placeholder (⌘K), grupos colapsáveis, user footer chip e collapse toggle integrado ao footer. Lógica role-based idêntica ao `Sidebar.tsx`.

**Files:**
- Create: `web/src/design/shell/SidebarV2.tsx`

- [ ] **Step 1: Criar o arquivo**

Criar `web/src/design/shell/SidebarV2.tsx` com o seguinte conteúdo completo:

```tsx
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays, Rocket, ClipboardCheck, Sparkles,
  Users, BarChart3, Target, Megaphone, Eye, UserCog,
  GraduationCap, Music,
  Package, ShoppingBag,
  CalendarRange, History, Settings,
  ChevronLeft, ChevronRight, ChevronDown,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAccess } from '../../hooks/useAccess';
import { supabase } from '../../lib/supabase';

interface SidebarV2Props {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  matchPaths?: string[];
}

interface SectionDef {
  key: string;
  label: string;
  items: NavItem[];
}

export function SidebarV2({ collapsed = false, onToggleCollapse }: SidebarV2Props) {
  const { collaborator, role } = useAuth();
  const location = useLocation();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const { data: isMentor = false } = useQuery({
    queryKey: ['is-mentor', collaborator?.id],
    queryFn: async () => {
      if (!collaborator) return false;
      const { count } = await supabase
        .from('la_educa_estagiarios')
        .select('id', { count: 'exact', head: true })
        .eq('mentor_id', collaborator.id);
      return (count ?? 0) > 0;
    },
    enabled: !!collaborator,
  });

  const { allowed: showInventario } = useAccess('inventario');
  const { allowed: showLoja } = useAccess('loja_produtos');

  const sections: SectionDef[] = [
    {
      key: 'principal',
      label: 'Principal',
      items: [
        { to: '/hoje', label: 'Agenda', Icon: CalendarDays, matchPaths: ['/hoje', '/semana'] },
        { to: '/projetos', label: 'Projetos', Icon: Rocket },
        { to: '/checklists', label: 'Checklists', Icon: ClipboardCheck },
        { to: '/habitos', label: 'Hábitos', Icon: Sparkles },
      ],
    },
    {
      key: 'gestao',
      label: 'Gestão',
      items: [
        ...(role === 'coordinator' || role === 'director'
          ? [{ to: '/time', label: 'Dashboard time', Icon: Users } as NavItem]
          : []),
        ...(role === 'director' || role === 'manager'
          ? [{ to: '/mais/aderencia-checklists', label: 'Aderência', Icon: BarChart3 } as NavItem]
          : []),
        ...(role && ['director', 'coordinator', 'manager'].includes(role)
          ? [{ to: '/mais/operacoes', label: 'Operações', Icon: Target } as NavItem]
          : []),
        ...(role === 'director' || role === 'coordinator'
          ? [{ to: '/mais/comunicados', label: 'Comunicados', Icon: Megaphone } as NavItem]
          : []),
        ...(role === 'director' || role === 'coordinator'
          ? [{ to: '/mais/observabilidade', label: 'Observabilidade', Icon: Eye } as NavItem]
          : []),
        ...(role && ['director', 'coordinator', 'manager'].includes(role)
          ? [{ to: '/mais/gestao-equipe', label: 'Gestão equipe', Icon: UserCog } as NavItem]
          : []),
      ],
    },
    {
      key: 'educacao',
      label: 'Educação',
      items: [
        ...(role && (['coordinator', 'director'].includes(role) || isMentor)
          ? [{ to: '/la-educa', label: 'LA Educa', Icon: GraduationCap } as NavItem]
          : []),
        ...(role !== 'manager'
          ? [{ to: '/la-journey', label: 'LA Journey', Icon: Music } as NavItem]
          : []),
      ],
    },
    {
      key: 'operacoes',
      label: 'Operações',
      items: [
        ...(showInventario
          ? [{ to: '/inventario', label: 'Inventário', Icon: Package } as NavItem]
          : []),
        ...(showLoja
          ? [{ to: '/inventario/loja', label: 'Lojinha', Icon: ShoppingBag } as NavItem]
          : []),
      ],
    },
    {
      key: 'sistema',
      label: 'Sistema',
      items: [
        { to: '/mais/agenda-escolar', label: 'Agenda LA Music', Icon: CalendarRange },
        { to: '/historico', label: 'Histórico', Icon: History },
        { to: '/configuracoes', label: 'Configurações', Icon: Settings },
      ],
    },
  ];

  function isItemActive(item: NavItem, defaultActive: boolean): boolean {
    if (item.matchPaths) return item.matchPaths.some(p => location.pathname.startsWith(p));
    return defaultActive;
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const displayName = collaborator?.preferred_name || collaborator?.full_name || '';
  const avatarUrl = collaborator?.avatar_url;
  const width = collapsed ? 64 : 240;

  return (
    <aside
      className="fixed top-0 left-0 bottom-0 z-40 bg-bg-surface border-r border-border flex flex-col"
      style={{ width }}
      aria-label="Navegação lateral"
    >
      {/* Header — TOM avatar + label */}
      <div
        className={[
          'h-14 flex items-center border-b border-border shrink-0',
          collapsed ? 'justify-center px-2' : 'gap-3 px-4',
        ].join(' ')}
      >
        <img
          src="/Avata-Tom.png"
          alt="TOM"
          className="w-8 h-8 rounded-full object-cover shrink-0"
        />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-fg leading-tight">TOM</div>
            <div className="text-[10px] text-fg-muted leading-tight">LA Organizer</div>
          </div>
        )}
      </div>

      {/* Quick search — visível só no modo expandido */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <button
            type="button"
            className="w-full flex items-center gap-2 h-8 px-3 rounded-md bg-bg-elevated border border-border text-fg-muted text-[12px] hover:border-tom/40 transition-colors focus-ring"
            aria-label="Pesquisa rápida (⌘K)"
          >
            <Search size={13} />
            <span className="flex-1 text-left">Buscar...</span>
            <kbd className="text-[10px] opacity-50 font-mono">⌘K</kbd>
          </button>
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-2">
        {sections.map(section => {
          if (section.items.length === 0) return null;
          const isGroupCollapsed = !collapsed && collapsedGroups.has(section.key);
          return (
            <div key={section.key} className="mb-1">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(section.key)}
                  className="w-full flex items-center justify-between px-4 py-1 text-[10px] uppercase tracking-wider text-fg-muted/60 font-semibold hover:text-fg-muted transition-colors"
                >
                  {section.label}
                  <ChevronDown
                    size={11}
                    className={`transition-transform duration-150 ${isGroupCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              )}
              {!isGroupCollapsed && (
                <ul className="space-y-0.5 px-2">
                  {section.items.map(item => {
                    const { to, label, Icon } = item;
                    return (
                      <li key={to}>
                        <NavLink
                          to={to}
                          title={collapsed ? label : undefined}
                          className={({ isActive: navActive }) => {
                            const active = isItemActive(item, navActive);
                            const base = collapsed
                              ? 'flex items-center justify-center h-9 rounded-md transition-colors focus-ring'
                              : 'flex items-center gap-3 h-9 px-3 rounded-md transition-colors focus-ring';
                            const state = active
                              ? 'bg-tom/10 border-l-2 border-tom text-fg'
                              : 'text-fg-muted hover:bg-bg-elevated hover:text-fg';
                            return [base, state].join(' ');
                          }}
                        >
                          <Icon size={17} />
                          {!collapsed && (
                            <span className="text-[13px] font-medium truncate">{label}</span>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* User footer chip + collapse toggle */}
      <div className="border-t border-border shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-6 h-6 rounded-full bg-bg-elevated border border-border overflow-hidden shrink-0 grid place-items-center">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span className="text-[10px] font-bold text-fg-muted">{displayName[0] ?? '?'}</span>
              }
            </div>
            <span className="text-[12px] text-fg-muted truncate flex-1">
              {displayName || 'Usuário'}
            </span>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Recolher sidebar"
                aria-label="Recolher sidebar"
                className="w-6 h-6 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors shrink-0"
              >
                <ChevronLeft size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center py-2 gap-1.5">
            <div className="w-6 h-6 rounded-full bg-bg-elevated border border-border overflow-hidden grid place-items-center">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span className="text-[10px] font-bold text-fg-muted">{displayName[0] ?? '?'}</span>
              }
            </div>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Expandir sidebar"
                aria-label="Expandir sidebar"
                className="w-6 h-6 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

Expected: zero erros. Se houver erro de caminho, verificar que os imports `../../contexts/`, `../../hooks/`, `../../lib/` estão corretos (dois níveis acima de `design/shell/`).

- [ ] **Step 3: Commit**

```powershell
cd D:\la-organizer\_remote; git -C C:\la-deploy-work add web/src/design/shell/SidebarV2.tsx; git -C C:\la-deploy-work commit -m "feat: add SidebarV2 with quick search + collapsible groups + user footer chip"
```

> Nota: commits são feitos no worktree `C:\la-deploy-work` (repositório git real). Arquivos fonte ficam em `D:\la-organizer\_remote\` — o auto-deploy sync as two locations.

---

### Task 2: TopbarV2.tsx

Topbar V2 com breadcrumb dinâmico, bell placeholder, Quick Add CTA (prop `onQuickAdd`), toggle de tema movido para o dropdown do avatar. Avatar dropdown idêntico ao `Topbar.tsx` (foto, senha, sair).

**Files:**
- Create: `web/src/design/shell/TopbarV2.tsx`

- [ ] **Step 1: Criar o arquivo**

Criar `web/src/design/shell/TopbarV2.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Camera, Lock, Settings, LogOut, User, Bell, Plus, Sun, Moon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';

const ROUTE_LABELS: Record<string, string> = {
  '/hoje': 'Agenda',
  '/semana': 'Agenda',
  '/projetos': 'Projetos',
  '/checklists': 'Checklists',
  '/habitos': 'Hábitos',
  '/time': 'Dashboard time',
  '/mais/aderencia-checklists': 'Aderência',
  '/mais/operacoes': 'Operações',
  '/mais/comunicados': 'Comunicados',
  '/mais/observabilidade': 'Observabilidade',
  '/mais/gestao-equipe': 'Gestão equipe',
  '/la-educa': 'LA Educa',
  '/la-journey': 'LA Journey',
  '/inventario/loja': 'Lojinha',
  '/inventario': 'Inventário',
  '/mais/agenda-escolar': 'Agenda LA Music',
  '/historico': 'Histórico',
  '/configuracoes': 'Configurações',
  '/mais/perfil': 'Perfil',
  '/design-system': 'Design System',
};

function getRouteLabel(pathname: string): string {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  // Longest-prefix match for nested routes (e.g. /inventario/loja/item → Lojinha)
  const sorted = Object.keys(ROUTE_LABELS).sort((a, b) => b.length - a.length);
  for (const path of sorted) {
    if (pathname.startsWith(path + '/')) return ROUTE_LABELS[path];
  }
  return 'LA Organizer';
}

function initials(name: string | null | undefined): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

interface TopbarV2Props {
  sidebarCollapsed?: boolean;
  onQuickAdd?: () => void;
}

export function TopbarV2({ sidebarCollapsed = false, onQuickAdd }: TopbarV2Props) {
  const { collaborator, signOut, updateProfile, sendMagicLink } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [pw, setPw] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;
  const avatarUrl = collaborator?.avatar_url;
  const fullName = collaborator?.preferred_name || collaborator?.full_name || '';
  const routeLabel = getRouteLabel(pathname);

  useEffect(() => {
    if (!pwModal) { setPw(''); setPwConfirm(''); }
  }, [pwModal]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !collaborator?.id) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${collaborator.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatar_url = `${urlData.publicUrl}?t=${Date.now()}`;
      await updateProfile({ avatar_url });
      showToast({ kind: 'success', title: 'Foto atualizada!' });
    } catch (err) {
      showToast({ kind: 'error', title: 'Erro ao enviar foto', msg: (err as Error).message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handlePasswordChange() {
    if (pw.length < 6) {
      showToast({ kind: 'error', title: 'Senha deve ter ao menos 6 caracteres' });
      return;
    }
    if (pw !== pwConfirm) {
      showToast({ kind: 'error', title: 'Senhas não coincidem' });
      return;
    }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwLoading(false);
    if (error) {
      showToast({ kind: 'error', title: 'Erro', msg: error.message });
      return;
    }
    showToast({ kind: 'success', title: 'Senha alterada!' });
    setPwModal(false);
  }

  return (
    <>
      <header
        className="fixed top-0 right-0 h-14 bg-bg-surface border-b border-border z-30 flex items-center justify-between px-4 lg:px-6 transition-[left] duration-200"
        style={{ left: sidebarWidth }}
      >
        {/* Breadcrumb */}
        <h1 className="text-[14px] font-semibold text-fg truncate">
          {routeLabel}
        </h1>

        {/* Actions: bell + quick add + avatar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Bell — placeholder, sem ação por ora */}
          <button
            type="button"
            aria-label="Notificações"
            className="h-8 w-8 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated border border-border transition-colors focus-ring"
          >
            <Bell size={15} />
          </button>

          {/* Quick Add */}
          <button
            type="button"
            onClick={onQuickAdd}
            aria-label="Adicionar"
            className="h-8 flex items-center gap-1.5 px-3 rounded-md bg-tom text-white text-[12px] font-semibold hover:opacity-90 transition-opacity focus-ring"
          >
            <Plus size={14} />
            Adicionar
          </button>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

          {/* Avatar + dropdown */}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Abrir menu de perfil"
              aria-expanded={menuOpen}
              title={fullName}
              className="h-8 w-8 grid place-items-center rounded-full bg-bg-elevated border border-border overflow-hidden focus-ring transition-colors hover:bg-bg-subtle relative"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={fullName} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[11px] font-bold text-fg">{initials(fullName)}</span>
              )}
              {uploading && (
                <span className="absolute inset-0 bg-black/50 grid place-items-center rounded-full">
                  <span className="text-white text-[10px]">…</span>
                </span>
              )}
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-64 rounded-md bg-bg-surface border border-border shadow-soft py-1 z-50"
              >
                {/* Perfil header */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-bg-elevated border border-border overflow-hidden shrink-0 grid place-items-center">
                    {avatarUrl
                      ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      : <span className="text-xs font-bold">{initials(fullName)}</span>
                    }
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{fullName || 'Sem nome'}</div>
                    <div className="text-[12px] text-fg-muted truncate">{collaborator?.email ?? '—'}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <Camera size={15} className="text-fg-muted" />
                  {uploading ? 'Enviando…' : 'Trocar foto'}
                </button>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setPwModal(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <Lock size={15} className="text-fg-muted" /> Mudar senha
                </button>

                <Link
                  to="/mais/perfil"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <User size={15} className="text-fg-muted" /> Perfil
                </Link>

                <Link
                  to="/configuracoes"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <Settings size={15} className="text-fg-muted" /> Configurações
                </Link>

                {/* Tema — movido do topbar para cá no V2 */}
                <button
                  type="button"
                  onClick={() => { toggle(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  {theme === 'dark'
                    ? <Sun size={15} className="text-fg-muted" />
                    : <Moon size={15} className="text-fg-muted" />
                  }
                  {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
                </button>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-danger hover:bg-danger/10 focus-ring border-t border-border mt-1 pt-2"
                >
                  <LogOut size={15} /> Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Modal de mudar senha */}
      {pwModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={e => { if (e.target === e.currentTarget) setPwModal(false); }}
        >
          <div className="w-full max-w-sm bg-bg-surface border border-border rounded-xl shadow-soft p-6 space-y-4">
            <h2 className="text-[16px] font-bold">Mudar senha</h2>
            <div className="space-y-2">
              <input
                type="password"
                placeholder="Nova senha (mín. 6 caracteres)"
                value={pw}
                onChange={e => setPw(e.target.value)}
                autoFocus
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-[14px] focus-ring outline-none"
              />
              <input
                type="password"
                placeholder="Confirmar nova senha"
                value={pwConfirm}
                onChange={e => setPwConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePasswordChange()}
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-[14px] focus-ring outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPwModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-border text-[13px] font-medium hover:bg-bg-elevated transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handlePasswordChange}
                disabled={pwLoading}
                className="flex-1 py-2.5 rounded-lg bg-tom text-white text-[13px] font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {pwLoading ? 'Salvando…' : 'Salvar senha'}
              </button>
            </div>
            <p className="text-center text-[12px] text-fg-muted">
              Esqueceu a senha?{' '}
              <button
                type="button"
                onClick={async () => {
                  if (!collaborator?.phone) return;
                  await sendMagicLink(collaborator.phone);
                  showToast({ kind: 'success', title: 'Link enviado no WhatsApp!' });
                  setPwModal(false);
                }}
                className="text-tom underline"
              >
                Receber link no WhatsApp
              </button>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

Expected: zero erros. Se `showToast` não encontrado: confirmar que o export `showToast` existe em `web/src/components/Toast.tsx` (já existe no app).

- [ ] **Step 3: Commit**

```powershell
cd D:\la-organizer\_remote; git -C C:\la-deploy-work add web/src/design/shell/TopbarV2.tsx; git -C C:\la-deploy-work commit -m "feat: add TopbarV2 with breadcrumb, bell, Quick Add and avatar dropdown"
```

---

### Task 3: Atualizar design/index.ts

Exportar os novos componentes do barrel do design system.

**Files:**
- Modify: `web/src/design/index.ts`

- [ ] **Step 1: Substituir o conteúdo**

Substituir o conteúdo de `web/src/design/index.ts` por:

```ts
export { SidebarV2 } from './shell/SidebarV2';
export { TopbarV2 } from './shell/TopbarV2';
```

- [ ] **Step 2: Verificar TypeScript**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 3: Commit**

```powershell
cd D:\la-organizer\_remote; git -C C:\la-deploy-work add web/src/design/index.ts; git -C C:\la-deploy-work commit -m "chore: export SidebarV2 and TopbarV2 from design barrel"
```

---

### Task 4: Migrar DesktopShell para V2

Trocar imports de `Sidebar`/`Topbar` por `SidebarV2`/`TopbarV2`. Arquivos originais preservados.

**Files:**
- Modify: `web/src/components/DesktopShell.tsx`

- [ ] **Step 1: Trocar imports**

Em `web/src/components/DesktopShell.tsx`, substituir as linhas:

```tsx
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
```

Por:

```tsx
import { SidebarV2 } from '../design/shell/SidebarV2';
import { TopbarV2 } from '../design/shell/TopbarV2';
```

- [ ] **Step 2: Trocar o JSX**

Substituir no JSX:

```tsx
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={isTablet ? undefined : () => setUserCollapsed(v => !v)}
      />
      <Topbar sidebarCollapsed={collapsed} />
```

Por:

```tsx
      <SidebarV2
        collapsed={collapsed}
        onToggleCollapse={isTablet ? undefined : () => setUserCollapsed(v => !v)}
      />
      <TopbarV2 sidebarCollapsed={collapsed} />
```

O arquivo final de `web/src/components/DesktopShell.tsx` deve ficar assim:

```tsx
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarV2 } from '../design/shell/SidebarV2';
import { TopbarV2 } from '../design/shell/TopbarV2';
import { AgendaTabs } from './AgendaTabs';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ToastHost } from './Toast';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

const AGENDA_PATHS = ['/hoje', '/semana'];
const SIDEBAR_COLLAPSED_KEY = 'la-sidebar-collapsed';

function isAgendaRoute(pathname: string): boolean {
  return AGENDA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function DesktopShell() {
  const bp = useBreakpoint();
  const { pathname } = useLocation();
  const isTablet = bp === 'tablet';

  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(userCollapsed));
  }, [userCollapsed]);

  const collapsed = isTablet || userCollapsed;
  const sidebarWidth = collapsed ? 64 : 240;
  const showAgendaTabs = isAgendaRoute(pathname);

  const { collaborator } = useAuth();
  useRealtimeSync(collaborator?.id);

  return (
    <div className="min-h-screen bg-bg-app text-fg">
      <SidebarV2
        collapsed={collapsed}
        onToggleCollapse={isTablet ? undefined : () => setUserCollapsed(v => !v)}
      />
      <TopbarV2 sidebarCollapsed={collapsed} />
      <main
        className="pt-14 min-h-screen"
        style={{ marginLeft: sidebarWidth }}
      >
        {showAgendaTabs && (
          <div className="w-full px-6 lg:px-10 pt-6">
            <AgendaTabs />
          </div>
        )}
        <div className="w-full px-4 md:px-6 lg:px-10 py-6">
          <Outlet />
        </div>
      </main>
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      <ToastHost />
    </div>
  );
}
```

- [ ] **Step 3: Verificar TypeScript**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

Expected: zero erros. `Sidebar.tsx` e `Topbar.tsx` não foram deletados — continuam compilando.

- [ ] **Step 4: Build de produção**

```powershell
cd D:\la-organizer\_remote\web; npx vite build
```

Expected: build conclui sem erros. Warnings de chunk size são OK.

- [ ] **Step 5: Commit**

```powershell
cd D:\la-organizer\_remote; git -C C:\la-deploy-work add web/src/components/DesktopShell.tsx; git -C C:\la-deploy-work commit -m "feat: migrate DesktopShell to SidebarV2 + TopbarV2"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ `SidebarV2.tsx` em `web/src/design/shell/`
- ✅ Quick search ⌘K placeholder (Task 1, bloco `{!collapsed && ...}`)
- ✅ Grupos colapsáveis com `ChevronDown` e `collapsedGroups` state (Task 1)
- ✅ Item ativo: `bg-tom/10 border-l-2 border-tom text-fg` (idêntico ao v1, Task 1)
- ✅ `TopbarV2.tsx` em `web/src/design/shell/`
- ✅ Breadcrumb dinâmico via `getRouteLabel(pathname)` (Task 2)
- ✅ Bell icon placeholder (Task 2)
- ✅ Quick Add CTA verde tom, prop `onQuickAdd` opcional (Task 2)
- ✅ Avatar dropdown completo: foto, senha, perfil, configurações, tema, sair (Task 2)
- ✅ `DesktopShell.tsx` migrado para V2 (Task 4)
- ✅ `Sidebar.tsx` e `Topbar.tsx` preservados intactos
- ✅ `AppShell` (mobile) não tocado

**2. Placeholder scan:** Nenhum TBD, TODO, "implementar depois". Todo código está completo.

**3. Type consistency:**
- `SidebarV2Props`: `collapsed` + `onToggleCollapse` — mesma interface do `Sidebar.tsx` ✓
- `TopbarV2Props`: `sidebarCollapsed` + `onQuickAdd` — `sidebarCollapsed` igual ao `Topbar.tsx` ✓
- `DesktopShell.tsx` passa `collapsed` → `SidebarV2` ✓ e `sidebarCollapsed={collapsed}` → `TopbarV2` ✓
- Import paths de `design/shell/` para `contexts/`, `hooks/`, `lib/`, `components/` usam `../../` ✓

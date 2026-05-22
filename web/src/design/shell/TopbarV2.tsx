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
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
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
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        showToast({ kind: 'error', title: 'Erro', msg: error.message });
        return;
      }
      showToast({ kind: 'success', title: 'Senha alterada!' });
      setPwModal(false);
    } finally {
      setPwLoading(false);
    }
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
                  role="menuitem"
                  onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <Camera size={15} className="text-fg-muted" />
                  {uploading ? 'Enviando…' : 'Trocar foto'}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setPwModal(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <Lock size={15} className="text-fg-muted" /> Mudar senha
                </button>

                <Link
                  to="/mais/perfil"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <User size={15} className="text-fg-muted" /> Perfil
                </Link>

                <Link
                  to="/configuracoes"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-elevated focus-ring"
                >
                  <Settings size={15} className="text-fg-muted" /> Configurações
                </Link>

                {/* Tema — movido do topbar para cá no V2 */}
                <button
                  type="button"
                  role="menuitem"
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
                  role="menuitem"
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
                  try {
                    await sendMagicLink(collaborator.phone);
                    showToast({ kind: 'success', title: 'Link enviado no WhatsApp!' });
                    setPwModal(false);
                  } catch {
                    showToast({ kind: 'error', title: 'Erro ao enviar link' });
                  }
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

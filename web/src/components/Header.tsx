import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Lock, Settings, LogOut, User, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Boa noite';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dateLong(): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
    timeZone: 'America/Sao_Paulo',
  });
  const s = fmt.format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function initials(name: string | null | undefined) {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

// Sprint 22.10 — TOM flutuante (sem fundo) + avatar do user maior, clicável,
// abre menu de perfil (foto, senha, config, sair). Tagline removida.
export function Header() {
  const { collaborator, role, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstName = collaborator?.full_name?.split(' ')[0] ?? '';

  // Fecha o menu ao clicar fora.
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

  return (
    <header className="w-full max-w-content mx-auto px-md pt-md">
      <div className="flex items-center gap-md">
        {/* Avatar TOM — flutuante, sem fundo */}
        <div className="h-14 w-14 shrink-0 grid place-items-center" aria-label="TOM, seu agente" title="TOM">
          {avatarFailed ? (
            <span className="text-3xl" aria-hidden>👽</span>
          ) : (
            <img
              src="/tom-avatar.png"
              alt="TOM"
              className="h-full w-full object-contain"
              onError={() => setAvatarFailed(true)}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-body-sm text-fg-muted mt-0.5">{dateLong()}</p>
        </div>

        {/* Toggle dark/light + Avatar do user */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            className="h-8 w-8 grid place-items-center rounded-full bg-bg-elevated border border-border text-fg-muted focus-ring transition-colors hover:bg-bg-subtle"
          >
            {theme === 'dark'
              ? <Sun size={14} />
              : <Moon size={14} />
            }
          </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Abrir menu de perfil"
            aria-expanded={menuOpen}
            title={role ? `${collaborator?.full_name} (${role})` : collaborator?.full_name ?? ''}
            className="h-11 w-11 grid place-items-center rounded-full bg-bg-elevated border border-border text-xs font-bold text-fg focus-ring transition-colors hover:bg-bg-subtle"
          >
            {initials(collaborator?.full_name)}
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-56 rounded-md bg-bg-surface border border-border shadow-soft py-1 z-30"
            >
              <div className="px-3 py-2 border-b border-border">
                <div className="text-body-sm font-semibold truncate">{collaborator?.full_name ?? 'Sem nome'}</div>
                <div className="text-body-sm text-fg-muted truncate">{role ?? '—'}</div>
              </div>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); alert('Trocar foto: em breve.'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
              >
                <Camera size={16} className="text-fg-muted" /> Trocar foto
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); alert('Mudar senha: em breve.'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
              >
                <Lock size={16} className="text-fg-muted" /> Mudar senha
              </button>
              <Link
                to="/mais"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
              >
                <User size={16} className="text-fg-muted" /> Perfil
              </Link>
              <Link
                to="/configuracoes"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
              >
                <Settings size={16} className="text-fg-muted" /> Configurações
              </Link>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-body-sm text-danger hover:bg-danger/10 focus-ring border-t border-border mt-1 pt-2"
              >
                <LogOut size={16} /> Sair
              </button>
            </div>
          )}
        </div>
        </div>{/* fim flex toggle+avatar */}
      </div>
    </header>
  );
}

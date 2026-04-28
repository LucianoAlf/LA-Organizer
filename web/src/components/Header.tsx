import { Sun, Moon, LogOut } from 'lucide-react';
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

export function Header() {
  const { collaborator, signOut, role } = useAuth();
  const { theme, toggle } = useTheme();
  const firstName = collaborator?.full_name?.split(' ')[0] ?? '';

  return (
    <header className="w-full max-w-content mx-auto px-md pt-md">
      <div className="flex items-center justify-between gap-md">
        <div className="min-w-0">
          <h1 className="text-screen-title leading-tight">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-body-sm text-fg-muted mt-1">{dateLong()}</p>
        </div>
        <div className="flex items-center gap-sm">
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Mudar para claro' : 'Mudar para escuro'}
            className="h-10 w-10 grid place-items-center rounded-full bg-bg-surface border border-border focus-ring"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sair"
            title="Sair"
            className="h-10 w-10 grid place-items-center rounded-full bg-bg-surface border border-border focus-ring"
          >
            <LogOut size={18} />
          </button>
          <div
            className="h-10 w-10 grid place-items-center rounded-full bg-brand text-white text-label tracking-wide"
            aria-label={collaborator?.full_name ?? 'avatar'}
            title={role ? `${collaborator?.full_name} (${role})` : collaborator?.full_name ?? ''}
          >
            {initials(collaborator?.full_name)}
          </div>
        </div>
      </div>
    </header>
  );
}

import { useAuth } from '../contexts/AuthContext';

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

// Sprint 22.5 — header limpo: removidos toggle de tema e botão Sair (redundantes
// com a tela Mais). Mantém só identidade (saudação + data + avatar).
export function Header() {
  const { collaborator, role } = useAuth();
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
        <div
          className="h-10 w-10 grid place-items-center rounded-full bg-brand text-white text-label tracking-wide shrink-0"
          aria-label={collaborator?.full_name ?? 'avatar'}
          title={role ? `${collaborator?.full_name} (${role})` : collaborator?.full_name ?? ''}
        >
          {initials(collaborator?.full_name)}
        </div>
      </div>
    </header>
  );
}

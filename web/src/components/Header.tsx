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

// Sprint 22.8 — microcopy do TOM rotaciona por dia (estável intra-dia).
const TOM_TAGLINES = [
  'Vamos arrasar hoje?',
  'Tô aqui pra te ajudar.',
  'Bora pro próximo?',
  'Tá tudo sob controle.',
  'Manda ver, parceiro.',
  'O que vamos resolver hoje?',
  'Tô de olho no seu dia.',
];
function todayTagline(): string {
  const today = new Date();
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  return TOM_TAGLINES[dayOfYear % TOM_TAGLINES.length];
}

// Sprint 22.8 — TOM como identidade primária no header. Cara do agente à esquerda
// (placeholder 👽 verde até PNG oficial entrar via /tom-avatar.png), avatar do user
// à direita menor. Tagline rotativa do TOM dá sensação de presença.
export function Header() {
  const { collaborator, role } = useAuth();
  const firstName = collaborator?.full_name?.split(' ')[0] ?? '';

  return (
    <header className="w-full max-w-content mx-auto px-md pt-md">
      <div className="flex items-center gap-md">
        {/* Avatar TOM — placeholder até PNG entrar */}
        <div
          className="h-12 w-12 shrink-0 grid place-items-center rounded-full bg-tom text-2xl shadow-card"
          aria-label="TOM, seu agente"
          title="TOM"
        >
          <span aria-hidden>👽</span>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-screen-title leading-tight">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-body-sm text-fg-muted mt-0.5">
            {dateLong()} <span className="text-tom">· {todayTagline()}</span>
          </p>
        </div>

        {/* Avatar do user — menor, direita */}
        <div
          className="h-8 w-8 grid place-items-center rounded-full bg-bg-elevated border border-border text-body-sm font-semibold text-fg shrink-0"
          aria-label={collaborator?.full_name ?? 'avatar'}
          title={role ? `${collaborator?.full_name} (${role})` : collaborator?.full_name ?? ''}
        >
          {initials(collaborator?.full_name)}
        </div>
      </div>
    </header>
  );
}

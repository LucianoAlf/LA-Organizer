import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { LogoMark } from '../components/LogoMark';

export function Login() {
  const { session, signIn, loading } = useAuth();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) {
    const dest = location.state?.from?.pathname || '/hoje';
    return <Navigate to={dest} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (error) setError('Não consegui entrar. Confere o e-mail e a senha.');
  }

  return (
    <div className="min-h-screen flex flex-col bg-ink-0 text-ink-1000">
      {/* Hero half — brand-strong, halftone subtle, watermark "LA" */}
      <section className="relative flex-1 flex items-end overflow-hidden">
        <div className="absolute inset-0 halftone-soft" aria-hidden />
        <div
          aria-hidden
          className="absolute -right-12 -top-8 select-none pointer-events-none"
          style={{
            fontFamily: 'Prompt, sans-serif',
            fontSize: '320px',
            fontWeight: 900,
            color: 'transparent',
            WebkitTextStroke: '2px rgba(233, 20, 81, 0.18)',
            letterSpacing: '-12px',
            lineHeight: 1,
          }}
        >
          LA
        </div>
        <div className="relative z-10 px-md pb-2xl w-full max-w-content mx-auto">
          <div className="flex items-center gap-md mb-md">
            <LogoMark size={48} />
            <div>
              <div className="text-label uppercase tracking-widest text-ink-500">LA Music School</div>
              <div className="text-card-title">Organizer</div>
            </div>
          </div>
          <h1 className="text-h1-brand leading-[0.95] max-w-[10ch]">
            <span className="text-brand">Bom</span> dia<br/>
            de produção.
          </h1>
          <p className="mt-md text-body-md text-ink-600 max-w-[42ch]">
            O espelho visual do TOM. Suas tarefas, seus projetos, seu time — em um lugar só.
          </p>
        </div>
      </section>

      {/* Form half — clean, operational */}
      <section className="bg-ink-50 border-t border-ink-200 px-md pt-xl pb-xl">
        <form onSubmit={onSubmit} className="w-full max-w-content mx-auto space-y-md">
          <div className="space-y-1">
            <label htmlFor="email" className="text-label uppercase tracking-wide text-ink-500">E-mail</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full h-12 px-3 rounded-sm bg-ink-100 border border-ink-200 text-ink-1000 placeholder:text-ink-400 focus-ring"
              placeholder="voce@lamusic.com.br"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-label uppercase tracking-wide text-ink-500">Senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-12 px-3 rounded-sm bg-ink-100 border border-ink-200 text-ink-1000 placeholder:text-ink-400 focus-ring"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p role="alert" className="text-body-sm text-danger">{error}</p>
          )}
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Entrar
          </Button>
          <p className="text-body-sm text-ink-500 text-center">
            Magic link via WhatsApp chega em uma próxima sprint.
          </p>
        </form>
      </section>
    </div>
  );
}

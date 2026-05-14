import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { PWAInstallPrompt } from '../components/PWAInstallPrompt';

type Step = 'phone' | 'code';
type Mode = 'magic' | 'password';

export function Login() {
  const { session, sendMagicLink, verifyMagicCode, signIn, loading } = useAuth();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };

  const [mode, setMode] = useState<Mode>('magic');
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [firstName, setFirstName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fallback (email/password)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (!loading && session) {
    const dest = location.state?.from?.pathname || '/hoje';
    return <Navigate to={dest} replace />;
  }

  async function onSubmitPhone(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await sendMagicLink(phone);
    setSubmitting(false);
    if (!r.ok) {
      const msg =
        r.error === 'rate_limited'
          ? `muitas tentativas. tenta de novo em ${r.retry_after_min ?? 5} min.`
          : r.error === 'phone_invalid'
          ? 'número inválido — use só dígitos com DDD (ex: 5521981278047)'
          : r.error === 'uazapi_not_configured'
          ? 'serviço de WhatsApp temporariamente indisponível'
          : 'não consegui enviar o código. tenta de novo daqui a pouco?';
      setError(msg);
      return;
    }
    if (r.unknown || !r.email) {
      // Vague response — phone not in collaborators or inactive. Don't reveal.
      setError('se esse número está cadastrado, o código chegou no WhatsApp.');
      return;
    }
    setPendingEmail(r.email);
    setMaskedPhone(r.masked_phone || '');
    setFirstName(r.first_name ?? null);
    setStep('code');
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await verifyMagicCode(pendingEmail, code);
    setSubmitting(false);
    if (r.error) {
      setError('código inválido ou expirado. confere no WhatsApp e tenta de novo.');
    }
  }

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await signIn(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (r.error) setError('não consegui entrar. confere email e senha.');
  }

  return (
    <div className="min-h-screen flex flex-col bg-ink-0 text-ink-1000">
      {/* Hero */}
      <section className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-md py-2xl">
        <div className="absolute inset-0 halftone-soft" aria-hidden />

        {/* LA logo — fundo fantasma */}
        <img
          src="/la-logo-bg.svg"
          aria-hidden
          className="absolute select-none pointer-events-none"
          style={{
            width: '140%',
            maxWidth: '560px',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            opacity: 0.07,
            filter: 'brightness(2)',
          }}
        />

        {/* TOM avatar */}
        <div className="relative z-10 flex flex-col items-center gap-lg">
          <div
            className="relative"
            style={{ filter: 'drop-shadow(0 0 32px rgba(233,20,81,0.25))' }}
          >
            <img
              src="/tom-avatar.png"
              alt="TOM"
              className="h-32 w-32 object-contain select-none"
              draggable={false}
            />
          </div>

          {/* Wordmark */}
          <div className="text-center space-y-1">
            <div
              className="text-white select-none"
              style={{ fontFamily: 'Prompt, sans-serif', fontSize: '32px', fontWeight: 900, letterSpacing: '-0.5px', lineHeight: 1 }}
            >
              <span style={{ color: '#E91451' }}>LA</span> Organizer
            </div>
            <p className="text-body-sm text-ink-500 text-center whitespace-nowrap">
              Suas tarefas, projetos e time — em um lugar só.
            </p>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="bg-ink-50 border-t border-ink-200 px-md pt-xl pb-xl">
        <div className="w-full max-w-content mx-auto">
          {mode === 'magic' && step === 'phone' && (
            <form onSubmit={onSubmitPhone} className="space-y-md">
              <div className="space-y-1">
                <label htmlFor="phone" className="text-label uppercase tracking-wide text-ink-500">WhatsApp</label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full h-12 px-3 rounded-sm bg-ink-100 border border-ink-200 text-ink-1000 placeholder:text-ink-400 focus-ring tabular-nums"
                  placeholder="5521981278047"
                />
                <p className="text-body-sm text-ink-500">só dígitos com DDD. te mando um código no WhatsApp.</p>
              </div>
              {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
              <Button type="submit" size="lg" fullWidth loading={submitting}>Enviar código</Button>
              <p className="text-body-sm text-ink-500 text-center">
                Sem WhatsApp? <button type="button" onClick={() => { setMode('password'); setError(null); }} className="text-brand underline focus-ring">Entrar com e-mail</button>
              </p>
            </form>
          )}

          {mode === 'magic' && step === 'code' && (
            <form onSubmit={onSubmitCode} className="space-y-md">
              <div className="space-y-1">
                <p className="text-body-md text-ink-1000">
                  {firstName ? `${firstName}, ` : ''}código enviado pra <span className="tabular-nums">{maskedPhone}</span>.
                </p>
                <label htmlFor="code" className="text-label uppercase tracking-wide text-ink-500">Código</label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={10}
                  required
                  autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full h-12 px-3 rounded-sm bg-ink-100 border border-ink-200 text-ink-1000 placeholder:text-ink-400 focus-ring tabular-nums tracking-widest text-xl text-center"
                  placeholder="••••••••"
                />
              </div>
              {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
              <Button type="submit" size="lg" fullWidth loading={submitting}>Entrar</Button>
              <div className="flex items-center justify-between text-body-sm text-ink-500">
                <button type="button" onClick={() => { setStep('phone'); setCode(''); setError(null); }} className="text-brand focus-ring">← outro número</button>
                <button type="button" onClick={onSubmitPhone as unknown as () => void} className="text-ink-500 hover:text-ink-1000 focus-ring">Reenviar código</button>
              </div>
            </form>
          )}

          {mode === 'password' && (
            <form onSubmit={onSubmitPassword} className="space-y-md">
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
              {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
              <Button type="submit" size="lg" fullWidth loading={submitting}>Entrar</Button>
              <p className="text-body-sm text-ink-500 text-center">
                <button type="button" onClick={() => { setMode('magic'); setError(null); }} className="text-brand underline focus-ring">Voltar pro WhatsApp</button>
              </p>
            </form>
          )}
        </div>
      </section>
      <PWAInstallPrompt />
    </div>
  );
}

// OnboardingWizard — 4 telas de boas-vindas mostradas no primeiro acesso.
// Disparado por AppShell quando collaborator.onboarding_completed === false
// e localStorage não tem 'onboarding_wizard_dismissed_v1'.
// A tela 4 aciona a Edge Function send-onboarding-message e abre WhatsApp.
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getOnboardingSlide2, type OnboardingSlide2 } from '../lib/onboarding';

export const WIZARD_DISMISSED_KEY = 'onboarding_wizard_dismissed_v1';
const TOM_WA = '5521997243082';

interface Props {
  onDismiss: () => void;
}

export function OnboardingWizard({ onDismiss }: Props) {
  const { collaborator } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const name =
    collaborator?.preferred_name ??
    (collaborator?.full_name?.split(' ')[0] || 'você');

  const slide2 = getOnboardingSlide2(collaborator?.function_title ?? null);

  function dismiss() {
    localStorage.setItem(WIZARD_DISMISSED_KEY, 'true');
    onDismiss();
  }

  function skipToEnd() {
    setStep(3);
  }

  async function handleWhatsApp() {
    setLoading(true);
    try {
      await supabase.functions.invoke('send-onboarding-message');
    } catch {
      // Silent fail — WhatsApp ainda abre mesmo se Edge Function falhar
    }
    window.open(`https://wa.me/${TOM_WA}`, '_blank');
    setLoading(false);
    dismiss();
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg-app flex flex-col items-center justify-between px-lg py-xl">
      {/* Skip link — aparece nas telas 1-3 */}
      {step < 3 && (
        <div className="w-full flex justify-end">
          <button
            type="button"
            onClick={skipToEnd}
            className="text-fg-muted text-body-sm focus-ring rounded-md px-2 py-1"
          >
            Pular
          </button>
        </div>
      )}
      {step === 3 && <div className="h-7" />}

      {/* Conteúdo da tela */}
      <div className="flex-1 w-full max-w-sm flex flex-col items-center justify-center">
        {step === 0 && <WelcomeScreen name={name} />}
        {step === 1 && (
          <AppScreen slide={slide2} functionTitle={collaborator?.function_title ?? null} />
        )}
        {step === 2 && <TomScreen />}
        {step === 3 && (
          <WhatsAppScreen loading={loading} onWhatsApp={handleWhatsApp} onLater={dismiss} />
        )}
      </div>

      {/* Dots de progresso + botão Próximo */}
      <div className="w-full max-w-sm space-y-md">
        <Dots current={step} total={4} />
        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            className="w-full h-12 rounded-xl bg-tom text-black font-semibold text-body-md focus-ring"
          >
            Próximo →
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-telas ──────────────────────────────────────────────────────────── */

function WelcomeScreen({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-lg">
      <img
        src="/tom-avatar.png"
        alt="TOM"
        className="h-36 w-36 object-contain select-none"
        style={{ filter: 'drop-shadow(0 0 32px rgba(233,20,81,0.25))' }}
        draggable={false}
      />
      <div className="space-y-2">
        <h1
          className="text-2xl font-black text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          Oi, {name}! Eu sou o TOM 👽
        </h1>
        <p className="text-fg-muted text-body-md">
          Seu assistente operacional da LA Music.
          Tô aqui pra te ajudar no dia a dia.
        </p>
      </div>
    </div>
  );
}

function AppScreen({
  slide,
  functionTitle,
}: {
  slide: OnboardingSlide2;
  functionTitle: string | null;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-md w-full">
      <div className="text-5xl">{slide.icon}</div>
      {functionTitle && (
        <div className="bg-tom/10 border border-tom/30 rounded-lg px-3 py-1 text-tom text-body-sm">
          🎯 Personalizado para: {functionTitle}
        </div>
      )}
      <div className="space-y-1">
        <h2
          className="text-xl font-bold text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          {slide.title}
        </h2>
        <p className="text-fg-muted text-body-sm">{slide.subtitle}</p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {slide.chips.map(chip => (
          <span
            key={chip.label}
            className={`px-3 py-1 rounded-full text-body-sm border ${
              chip.highlight
                ? 'border-tom text-tom bg-tom/10'
                : 'border-border text-fg-muted bg-bg-elevated'
            }`}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TomScreen() {
  return (
    <div className="flex flex-col gap-md w-full">
      {/* Balões de conversa estilo WhatsApp */}
      <div className="flex items-start gap-2">
        <img
          src="/tom-avatar.png"
          alt="TOM"
          className="h-8 w-8 object-contain shrink-0 mt-1"
          draggable={false}
        />
        <div className="bg-bg-elevated border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-body-sm text-fg">
          Manda mensagem pra mim no WhatsApp. Eu gerencio suas tarefas,
          te aviso dos rituais e cobro o que tá pendente 😅
        </div>
      </div>
      <div className="flex items-start gap-2">
        <img
          src="/tom-avatar.png"
          alt="TOM"
          className="h-8 w-8 object-contain shrink-0 mt-1"
          draggable={false}
        />
        <div className="bg-bg-elevated border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-body-sm text-fg">
          E também te ajudo com sua vida pessoal — hábitos,
          lembretes particulares, agenda. Fica entre a gente 🤐
        </div>
      </div>
      <div className="text-center mt-2 space-y-1">
        <h2
          className="text-xl font-bold text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          Fala comigo no WhatsApp
        </h2>
        <p className="text-fg-muted text-body-sm">
          Sem app extra — só mensagem natural.
        </p>
      </div>
    </div>
  );
}

function WhatsAppScreen({
  loading,
  onWhatsApp,
  onLater,
}: {
  loading: boolean;
  onWhatsApp: () => void;
  onLater: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-lg w-full">
      <div className="relative">
        <img
          src="/tom-avatar.png"
          alt="TOM"
          className="h-32 w-32 object-contain select-none"
          style={{ filter: 'drop-shadow(0 0 32px rgba(233,20,81,0.25))' }}
          draggable={false}
        />
        <span className="absolute -bottom-2 -right-2 text-3xl">💬</span>
      </div>
      <div className="space-y-2">
        <h2
          className="text-xl font-bold text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          Tudo pronto! Me chama no WhatsApp 🎉
        </h2>
        <p className="text-fg-muted text-body-sm">
          Salva meu contato e manda um "Oi" — eu cuido do resto.
        </p>
      </div>
      <div className="w-full space-y-3">
        <button
          type="button"
          onClick={onWhatsApp}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-[#25D366] text-white font-semibold text-body-md flex items-center justify-center gap-2 focus-ring disabled:opacity-50"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          {loading ? 'Conectando...' : 'Falar com o TOM agora'}
        </button>
        <button
          type="button"
          onClick={onLater}
          className="w-full text-fg-muted text-body-sm focus-ring rounded-md py-2"
        >
          Fazer isso depois
        </button>
      </div>
    </div>
  );
}

/* ─── Dots ───────────────────────────────────────────────────────────────── */

function Dots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === current ? 'w-5 bg-tom' : 'w-1.5 bg-border'
          }`}
        />
      ))}
    </div>
  );
}

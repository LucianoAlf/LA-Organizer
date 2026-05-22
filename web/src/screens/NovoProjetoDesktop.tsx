// Wizard de Novo Projeto — versão desktop premium.
//
// Aesthetic: refined editorial. Inspired by Stripe Atlas + Linear onboarding.
// - Two-column split (left 38% brand+steps, right form)
// - Display font (Instrument Serif) para headings
// - Vertical stepper numerado com linha conectora
// - Halftone sutil de fundo no painel esquerdo
// - Ações ancoradas no rodapé do painel direito (não em card flutuante)
// - Sem cards aninhados — full-page imersivo

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, X as XIcon, ArrowLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Step1Essencial } from '../wizard/Step1Essencial';
import { Step2OndeQuando } from '../wizard/Step2OndeQuando';
import { Step3TimeComo } from '../wizard/Step3TimeComo';
import { Step4Confere } from '../wizard/Step4Confere';
import { NovoProjetoCreatedScreen } from '../wizard/NovoProjetoCreatedScreen';
import { validateStep } from '../wizard/validateStep';
import { initialWizardData, TOTAL_STEPS } from '../wizard/wizardTypes';
import type { CollabLite, Step, WizardData } from '../wizard/wizardTypes';
import { useCreateProject } from '../hooks/useCreateProject';

interface StepMeta {
  id: Step;
  title: string;
  description: string;
}

const STEPS: StepMeta[] = [
  { id: 1, title: 'Essencial', description: 'Nome e propósito do projeto' },
  { id: 2, title: 'Onde e quando', description: 'Local, início e fim' },
  { id: 3, title: 'Time e como', description: 'Pessoas e metodologia' },
  { id: 4, title: 'Confere', description: 'Revisar antes de criar' },
];

export function NovoProjetoDesktop() {
  const navigate = useNavigate();
  const { role, collaborator } = useAuth();
  const isCoordOrDir = role === 'coordinator' || role === 'director';

  const [step, setStep] = useState<Step>(1);
  const [data, setData] = useState<WizardData>(initialWizardData);
  const [touched, setTouched] = useState<Record<Step, boolean>>({ 1: false, 2: false, 3: false, 4: false });

  const { data: collabsAvailable = [] } = useQuery<CollabLite[]>({
    queryKey: ['novo-projeto-collabs', collaborator?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) return [];
      return ((data || []) as CollabLite[]).filter(c => c.id !== collaborator?.id);
    },
    enabled: !!collaborator?.id,
    staleTime: 5 * 60_000,
  });

  const { data: supervisorName } = useQuery({
    queryKey: ['novo-projeto-supervisor'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('full_name')
        .in('role', ['coordinator', 'director'])
        .eq('is_active', true)
        .order('role', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return (data.full_name as string) ?? null;
    },
    enabled: !isCoordOrDir,
    staleTime: 5 * 60_000,
  });

  const create = useCreateProject({
    collaboratorId: collaborator?.id,
    isCoordOrDir,
    collabsAvailable,
    supervisorName: supervisorName ?? null,
  });

  function update<K extends keyof WizardData>(k: K, v: WizardData[K]) {
    setData(prev => ({ ...prev, [k]: v }));
  }

  const stepError = validateStep(step, data);
  const showError = touched[step] && stepError !== null;

  function next() {
    if (stepError) {
      setTouched(t => ({ ...t, [step]: true }));
      return;
    }
    if (step < TOTAL_STEPS) setStep(((step + 1) as Step));
    else void create.submit(data);
  }

  function back() {
    if (step > 1) setStep(((step - 1) as Step));
    else navigate('/projetos');
  }

  if (create.submitted) {
    return (
      <NovoProjetoCreatedScreen
        submitted={create.submitted}
        isCoordOrDir={isCoordOrDir}
        onCreateAnother={() => {
          create.reset();
          setData(initialWizardData);
          setStep(1);
          setTouched({ 1: false, 2: false, 3: false, 4: false });
        }}
      />
    );
  }

  const currentStep = STEPS[step - 1];
  const progress = (step / TOTAL_STEPS) * 100;

  return (
    <div className="h-[calc(100%+3rem)] grid grid-cols-[minmax(280px,38%)_1fr] overflow-hidden -mx-4 md:-mx-6 lg:-mx-10 -my-6">
      {/* === PAINEL ESQUERDO — brand + stepper === */}
      <aside className="relative flex flex-col bg-bg-surface border-r border-border overflow-hidden">
        {/* Halftone sutil de fundo */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgb(163, 190, 80) 1px, transparent 1.2px)',
            backgroundSize: '20px 20px',
          }}
          aria-hidden="true"
        />

        {/* Conteúdo */}
        <div className="relative flex flex-col h-full px-10 py-8">
          {/* Header com cancelar */}
          <button
            type="button"
            onClick={() => navigate('/projetos')}
            className="self-start inline-flex items-center gap-1.5 text-[12px] text-fg-muted hover:text-fg transition-colors focus-ring rounded px-1 -ml-1"
          >
            <XIcon size={14} />
            Cancelar
          </button>

          {/* Título editorial */}
          <header className="mt-12">
            <p className="text-[11px] uppercase tracking-[0.18em] text-tom font-bold mb-3">
              Passo {step} de {TOTAL_STEPS}
            </p>
            <h1 className="font-display text-[44px] leading-[1.05] text-fg tracking-tight">
              {currentStep.title}
            </h1>
            <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed max-w-[34ch]">
              {currentStep.description}
            </p>
          </header>

          {/* Stepper vertical */}
          <ol className="mt-12 space-y-1 relative">
            {/* Linha conectora */}
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" aria-hidden="true" />
            {STEPS.map(s => {
              const isActive = s.id === step;
              const isDone = s.id < step;
              const isFuture = s.id > step;
              return (
                <li key={s.id} className="relative flex items-start gap-3 py-2">
                  <div
                    className={[
                      'w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 relative z-10 transition-all',
                      isDone
                        ? 'bg-tom text-black'
                        : isActive
                          ? 'bg-tom text-black ring-4 ring-tom/15'
                          : 'bg-bg-app text-fg-muted border border-border',
                    ].join(' ')}
                  >
                    {isDone ? <Check size={12} strokeWidth={3} /> : s.id}
                  </div>
                  <div className="min-w-0 -mt-0.5">
                    <div
                      className={[
                        'text-[13px] font-semibold leading-tight transition-colors',
                        isActive ? 'text-fg' : isFuture ? 'text-fg-muted' : 'text-fg-secondary',
                      ].join(' ')}
                    >
                      {s.title}
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5 leading-snug">{s.description}</div>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Barra de progresso fina embaixo */}
          <div className="mt-auto pt-8">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-2">
              <span>Progresso</span>
              <span className="tabular-nums text-tom">{Math.round(progress)}%</span>
            </div>
            <div className="h-1 rounded-full bg-bg-app overflow-hidden">
              <div
                className="h-full bg-tom rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </aside>

      {/* === PAINEL DIREITO — formulário === */}
      <main className="flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[560px] mx-auto px-10 py-12">
            <div className="space-y-6">
              {step === 1 && <Step1Essencial data={data} update={update} />}
              {step === 2 && <Step2OndeQuando data={data} update={update} />}
              {step === 3 && <Step3TimeComo data={data} update={update} collabsAvailable={collabsAvailable} />}
              {step === 4 && (
                <Step4Confere
                  data={data}
                  update={update}
                  collabsAvailable={collabsAvailable}
                  isCoordOrDir={isCoordOrDir}
                />
              )}

              {showError && (
                <div
                  className="text-[13px] text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2"
                  role="alert"
                >
                  {stepError}
                </div>
              )}
              {create.submitError && (
                <div
                  className="text-[13px] text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2"
                  role="alert"
                >
                  {create.submitError}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Rodapé com ações — ancorado, não flutuante */}
        <footer className="shrink-0 border-t border-border bg-bg-surface/40 backdrop-blur-sm">
          <div className="max-w-[560px] mx-auto px-10 py-4 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={back}>
              <ArrowLeft size={14} />
              {step === 1 ? 'Cancelar' : 'Voltar'}
            </Button>
            <Button
              variant="primary"
              onClick={next}
              disabled={create.submitting}
              loading={create.submitting}
            >
              {step < TOTAL_STEPS ? (
                <>
                  Continuar
                  <ArrowRight size={14} />
                </>
              ) : (
                'Criar projeto'
              )}
            </Button>
          </div>
        </footer>
      </main>
    </div>
  );
}

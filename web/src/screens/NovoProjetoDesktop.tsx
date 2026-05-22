// Wizard de Novo Projeto — versão desktop.
//
// Reusa todos os Step components do wizard/. Apenas o chrome (header, footer
// de ações, container) é diferente do mobile:
// - Card centralizado max-w-3xl (não full-width)
// - Stepper horizontal com labels visíveis
// - Botões "Voltar" + "Continuar" no rodapé do card (não sticky fixed)
// - Sem padding-bottom: 24 (o shell já preenche o viewport)

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, X as XIcon } from 'lucide-react';
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

const STEP_LABELS: Record<Step, string> = {
  1: 'Essencial',
  2: 'Onde e quando',
  3: 'Time e como',
  4: 'Confere',
};

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

  return (
    <div className="h-full flex items-start justify-center py-8 overflow-y-auto">
      <div className="w-full max-w-3xl">
        {/* Card do wizard */}
        <div className="rounded-xl border border-border bg-bg-surface shadow-lg overflow-hidden">
          {/* Header com cancelar + stepper */}
          <header className="flex items-center justify-between px-6 py-4 border-b border-border">
            <button
              type="button"
              onClick={() => navigate('/projetos')}
              aria-label="Cancelar"
              className="w-8 h-8 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors focus-ring"
            >
              <XIcon size={16} />
            </button>
            <h1 className="text-[14px] font-semibold text-fg">Novo projeto</h1>
            <div className="w-8" /> {/* spacer para centralizar título */}
          </header>

          {/* Stepper horizontal */}
          <div className="px-6 py-4 border-b border-border bg-bg-app/30">
            <ol className="flex items-center gap-2">
              {([1, 2, 3, 4] as Step[]).map((s, i) => {
                const isActive = s === step;
                const isDone = s < step;
                return (
                  <li key={s} className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                      className={[
                        'w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 transition-colors',
                        isDone
                          ? 'bg-tom text-black'
                          : isActive
                            ? 'bg-tom text-black ring-2 ring-tom/30'
                            : 'bg-bg-elevated text-fg-muted border border-border',
                      ].join(' ')}
                    >
                      {isDone ? <Check size={12} /> : s}
                    </div>
                    <span
                      className={[
                        'text-[12px] truncate',
                        isActive ? 'font-semibold text-fg' : isDone ? 'text-fg-muted' : 'text-fg-muted',
                      ].join(' ')}
                    >
                      {STEP_LABELS[s]}
                    </span>
                    {i < 3 && (
                      <div className={`flex-1 h-px ${isDone ? 'bg-tom' : 'bg-border'}`} />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Conteúdo do passo */}
          <div className="px-6 py-6 space-y-6 min-h-[360px]">
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
              <div className="text-[13px] text-danger" role="alert">
                {stepError}
              </div>
            )}
            {create.submitError && (
              <div className="text-[13px] text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2" role="alert">
                {create.submitError}
              </div>
            )}
          </div>

          {/* Rodapé com ações */}
          <footer className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-bg-app/30">
            <Button variant="secondary" onClick={back}>
              {step === 1 ? 'Cancelar' : 'Voltar'}
            </Button>
            <Button
              variant="primary"
              onClick={next}
              disabled={create.submitting}
              loading={create.submitting}
            >
              {step < TOTAL_STEPS ? 'Continuar' : 'Criar projeto'}
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
}

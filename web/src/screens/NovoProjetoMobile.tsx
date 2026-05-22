// Sprint 8 Etapa 2/3 — Wizard visual de criacao de projeto.
// Espelha o fluxo conversacional do TOM no WhatsApp (skill cadastro-projeto-5w2h),
// sem expor jargao ("5W2H", "wizard", "form"). Copy desenhada como conducao
// guiada de pensamento. Submit real (Etapa 3) faz INSERT em projects via
// authenticated session — gateado pela RLS auth_insert_own_projects (created_by=self).
//
// Sprint 22.24 — refactor: arquivo era 824 linhas, virou casca. Passos, picker,
// validacao, submit e tela final extraidos pra:
//   - wizard/{Step1Essencial, Step2OndeQuando, Step3TimeComo, Step4Confere,
//             NovoProjetoCreatedScreen, validateStep, wizardTypes}
//   - components/{Field, Summary, MemberPicker}
//   - hooks/useCreateProject
//   - utils/wizardDate

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
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

export function NovoProjetoMobile() {
  const navigate = useNavigate();
  const { role, collaborator } = useAuth();
  const isCoordOrDir = role === 'coordinator' || role === 'director';

  const [step, setStep] = useState<Step>(1);
  const [data, setData] = useState<WizardData>(initialWizardData);
  const [touched, setTouched] = useState<Record<Step, boolean>>({ 1: false, 2: false, 3: false, 4: false });

  // Sprint 9: lista de collaborators ativos pra member picker (passo 3).
  // Exclui o proprio criador — engine adiciona como owner automaticamente.
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
    setData((prev) => ({ ...prev, [k]: v }));
  }

  const stepError = validateStep(step, data);
  const showError = touched[step] && stepError !== null;

  function next() {
    if (stepError) {
      setTouched((t) => ({ ...t, [step]: true }));
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
    <div className="pb-24">
      <div className="sticky top-0 z-10 bg-bg pt-2 pb-3 -mx-md px-md border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={back}
            className="text-body-sm text-fg-muted inline-flex items-center gap-1 focus-ring rounded-md px-1 -ml-1"
          >
            <ChevronLeft size={18} />
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </button>
          <span className="text-label uppercase tracking-wide text-brand font-bold tabular-nums">
            Passo {step} de {TOTAL_STEPS}
          </span>
        </div>
        <div className="h-1.5 bg-bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-brand transition-all duration-300"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-lg mt-lg max-w-md mx-auto">
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
          <div className="text-body-sm text-danger" role="alert">
            {stepError}
          </div>
        )}
        {create.submitError && (
          <div className="text-body-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-md py-sm" role="alert">
            {create.submitError}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-bg border-t border-border px-md py-sm pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="max-w-md mx-auto flex gap-md">
          {step > 1 && (
            <Button variant="secondary" onClick={back} fullWidth>
              Voltar
            </Button>
          )}
          <Button
            variant="primary"
            onClick={next}
            disabled={create.submitting}
            loading={create.submitting}
            fullWidth
          >
            {step < TOTAL_STEPS ? 'Continuar' : 'Criar projeto'}
          </Button>
        </div>
      </div>
    </div>
  );
}

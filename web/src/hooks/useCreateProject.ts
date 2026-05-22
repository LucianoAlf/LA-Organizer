// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Logica de submit do wizard: gate por role, composicao de description,
// INSERT em projects + notify engine TOM (idempotente).

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { notifyProjectCreated } from '../lib/tomEngine';
import type { ProjectStatus } from '../types';
import type { CollabLite, WizardData } from '../wizard/wizardTypes';

export interface SubmittedProject {
  snapshot: WizardData;
  supervisorName: string | null;
  projectId: string;
}

export interface UseCreateProjectArgs {
  collaboratorId: string | undefined;
  isCoordOrDir: boolean;
  collabsAvailable: CollabLite[];
  supervisorName: string | null;
}

export interface UseCreateProjectResult {
  submitting: boolean;
  submitError: string | null;
  submitted: SubmittedProject | null;
  submit: (data: WizardData) => Promise<void>;
  reset: () => void;
  setSubmitError: (msg: string | null) => void;
}

export function useCreateProject(args: UseCreateProjectArgs): UseCreateProjectResult {
  const { collaboratorId, isCoordOrDir, collabsAvailable, supervisorName } = args;
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedProject | null>(null);

  async function submit(data: WizardData): Promise<void> {
    if (!collaboratorId) {
      setSubmitError('Sua sessão expirou. Faz login de novo e tenta outra vez.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    // Sprint 8 — gate por role. Coord/director cria direto em planning;
    // collaborator comum entra como pending_approval e exige supervisor
    // aprovar via WhatsApp (skill aprovar-projeto, Etapa 5).
    const requires_approval = !isCoordOrDir;
    const status: ProjectStatus = isCoordOrDir ? 'planning' : 'pending_approval';
    const hours = data.estimated_hours_week.trim() ? Number(data.estimated_hours_week) : null;

    const insertPayload = {
      name: data.name.trim(),
      justification: data.justification.trim(),
      location: data.location || null,
      start_date: data.start_date,
      end_date: data.end_date,
      description: data.description.trim() || null,
      methodology: data.methodology.trim(),
      estimated_hours_week: hours,
      category: data.category,
      status,
      requires_approval,
      progress_percent: 0,
      color: '#E91451',
      created_by: collaboratorId,
    };

    const { data: inserted, error } = await supabase
      .from('projects')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error || !inserted?.id) {
      setSubmitting(false);
      // Mensagem em portugues para erros conhecidos; fallback tecnico.
      const m = (error?.message || '').toLowerCase();
      if (m.includes('row-level security') || m.includes('policy')) {
        setSubmitError('Você não tem permissão pra criar projeto. Confere com o coordenador.');
      } else if (m.includes('check constraint')) {
        setSubmitError('Algum campo veio fora do formato esperado. Tenta de novo.');
      } else {
        setSubmitError(error?.message || 'Não consegui criar o projeto. Tenta de novo daqui a pouco.');
      }
      return;
    }

    // Invalida cache de projetos pra proxima visita ao /projetos mostrar o novo.
    await queryClient.invalidateQueries({ queryKey: ['projects'] });

    // Notifica engine TOM (fire-ish: aguarda mas nao bloqueia em caso de falha).
    // Endpoint e idempotente por project_id — retry futuro e seguro.
    // Sprint 9: passa member_ids pra engine inserir project_members + WA por membro.
    const ack = await notifyProjectCreated(inserted.id as string, data.member_ids);
    if (!ack.ok) {
      console.warn('[NovoProjeto] engine notify falhou:', ack.reason);
      // Projeto esta salvo no DB; so a notificacao automatica falhou.
      // Sprint 9+: cron de retry varre projects sem PROJECT_BOOTSTRAPPED.
    }

    setSubmitted({
      snapshot: { ...data },
      supervisorName: supervisorName ?? null,
      projectId: inserted.id as string,
    });
    setSubmitting(false);
  }

  function reset() {
    setSubmitted(null);
    setSubmitError(null);
  }

  return {
    submitting,
    submitError,
    submitted,
    submit,
    reset,
    setSubmitError,
  };
}

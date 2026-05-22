// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Tipos + estado inicial + classes compartilhadas pelo wizard de criacao.

import type { ProjectCategory, ProjectLocation } from '../types';

export type WizardData = {
  name: string;
  justification: string;
  location: ProjectLocation | '';
  start_date: string; // YYYY-MM-DD
  end_date: string;
  description: string;
  // Sprint 9: "Quem participa" agora e multi-select de collaborators (member_ids)
  // + texto livre opcional pra pessoas de fora do sistema.
  member_ids: string[];
  extra_members: string;
  methodology: string;
  estimated_hours_week: string;
  category: ProjectCategory;
};

export const initialWizardData: WizardData = {
  name: '',
  justification: '',
  description: '',
  location: '',
  start_date: '',
  end_date: '',
  member_ids: [],
  extra_members: '',
  methodology: '',
  estimated_hours_week: '',
  category: 'operational',
};

export type CollabLite = { id: string; full_name: string; role: string };

export type Step = 1 | 2 | 3 | 4;
export const TOTAL_STEPS = 4;

// Classes Tailwind compartilhadas pelos inputs do wizard (consistencia visual).
export const wizardInputClass =
  'w-full h-11 rounded-md border border-border bg-bg-surface px-3 text-body-md text-fg focus-ring placeholder:text-fg-muted disabled:opacity-60';
export const wizardTextareaClass =
  'w-full min-h-[88px] rounded-md border border-border bg-bg-surface px-3 py-2 text-body-md text-fg focus-ring placeholder:text-fg-muted resize-y disabled:opacity-60';

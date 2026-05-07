// Sprint 22.23 (refactor) — types compartilhados pelos modulos de ProjetoDetalhe
// (extraidos de screens/ProjetoDetalhe.tsx).

import type { Project, Checkpoint } from '../types';

export type TabId = 'checkpoints' | 'contingencias' | 'time' | 'dia_d';

export interface ProjectFull extends Project {
  event_date?: string | null;
}

export interface CheckpointFull extends Checkpoint {
  rationale?: string | null;
}

export interface Contingency {
  id: string;
  project_id: string;
  scenario: string;
  protocol: string;
  position: number;
}

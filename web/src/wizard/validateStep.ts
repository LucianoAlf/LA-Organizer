// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Validacao por passo do wizard. Retorna mensagem de erro ou null se OK.

import { todayISO } from '../utils/wizardDate';
import type { Step, WizardData } from './wizardTypes';

export function validateStep(step: Step, d: WizardData): string | null {
  if (step === 1) {
    const n = d.name.trim();
    if (n.length < 3) return 'Dá pelo menos 3 letras pro nome.';
    if (n.length > 100) return 'Nome muito longo (máx 100).';
    if (d.justification.trim().length < 10) return 'Conta um pouco mais — pelo menos 10 caracteres.';
    return null;
  }
  if (step === 2) {
    if (!d.location) return 'Escolhe um local pra continuar.';
    if (!d.start_date) return 'Defina quando começa.';
    if (!d.end_date) return 'Defina quando termina.';
    if (d.start_date < todayISO()) return 'Início não pode ser no passado.';
    if (d.end_date <= d.start_date) return 'Término precisa ser depois do início.';
    return null;
  }
  if (step === 3) {
    // Sprint 9: pelo menos 1 membro selecionado OU pelo menos 10 chars em "outros"
    const hasMembers = d.member_ids.length > 0;
    const hasExtras = d.extra_members.trim().length >= 10;
    if (!hasMembers && !hasExtras) return 'Marca pelo menos 1 pessoa do time, ou descreve quem mais vai participar.';
    if (d.methodology.trim().length < 10) return 'Conta a abordagem — pelo menos 10 caracteres.';
    if (d.estimated_hours_week.trim()) {
      const n = Number(d.estimated_hours_week);
      if (!Number.isFinite(n) || n < 0 || n > 80) return 'Horas/semana entre 0 e 80.';
    }
    return null;
  }
  return validateStep(1, d) || validateStep(2, d) || validateStep(3, d);
}

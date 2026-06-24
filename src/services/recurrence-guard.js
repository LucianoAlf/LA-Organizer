'use strict';
// CHOKEPOINT da recorrência — RECUR-RESURRECT-CALLER-GUARD (caso Gabi/equipe 24/06).
//
// Por que existe: o guard "não materializar molde fechado" (Balde A, 19/06) ficou SÓ
// dentro do materializeAll (o cron noturno). Mas materialização acontece por 4 portas:
//   1) cron materializeAll            (tinha o guard)
//   2) engine materializeSeries       (TOM cria/mexe em tarefa/evento recorrente) — SEM guard
//   3) PWA materializeSeriesClient    (criar/editar série no app)                  — SEM guard
//   4) grupo (taskGroups / revive)    (chama materializeSeries direto)             — SEM guard
// Resultado: deletar uma instância liberava o slot do dedup (por dia) e qualquer porta
// destrancada recriava a partir do molde JÁ FECHADO → "apago e volta" (Gabi).
//
// Fix: centralizar a decisão num ponto único. materializeSeries (backend) e
// materializeSeriesClient (PWA, espelho em TS) chamam esta regra ANTES de gerar.
// Assim as 4 portas ficam trancadas por construção — não uma a uma.
//
// Fail-open: só bloqueia status EXPLICITAMENTE done/cancelled. Sem status (caller passa
// objeto mínimo) NÃO bloqueia — preserva o comportamento atual e não quebra fluxo legítimo.
// Revive funciona porque reviveSeries reativa o molde pra 'pending' ANTES de materializar.

const CLOSED_STATUSES = new Set(['done', 'cancelled']);

/**
 * @param {{status?: string}|null|undefined} template  row do molde recorrente
 * @returns {boolean} true = pode materializar; false = molde fechado, não materializa
 */
function shouldMaterializeTemplate(template) {
  const status = template && template.status;
  if (typeof status !== 'string') return true; // fail-open
  return !CLOSED_STATUSES.has(status);
}

module.exports = { shouldMaterializeTemplate, CLOSED_STATUSES };

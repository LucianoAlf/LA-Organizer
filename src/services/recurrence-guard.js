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
// FATIA 2 (24/06 — flip do ciclo de vida): a decisão passou a depender de SE A SÉRIE
// FOI ENCERRADA (`series_ended_at`), NÃO do status da ocorrência. Concluir a 1ª
// ocorrência (status=done) NÃO encerra mais a série — mata a dor #1 ("concluí e
// congelou") sem ressuscitar nada. Só "encerrar série" (engine scope:'series' /
// grupo endSeries) seta series_ended_at; reviveSeries limpa.
//
// Fail-open (trava C): só bloqueia quando series_ended_at está EXPLICITamente preenchido.
// Coluna ausente no SELECT (undefined) ou null → materializa (preserva comportamento,
// evita ressurreição-por-omissão). TODO caller de materializeSeries traz series_ended_at
// (callers backend usam select('*'); PWA editTaskSeries inclui a coluna).

/**
 * @param {{series_ended_at?: string|null}|null|undefined} template  row do molde recorrente
 * @returns {boolean} true = pode materializar (série ativa); false = série encerrada
 */
function shouldMaterializeTemplate(template) {
  // series_ended_at preenchido = encerrada → false. null/undefined = ativa → true.
  return !(template && template.series_ended_at);
}

module.exports = { shouldMaterializeTemplate };

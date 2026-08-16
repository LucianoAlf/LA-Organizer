'use strict';
// src/lib/confere-fontes.js
// As FONTES da camada 2 (confere-numero): o que a trava lê do banco pra comparar com o número
// que o relatório do agente AFIRMA. Extraído de gov-runner pra ficar testável — a versão
// inline vivia numa closure sem teste, e foi lá que nasceu o falso alarme abaixo.
//
// GOVAGENT-CONFERE-CORRIGIDOS-CONTA-CATRACA (16/08): o relatório dizia "1 correção no ar"
// (certo — foi 1 fix do agente naquele ciclo) e a trava publicou "corrigidos: o texto diz 1,
// a fonte tem 6 / o erro é o dado". A fonte contava tom_known_issues.corrigido_em numa janela
// ROLANTE de 24h — que engoliu os 5 KIs que EU (humano-catraca) inseri na véspera. O número
// do agente estava certo; a trava é que somava o trabalho de outro ator. É o mesmo espírito do
// falso alarme do "recorte" de 15/08: a fonte não media o que o agente afirmava.
//
// A correção NÃO é sinal_tipo (medido: 422 'manual' × 17 'marker_log', os dois desde 29/05 —
// é tipo de DETECÇÃO, não autoria; não separa agente de humano). É TEMPO DE CICLO: o agente
// marca as correções dele DURANTE a rodada; as inserções manuais do humano acontecem fora
// dela. Ancorar `corrigidos` no início do ciclo conta só o que o agente fez naquela execução.

/**
 * Conta KIs marcados como corrigidos a partir de `desdeIso`. O chamador passa o INÍCIO DO
 * CICLO (não "agora − 24h"), pra contar só as correções feitas durante a rodada do agente.
 * Falha de consulta → null (INDEFINIDO), nunca 0 — inventar 0 aqui viraria a própria
 * vacuidade que a camada 2 combate.
 * @returns {Promise<number|null>}
 */
async function contarCorrigidosDesde(supabase, desdeIso) {
  if (!desdeIso) return null;
  try {
    const { count } = await supabase.from('tom_known_issues')
      .select('id', { count: 'exact', head: true }).gte('corrigido_em', desdeIso);
    return Number.isFinite(count) ? count : null;
  } catch (_) { return null; }
}

/**
 * Tamanho do acervo de achados ABERTOS (novo/confirmado). Uma fonte só, o total — é o que o
 * relatório chama de "acervo". Falha → null.
 * @returns {Promise<number|null>}
 */
async function contarAcervoAberto(supabase) {
  try {
    const { count } = await supabase.from('tom_audit_findings')
      .select('id', { count: 'exact', head: true }).in('status', ['novo', 'confirmado']);
    return Number.isFinite(count) ? count : null;
  } catch (_) { return null; }
}

module.exports = { contarCorrigidosDesde, contarAcervoAberto };

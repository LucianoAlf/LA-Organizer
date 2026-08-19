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
//
// GOVAGENT-CONFERE-CORRIGIDOS-EIXO-ESCRITO-PELO-LLM (19/08): o fix de 16/08 usou TEMPO como
// PROXY DE AUTORIA — e `corrigido_em` é campo preenchido À MÃO PELO LLM. Naquele dia ele
// escreveu a data pura "2026-08-19"; o Postgres castou pra 00:00, o gte contra o início do
// ciclo (11:0x) deu 0, e a trava publicou "corrigidos: o texto diz 1, a fonte tem 0". Em 18/08
// o mesmo agente escreveu timestamp cheio e bateu — ou seja, a precisão era sorteada por
// rodada. Agora os dois eixos são do BANCO, não do LLM:
//   • AUTORIA  → a marca `[gov-agent…]` em fix_resumo (temMarcaDoAgente, a regra canônica do
//     protocolo que o placar já usa) — resolve de vez a inflação pelas inserções do humano;
//   • TEMPO    → `created_at` (DEFAULT do banco, o agente não escreve). `corrigido_em` fica no
//     OR só pra alcançar re-conserto de KI antigo, e agora sem poder inflar: a marca filtra.
const { temMarcaDoAgente } = require('./placar-governanca');

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
    const { data, error } = await supabase.from('tom_known_issues')
      .select('fix_resumo')
      .or(`created_at.gte.${desdeIso},corrigido_em.gte.${desdeIso}`);
    if (error || !Array.isArray(data)) return null;
    return data.filter((ki) => temMarcaDoAgente(ki && ki.fix_resumo)).length;
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

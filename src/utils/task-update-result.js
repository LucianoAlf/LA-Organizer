'use strict';
// Balde A (audit 19/06) — regra anti-"concluí mentiroso".
// Causa-raiz: o UPDATE de conclusão pessoal (engine.js) não usava `.select()` nem checava
// linhas afetadas → 0 linhas = `error:null` = TOM dizia "concluí!" com a tarefa ainda pending.
// Regra (PURA): só conta como afetado se houve `.select()` E veio >=1 linha E sem erro.
// Usar em TODO ponto de conclusão/cancelamento (espelha o caminho de grupo, que já fazia).

/**
 * @param {{data?: any, error?: any}} res resultado de um update().eq()...select()
 * @returns {boolean} true só se a escrita atingiu >=1 linha sem erro
 */
function updateAffected(res) {
  if (!res || res.error) return false;
  return Array.isArray(res.data) && res.data.length >= 1;
}

module.exports = { updateAffected };

'use strict';
// dia-fechado.js — a escola está fechada hoje?
//
// FERIADO-COBRA-QUEM-NAO-TRABALHA, caminho PESSOAL (Quintela, 07/09/2026 19:25: "Tom, hj é
// feriado"). Em 07/09, feriado da Independência, o TOM mandou **222 mensagens para 33 pessoas** —
// volume de dia útil cheio (segunda normal: 263). Domingo, na mesma semana: 21 mensagens para 8
// pessoas. **Domingo já é respeitado; feriado não era.**
//
// Em 07/09 eu consertei o digest de GRUPO (group-reports.js). O caminho pessoal ficou aberto, e o
// agente de governança ainda fechou o achado do Quintela como "corrigido pelo commit do Alf" —
// casou por ASSUNTO, não por caminho de código. Achado reaberto em 08/09.
//
// A FONTE é o calendário da escola (`aulas_emusys` do LA Report), a mesma que a pauta de anamnese
// usa desde 06/09. Um feriado nacional em tabela não serviria: a escola às vezes abre em feriado
// e às vezes fecha fora dele — quem manda é a agenda real.
//
// FECHADO = zero aula NÃO CANCELADA em NENHUMA unidade. O filtro `cancelada = false` não é
// detalhe: em 07/09 o Recreio tinha 3 linhas no calendário e as três estavam canceladas. Contar
// linha bruta responderia a pergunta errada e deixaria o Recreio sendo cobrado num dia sem aula.
//
// FALHA PARA O LADO DE ENVIAR. Sem calendário, sem cliente, leitura com erro → dia normal.
// Silêncio por incapacidade é pior que ruído: ruído a pessoa reclama, silêncio ela não vê.

// Cache por dia: o dispatcher chama isQuietNow ~52 vezes por tick, vezes 38 pessoas. Sem cache
// seriam milhares de consultas ao LA Report por tique pra responder sempre a mesma coisa.
const _cache = new Map();
const _CACHE_MAX = 8;   // uma semana e sobra; o processo reinicia bem antes de encher

/** PURA — decide pelo que veio do calendário. Separada pra ter teste sem I/O. */
function decidirFechado(aulas) {
  const linhas = Array.isArray(aulas) ? aulas : [];
  return linhas.length === 0;
}

/**
 * @returns {Promise<{fechado:boolean, motivo:string|null}>}
 *   fechado=true  → zero aula hoje em todas as unidades
 *   fechado=false → tem aula, OU não deu pra saber (e aí `motivo` diz por quê)
 */
async function ehDiaFechado({ laReport, ymd, _agora = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) {
    return { fechado: false, motivo: `data invalida: "${ymd}"` };
  }
  if (_cache.has(ymd)) return _cache.get(ymd);

  let r;
  const lr = laReport || (() => {
    try { return require('./la-report-client').laReportClient; } catch (_) { return null; }
  })();
  if (!lr) {
    // NÃO entra no cache: sem cliente pode ser transitório (boot), e cachear "aberto"
    // congelaria o dia inteiro numa resposta que nasceu de uma falta, não de uma leitura.
    return { fechado: false, motivo: 'sem cliente do LA Report' };
  }

  try {
    const q = await lr.from('aulas_emusys')
      .select('id')
      .eq('cancelada', false)
      .gte('data_hora_inicio', `${ymd}T00:00:00-03:00`)
      .lte('data_hora_inicio', `${ymd}T23:59:59.999-03:00`)
      .limit(1);
    if (q.error) return { fechado: false, motivo: `leitura do calendario falhou: ${q.error.message}` };
    const fechado = decidirFechado(q.data);
    r = { fechado, motivo: fechado ? 'sem aula em nenhuma unidade' : null };
  } catch (e) {
    return { fechado: false, motivo: `leitura do calendario falhou: ${(e && e.message) || String(e)}` };
  }

  // Só a resposta MEDIDA entra no cache. Falha nunca vira verdade do dia.
  if (_cache.size >= _CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(ymd, r);
  return r;
}

/** Só pra teste: o cache é por processo e não tem porta de saída em produção. */
function _limparCache() { _cache.clear(); }

module.exports = { ehDiaFechado, decidirFechado, _limparCache };

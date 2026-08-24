'use strict';

// INVENTORY-MANUTENCAO-PENDENTE-FALSO (Leo audit 24/08) — o alerta semanal listava LOGS de
// manutenção CONCLUÍDA (inventario_manutencoes) filtrados por data_manutencao < 14d como se
// fossem "pendentes". Mas a tabela não tem coluna de conclusão: cada linha = manutenção FEITA →
// 12 manutenções antigas reapareciam toda semana (falso-alarme 100%). O sinal REAL de pendência
// é o ITEM preso em status='manutencao' (registrarManutencao seta isso e não há volta a 'ativo'
// via WhatsApp). Este módulo é PURO: dados os itens em manutenção + os logs, seleciona os que
// estão parados há mais de `diasMin` dias, usando a data do último log (quando entrou/foi mexido).

// logs assumidos em ordem DESC por data_manutencao → fica com o 1º (mais recente) de cada item.
function ultimoLogPorItem(logs) {
  const m = new Map();
  for (const l of logs || []) {
    if (l && l.item_id != null && !m.has(l.item_id)) m.set(l.item_id, l);
  }
  return m;
}

/**
 * @param {object[]} itens  itens com status='manutencao' (id, nome, updated_at, ...)
 * @param {object[]} logs   linhas de inventario_manutencoes (item_id, data_manutencao, ...) desc
 * @param {{nowMs:number, diasMin?:number}} opts
 * @returns {object[]} itens parados há > diasMin, com em_manutencao_desde + ultimo_log
 */
function selecionarItensParados(itens, logs, { nowMs, diasMin = 14 } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const ultimo = ultimoLogPorItem(logs);
  const cutoff = now - diasMin * 86400000;
  const out = [];
  for (const it of itens || []) {
    if (!it || it.id == null) continue;
    const log = ultimo.get(it.id) || null;
    const desde = (log && log.data_manutencao) || (it.updated_at ? String(it.updated_at).slice(0, 10) : null);
    const desdeMs = desde ? new Date(desde).getTime() : NaN;
    // Data confiável e ainda DENTRO da janela → não está "parado". Sem data → inclui (suspeito).
    if (Number.isFinite(desdeMs) && desdeMs > cutoff) continue;
    out.push({ ...it, em_manutencao_desde: desde, ultimo_log: log });
  }
  return out;
}

module.exports = { ultimoLogPorItem, selecionarItensParados };

'use strict';

// Formatação PURA dos alertas de inventário (estoque baixo / itens em manutenção / revisões).
// Separado do envio (rituals/inventario-alertas.js) pra ser testável. Cada fmt retorna o corpo
// da mensagem OU null quando não há nada a alertar (o caller não envia → silêncio correto).

function fmtEstoqueBaixo(baixos) {
  if (!baixos || !baixos.length) return null;
  const linhas = baixos.map(p => `• ${p.nome}: ${p.estoque_atual}/${p.estoque_minimo}`);
  return `🔴 *Estoque baixo* (${baixos.length} produto${baixos.length > 1 ? 's' : ''}):\n\n${linhas.join('\n')}\n\nPra encomendar: /loja encomenda`;
}

function fmtItensManutencao(itens, nowMs) {
  if (!itens || !itens.length) return null;
  const linhas = itens.map(it => {
    const desde = it.em_manutencao_desde;
    const dias = desde ? Math.floor((nowMs - new Date(desde).getTime()) / 86400000) : null;
    const nome = it.nome || `Item ${it.id}`;
    return `• ${nome}${dias != null ? ` — parado há ${dias}d` : ' — em manutenção'}`;
  });
  return `🔧 *Itens parados em manutenção +14d* (${itens.length}):\n\n${linhas.join('\n')}`;
}

// Formata "YYYY-MM-DD" → "DD/MM/YYYY" por STRING (sem Date → sem shift de fuso; new Date('2026-08-28')
// vira UTC-meia-noite e o toLocaleDateString em BRT joga pra 27/08). Ver project_localymd_utc_shift.
function fmtDataBR(ymd) {
  if (!ymd) return '?';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '?';
}

function fmtRevisoes(revisoes) {
  if (!revisoes || !revisoes.length) return null;
  const linhas = revisoes.map(i => `• ${i.nome} — ${fmtDataBR(i.proxima_revisao)}`);
  return `🗓 *Revisões programadas (próximos 7d)* (${revisoes.length}):\n\n${linhas.join('\n')}`;
}

module.exports = { fmtEstoqueBaixo, fmtItensManutencao, fmtRevisoes, fmtDataBR };

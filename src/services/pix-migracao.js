'use strict';
// pix-migracao.js — pauta de migração para o PIX automático. PURO (sem I/O).
const FATIAS = ['autorizacao_pendente', 'pix_avulso', 'cheque', 'boleto', 'dinheiro',
  'cartao_com_falha', 'cartao_avulso', 'sem_historico'];
const ROTULO = {
  autorizacao_pendente: { emoji: '🔵', nome: 'Cadastrados sem cobrança' },
  pix_avulso: { emoji: '🔴', nome: 'Pix avulso' },
  cheque: { emoji: '🟠', nome: 'Cheque' },
  boleto: { emoji: '🟡', nome: 'Boleto' },
  dinheiro: { emoji: '🟡', nome: 'Dinheiro' },
  cartao_com_falha: { emoji: '🟣', nome: 'Cartão falhando' },
  cartao_avulso: { emoji: '🟣', nome: 'Maquininha' },
  sem_historico: { emoji: '⚪', nome: 'Sem histórico' },
};
const LOTE_DIARIO = 10;
const TETO_FILHAS = 15;
const META_YMD = '2026-10-31';

const fatiaDoCliente = (l) => {
  if (l.categoria === 'autorizacao_pendente') return 'autorizacao_pendente';
  return FATIAS.includes(l.fatia) ? l.fatia : 'sem_historico';
};
const ordenarPorPrioridade = (linhas) => [...(linhas || [])].sort((a, b) => {
  const d = FATIAS.indexOf(fatiaDoCliente(a)) - FATIAS.indexOf(fatiaDoCliente(b));
  return d !== 0 ? d : String(a.pagador_nome || '').localeCompare(String(b.pagador_nome || ''), 'pt-BR');
});
const loteDoDia = (linhas, { tamanho = LOTE_DIARIO } = {}) => ordenarPorPrioridade(linhas).slice(0, tamanho);
function contagemPorFatia(linhas) {
  const m = new Map();
  for (const l of linhas || []) { const f = fatiaDoCliente(l); m.set(f, (m.get(f) || 0) + 1); }
  return m;
}
const tituloDaFilha = (l) => `PIX automático — ${l.pagador_nome}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`;

const METAS_BR = META_YMD.slice(8, 10) + '/' + META_YMD.slice(5, 7);
function mensagemDaUnidade({ unidadeNome, linhas, lote, fonteVelha = false }) {
  const cab = `💠 *PIX automático — ${unidadeNome}*`;
  if (fonteVelha) return `${cab}\n_A fonte do LA Report não atualizou hoje — não vou cobrar número que não medi._`;
  const todas = linhas || [];
  const noLote = new Set((lote || []).map((l) => l.pagador_chave));
  const cont = contagemPorFatia(todas);
  const linhasTxt = [`${cab} · faltam ${todas.length} · meta ${METAS_BR}`];
  const resumo = [];
  for (const f of FATIAS) {
    const n = cont.get(f) || 0;
    if (!n) continue;
    const doLote = ordenarPorPrioridade(todas.filter((l) => fatiaDoCliente(l) === f && noLote.has(l.pagador_chave)));
    if (!doLote.length) { resumo.push(`${ROTULO[f].emoji} ${ROTULO[f].nome} (${n})`); continue; }
    const extra = f === 'autorizacao_pendente' ? ' — resolver primeiro' : '';
    linhasTxt.push(`${ROTULO[f].emoji} *${ROTULO[f].nome}* (${n})${extra}\n`
      + doLote.map((l) => `   • ${l.pagador_nome}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`).join('\n'));
  }
  if (resumo.length) linhasTxt.push(resumo.join(' · '));
  return linhasTxt.join('\n');
}

const barra = (pct) => { const c = Math.max(0, Math.min(10, Math.round(Number(pct) / 10))); return '▓'.repeat(c) + '░'.repeat(10 - c); };
function ritmoNecessario({ faltam, hojeYmd, metaYmd = META_YMD }) {
  const dias = Math.ceil((Date.parse(metaYmd + 'T00:00:00-03:00') - Date.parse(hojeYmd + 'T00:00:00-03:00')) / 86400000);
  const semanas = Math.max(0, Math.ceil(dias / 7));
  return { semanas, porSemana: semanas ? Math.ceil(faltam / semanas) : faltam };
}
function relatorioSemanal({ unidades, periodoBr, hojeYmd, alertaRitmo = false }) {
  const us = unidades || [];
  const total = us.reduce((s, u) => s + u.total, 0);
  const migrados = us.reduce((s, u) => s + u.migrados, 0);
  const pend = us.reduce((s, u) => s + (u.pendentesAutorizacao || 0), 0);
  const pct = total ? Math.round((migrados / total) * 100) : 0;
  const faltam = total - migrados;
  const r = ritmoNecessario({ faltam, hojeYmd });
  const linhas = [`💠 *PIX automático — semana de ${periodoBr}*`,
    `Geral  ${barra(pct)}  ${pct}%  (${migrados} de ${total}) · meta ${METAS_BR}`];
  for (const u of us) {
    const p2 = u.total ? Math.round((u.migrados / u.total) * 100) : 0;
    linhas.push(`${u.nome} ${barra(p2)} ${p2}% (${u.migrados}/${u.total}) — ${u.migradosNaSemana} nesta semana`);
  }
  if (pend) linhas.push(`🔵 Cadastrados sem cobrança: ${pend}`);
  linhas.push(`Ritmo: faltam ${r.semanas} semanas e ${faltam} clientes → ${r.porSemana} por semana.`);
  if (alertaRitmo) linhas.push('⚠️ Duas semanas seguidas abaixo do ritmo necessário.');
  return linhas.join('\n');
}

module.exports = {
  FATIAS, ROTULO, LOTE_DIARIO, TETO_FILHAS, META_YMD,
  fatiaDoCliente, ordenarPorPrioridade, loteDoDia, contagemPorFatia, tituloDaFilha,
  mensagemDaUnidade, barra, ritmoNecessario, relatorioSemanal,
};

'use strict';
// relatorio-saude.js — monta o relatório das 07h que vai pra DM do Alf ("🔍 Auditoria TOM").
// PURO (sai de dispatcher.js, que importa o mundo). 30/09 (Alf: "está vindo bagunçado"):
//   • placar logo abaixo do título ("✅ 21 de 25 checks OK · ⚠️ 4 alertas");
//   • um BLOCO por check, separado por linha em branco — cada check já traz título + itens;
//   • ordem de quem precisa de gente primeiro: erro → conversas → memórias → sinais de KI → log;
//   • rodapé diz se alguma coisa exige ação.

const STATUS_EMOJI = { ok: '✅', fixed: '🛠️', warning: '⚠️', error: '🔴' };
const ORDEM = ['conversation_quality', 'licoes_pendentes', 'known_issues_regression', 'recurring_errors'];
const _pos = (c) => {
  const i = ORDEM.indexOf(c.name);
  return (c.status === 'error' ? 0 : 1) * 100 + (i < 0 ? ORDEM.length : i);
};
const _plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const COMECA_COM_EMOJI = /^\p{Extended_Pictographic}/u;

function _bloco(c) {
  const d = String(c.detail || '').trim();
  return COMECA_COM_EMOJI.test(d) ? d : `${STATUS_EMOJI[c.status] || '⚠️'} ${d}`;
}

function _amostrasSemMarker(checks) {
  const anm = (checks || []).find((c) => c.name === 'actionable_no_marker');
  if (!anm || !anm.samples || !anm.samples.length) return '';
  return '📋 *Promessas sem persistência (últimas 24h)*\n' + anm.samples.slice(0, 3).map((s, i) => {
    const name = (s.collaborators && s.collaborators.full_name) || 'desconhecido';
    const when = s.created_at ? new Date(s.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    const userText = String(s.reason || '').replace(/^text:/, '').slice(0, 100);
    const tomReply = String(s.raw_excerpt || '').slice(0, 100);
    // A causa (ex.: "MEMORY_SAVE (schema_invalid)") é o que transforma a amostra em algo acionável.
    const causa = s.detalhe ? `\n   _falhou:_ ${s.detalhe}` : '';
    return `${i + 1}. *${name}* (${when})\n   _user:_ "${userText}"\n   _TOM:_ "${tomReply}"${causa}`;
  }).join('\n');
}

// `resumoGov` (opcional) é a seção do que a governança FEZ nas últimas 24h (lib/governanca-resumo).
function formatHealthReport(run, resumoGov = '', { hojeBr } = {}) {
  const head = `🔍 *Auditoria TOM — ${hojeBr}*`;
  const { summary, checks } = run;
  const extras = [_amostrasSemMarker(checks), typeof resumoGov === 'string' ? resumoGov.trim() : '']
    .filter(Boolean);
  if (summary.warning === 0 && summary.error === 0 && summary.fixed === 0) {
    return [`${head}\n✅ Sistema saudável — ${summary.ok} de ${summary.total} checks OK`, ...extras].join('\n\n');
  }
  const placar = [`✅ ${summary.ok} de ${summary.total} checks OK`];
  if (summary.error) placar.push(`🔴 ${_plural(summary.error, 'erro', 'erros')}`);
  if (summary.warning) placar.push(`⚠️ ${_plural(summary.warning, 'alerta', 'alertas')}`);
  if (summary.fixed) placar.push(`🛠️ ${_plural(summary.fixed, 'corrigido', 'corrigidos')}`);
  const blocos = (checks || []).filter((c) => c.status !== 'ok')
    .map((c, i) => ({ c, i })).sort((a, b) => _pos(a.c) - _pos(b.c) || a.i - b.i)
    .map(({ c }) => _bloco(c));
  const rodape = summary.error
    ? `_Precisa de atenção: ${_plural(summary.error, 'check', 'checks')} com erro._`
    : '_Nenhum alerta exige ação obrigatória._';
  return [`${head}\n${placar.join(' · ')}`, ...blocos, ...extras, rodape].join('\n\n');
}

module.exports = { formatHealthReport };

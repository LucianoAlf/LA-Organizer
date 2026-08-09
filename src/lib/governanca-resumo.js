'use strict';
// governanca-resumo.js — a segunda seção do relatório das 07h: o que foi FEITO e o que REINCIDIU.
//
// Até 09/08 o relatório só contava o que está quebrado. Com o agente de governança no ar,
// metade da história é o que já foi consertado — e principalmente o que VOLTOU depois de
// consertado. Sem essa metade, quem lê vê "3 alertas" todo dia e não sabe dizer se o sistema
// está melhorando ou andando em círculo.
//
// A linha de reincidência é o velocímetro do próprio agente: é ela que denuncia fix pontual
// que não pega na raiz. Ver src/lib/placar-governanca.js.

const { calcularPlacar, ehDoAgente, MARCA_AGENTE } = require('./placar-governanca');

const HORAS_PADRAO = 24;
const MAX_CODIGOS = 2;   // WhatsApp num celular; lista longa não é lida

function _n(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

/**
 * Monta a seção. PURA: recebe números prontos, não fala com banco.
 * Devolve '' quando não há dados — a seção some do relatório em vez de imprimir lixo.
 */
function formatarResumoGovernanca(dados) {
  if (!dados || typeof dados !== 'object') return '';

  const correcoes = Array.isArray(dados.correcoes) ? dados.correcoes.filter(Boolean) : [];
  const fechados = _n(dados.achadosFechados);
  const placar = dados.placar && typeof dados.placar === 'object' ? dados.placar : null;
  const reincidentes = placar && Array.isArray(placar.reincidentes) ? placar.reincidentes : [];
  const emParada = placar && Array.isArray(placar.emParada) ? placar.emParada : [];

  const linhas = ['📊 *Governança (24h)*'];

  // O caso mais valioso do relatório: o ciclo parou de rodar e ninguém percebeu.
  if (!dados.cicloRodou) {
    linhas.push('⚠️ O ciclo de governança *não rodou* — nenhum achado foi tratado hoje.');
    return linhas.join('\n');
  }

  if (correcoes.length) {
    const codigos = correcoes.slice(0, MAX_CODIGOS).map((c) => c.codigo).filter(Boolean).join(', ');
    const resto = correcoes.length > MAX_CODIGOS ? ` +${correcoes.length - MAX_CODIGOS}` : '';
    linhas.push(`🚀 ${correcoes.length} correção(ões): ${codigos}${resto}`);
  }
  // Zero não entra: "0 achados fechados" é ruído, não informação.
  if (fechados > 0) linhas.push(`🧹 ${fechados} achado(s) antigo(s) fechado(s) na varredura`);
  if (!correcoes.length && fechados === 0) {
    // Refutar é entrega; rodada sem alvo também. Nunca relatar como fracasso.
    linhas.push('➖ Rodou e não havia alvo para corrigir.');
  }

  if (reincidentes.length) {
    const det = reincidentes.slice(0, MAX_CODIGOS).map((r) => `${r.codigo} (${_n(r.vezes)}x)`).join(', ');
    linhas.push(`♻️ *Reincidiu:* ${det}`);
    if (emParada.length) {
      linhas.push(`🛑 Em parada (2x): ${emParada.slice(0, MAX_CODIGOS).join(', ')} — precisa de raiz, não de fix.`);
    }
  } else {
    const n = placar ? _n(placar.fechados) : 0;
    linhas.push(n > 0
      ? `♻️ Nenhuma reincidência — ${n} conserto(s) do agente de pé.`
      : '♻️ Nenhuma reincidência.');
  }

  return linhas.join('\n');
}

/**
 * Busca os números das últimas `horas`. Nunca lança: sem dados o relatório sai sem a seção,
 * que é melhor que o relatório inteiro falhar por causa dela.
 */
async function carregarResumoGovernanca(sb, { horas = HORAS_PADRAO, ymd = null } = {}) {
  try {
    const desde = new Date(Date.now() - horas * 3600_000).toISOString();
    const desde90 = new Date(Date.now() - 90 * 86400000).toISOString();

    const [kisRes, findRes, kis90Res, ritualRes] = await Promise.all([
      sb.from('tom_known_issues').select('codigo, fix_resumo, corrigido_em')
        .not('corrigido_em', 'is', null).gte('corrigido_em', desde),
      sb.from('tom_audit_findings').select('id').gte('verified_at', desde),
      sb.from('tom_known_issues').select('codigo, corrigido_em, fix_resumo')
        .not('corrigido_em', 'is', null).gte('corrigido_em', desde90),
      sb.from('ritual_logs').select('id').eq('ritual_type', 'gov_agent')
        .eq('reference_date', ymd || new Date().toISOString().slice(0, 10))
        .eq('status', 'sent').limit(1),
    ]);

    // Findings dos 90 dias para o placar (mesma janela do ciclo, senão a taxa não bate).
    const { data: findPlacar } = await sb.from('tom_audit_findings')
      .select('promoted_code, incident_at, auto_triage')
      .not('promoted_code', 'is', null).gte('incident_at', desde90);

    return {
      cicloRodou: !!(ritualRes.data && ritualRes.data.length),
      correcoes: (kisRes.data || []).filter(ehDoAgente),
      achadosFechados: (findRes.data || []).length,
      placar: calcularPlacar(kis90Res.data || [], findPlacar || []),
    };
  } catch (e) {
    console.warn('[governanca-resumo] não consegui montar a seção:', e.message);
    return null;
  }
}

module.exports = { formatarResumoGovernanca, carregarResumoGovernanca, MARCA_AGENTE, HORAS_PADRAO };

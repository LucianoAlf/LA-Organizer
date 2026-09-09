'use strict';
// regressao-format.js — ALARME-DE-REGRESSAO-NOMEIA-O-KI-ERRADO (medido 09/09/2026).
//
// O check de regressão dizia, palavra por palavra:
//
//   "🔁 1 regressão(ões): PROMISE-DOWNGRADE-REBAIXA-ADMISSAO ... (corrigido 31/08, voltou 3×)"
//
// Fui ver os 3 disparos. São os DOIS incidentes que o agente de governança consertou naquela
// mesma manhã — Rafinha 08/09 11:11 e Yuri 08/09 15:41/15:42 — e a raiz deles não era o KI de
// 31/08. O sinal daquele KI é `CHOKEPOINT confab:promise_nomarker`: o nome da PORTA, não do
// defeito. Quem passa pela porta leva o nome do KI mais velho que tem sensor plugado nela.
//
// E não é caso isolado: QUATRO KIs corrigidos compartilham o sinal `CONFIRM_NOEXEC`. Com um
// curinga ingênuo, um disparo viraria quatro alarmes idênticos apontando defeitos diferentes.
//
// A distinção que este módulo carrega:
//
//   • a PORTA disparar é fato — mediu-se um evento no marker_logs;
//   • o DEFEITO ter voltado é hipótese — precisa de alguém olhar o turno.
//
// Então o alarme para de afirmar a segunda coisa. Ele diz qual porta disparou, quantas vezes,
// pra quem, e QUAIS KIs corrigidos compartilham aquele sinal — que é a lista de suspeitos, não
// o culpado. Quem lê continua sabendo onde procurar; deixa de ser levado ao nome errado.
//
// Mesma familia de `project_gate_media_a_citacao_como_fala` e do alarme falso da janela do
// consumidor: instrumento que mede o MECANISMO e reporta como se tivesse medido a INTENÇÃO.

function _fmtData(d) {
  if (!d) return '?';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '?';
  return dt.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
  });
}

/**
 * Agrupa as linhas devolvidas por evaluate_known_issues() pelo SINAL que as disparou.
 *
 * @param {Array} regs  [{ codigo, titulo, corrigido_em, ocorrencias_novas, afetados, sinal_padrao }]
 * @returns {Array} [{ sinal, ocorrencias, afetados:[], codigos:[{codigo,titulo,corrigido_em}] }]
 */
function agruparPorSinal(regs) {
  const arr = Array.isArray(regs) ? regs : [];
  const porSinal = new Map();
  for (const r of arr) {
    if (!r || !r.codigo) continue;
    // Sem sinal declarado, cada KI é seu próprio grupo — não dá pra afirmar que compartilham.
    const chave = r.sinal_padrao ? String(r.sinal_padrao) : `__sem_sinal__:${r.codigo}`;
    if (!porSinal.has(chave)) {
      porSinal.set(chave, {
        sinal: r.sinal_padrao ? String(r.sinal_padrao) : null,
        ocorrencias: 0, afetados: new Set(), codigos: [],
      });
    }
    const g = porSinal.get(chave);
    // Os N KIs que dividem um sinal recebem a MESMA contagem da RPC (cada um consultou o mesmo
    // marker_logs). Somar daria 4x o número de eventos que de fato aconteceram.
    g.ocorrencias = Math.max(g.ocorrencias, Number(r.ocorrencias_novas) || 0);
    for (const a of (Array.isArray(r.afetados) ? r.afetados : [])) if (a) g.afetados.add(a);
    g.codigos.push({ codigo: r.codigo, titulo: r.titulo || '', corrigido_em: r.corrigido_em || null });
  }
  return [...porSinal.values()].map((g) => ({
    sinal: g.sinal, ocorrencias: g.ocorrencias,
    afetados: [...g.afetados], codigos: g.codigos,
  }));
}

/**
 * Texto do check. Fala de PORTA que disparou, com os KIs como suspeitos.
 */
function formatarRegressoes(regs) {
  const grupos = agruparPorSinal(regs);
  if (!grupos.length) return { status: 'ok', detail: 'Nenhum sinal de incidente conhecido disparou' };

  const linhas = grupos.map((g) => {
    const quem = g.afetados.length ? ` · ${g.afetados.join(', ')}` : '';
    const porta = g.sinal ? `\`${g.sinal}\`` : g.codigos[0].codigo;
    const suspeitos = g.codigos.length === 1
      ? `${g.codigos[0].codigo} (corrigido ${_fmtData(g.codigos[0].corrigido_em)})`
      : `${g.codigos.length} KIs corrigidos usam este sinal: ${g.codigos.map((c) => c.codigo).join(', ')}`;
    return `${porta} disparou ${g.ocorrencias}×${quem} — ${suspeitos}`;
  });

  const n = grupos.length;
  return {
    status: 'warning',
    // "sinal(is) de KI corrigido disparou" e não "regressão": o disparo é fato, a regressão é
    // hipótese. Quem confirma é quem abre o turno — e a ETAPA 2.7 do protocolo manda fazer isso.
    detail: `🔁 ${n} sinal(is) de KI corrigido disparou nas últimas 24h — CONFIRME o turno antes de tratar como regressão: ${linhas.join('; ')}`,
  };
}

module.exports = { agruparPorSinal, formatarRegressoes };

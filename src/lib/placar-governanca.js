'use strict';
// placar-governanca.js — ETAPA 1 do protocolo do agente de governança.
//
// A pergunta que ele faz antes de qualquer coisa: "dos KIs que EU fechei, quantos voltaram?".
// É pré-requisito, não lembrete: sem o placar não há etapa 2. Isso existe porque a lição de
// 27/07 do Alf — 391 known-issues corrigidos e o sistema seguia instável — precisa virar algo
// que o próprio agente meça, e não uma frase num documento.
//
// A marca de autoria vive no `fix_resumo` e não numa coluna nova: a tabela já tem o campo e
// ele é livre, então zero migration. Sem a marca o agente mediria os fixes do Catraca e do
// Hugo como se fossem dele.

const MARCA_AGENTE = '[gov-agent]';
const LIMITE_PARADA = 2;   // mesmo KI voltando 2x = fix pontual não resolve; escala

function ehDoAgente(ki) {
  return !!(ki && typeof ki.fix_resumo === 'string' && ki.fix_resumo.trimStart().startsWith(MARCA_AGENTE));
}

/**
 * Placar dos consertos do agente. Puro: sem banco, sem relógio.
 *
 * Conta como reincidência o finding TRIADO como regressão que satisfaz UMA das duas:
 *
 *  1. `incident_at` posterior ao `corrigido_em` — o bug voltou depois do fix, caso óbvio.
 *  2. a triagem (`decided_at`) é ANTERIOR ao `corrigido_em` atual — ou seja, o auditor julgou
 *     esta regressão contra um fix mais VELHO, e o KI foi reconsertado depois.
 *
 * A regra 2 não é refinamento, é o que faz o placar existir. `corrigido_em` é MUTÁVEL: cada
 * reconserto sobrescreve a data e empurra o fix pra frente dos incidentes antigos. Só com a
 * regra 1, todo reconserto apagaria a reincidência que o motivou, e `emParada` — a única trava
 * contra consertar a mesma família pra sempre — nunca dispararia. Descoberto rodando contra o
 * banco real em 08/08: os 2 KIs que reincidiram de verdade davam ZERO.
 *
 * O que sobra fora das duas é cauda de detecção: incidente anterior ao fix, triado depois dele
 * (lição do AUDIT-REGRESSION-LASTSEEN). Esse não conta.
 */
function calcularPlacar(kis, findings) {
  const meus = (Array.isArray(kis) ? kis : []).filter(ehDoAgente);
  const porCodigo = new Map();
  for (const k of meus) {
    if (k && k.codigo) porCodigo.set(String(k.codigo), Date.parse(k.corrigido_em || ''));
  }

  const vezesPorCodigo = new Map();
  for (const f of (Array.isArray(findings) ? findings : [])) {
    if (!f || !f.promoted_code) continue;
    const codigo = String(f.promoted_code);
    if (!porCodigo.has(codigo)) continue;                       // não é KI meu
    const triagem = f.auto_triage || {};
    if (triagem.decision !== 'regression') continue;
    const tFix = porCodigo.get(codigo);
    const tInc = Date.parse(f.incident_at || '');
    if (!Number.isFinite(tFix) || !Number.isFinite(tInc)) continue;
    const tTriagem = Date.parse(triagem.decided_at || '');
    const julgadaContraFixAnterior = Number.isFinite(tTriagem) && tTriagem <= tFix;
    if (tInc <= tFix && !julgadaContraFixAnterior) continue;    // cauda de detecção
    vezesPorCodigo.set(codigo, (vezesPorCodigo.get(codigo) || 0) + 1);
  }

  const reincidentes = [...vezesPorCodigo.entries()].map(([codigo, vezes]) => ({ codigo, vezes }));
  const emParada = reincidentes.filter((r) => r.vezes >= LIMITE_PARADA).map((r) => r.codigo);
  const fechados = porCodigo.size;
  return {
    fechados,
    reincidentes,
    emParada,
    taxa: fechados ? reincidentes.length / fechados : 0,
  };
}

module.exports = { calcularPlacar, ehDoAgente, MARCA_AGENTE, LIMITE_PARADA };

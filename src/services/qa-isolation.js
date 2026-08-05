// src/services/qa-isolation.js
// Isolamento dos perfis de QA do Replay Lab — em CÓDIGO, não em convenção.
//
// O Alfredo foi explícito: criar o perfil com nome `[QA]` é etiqueta, não impede nada.
// Cada fronteira precisa de um guard com teste próprio. Este módulo concentra a decisão
// "isto é QA?" para que os guards não divirjam entre si — divergir é como a regra do
// lembrete acabou existindo no snooze e faltando no reagendamento.
//
// DUAS FONTES, de propósito (defesa em profundidade):
//   * telefone na faixa reservada 5500... (DDD 00 não existe no Brasil);
//   * nome começando com `[QA]`.
// Basta UMA para tratar como QA. Um perfil renomeado por engano continua isolado pelo
// telefone; um telefone digitado errado continua isolado pelo nome.
//
// A fronteira mais importante é a das MÉTRICAS: os cenários geram exatamente os sintomas
// que o detector procura. Sem exclusão, o laboratório contamina `tom_audit_findings` e a
// métrica que usamos para priorizar passa a contar teste como falha real — seria sabotar
// o próprio diagnóstico.
'use strict';

const FAIXA_QA = /^5500\d{9}$/;
const PREFIXO_NOME_QA = '[QA]';

function _soDigitos(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function ehTelefoneQA(phone) {
  return FAIXA_QA.test(_soDigitos(phone));
}

function ehNomeQA(nome) {
  return typeof nome === 'string' && nome.trim().startsWith(PREFIXO_NOME_QA);
}

// Aceita o objeto do colaborador, um telefone solto ou um nome solto.
function ehQA(alvo) {
  if (!alvo) return false;
  if (typeof alvo === 'string') return ehTelefoneQA(alvo) || ehNomeQA(alvo);
  if (typeof alvo === 'object') return ehTelefoneQA(alvo.phone) || ehNomeQA(alvo.full_name);
  return false;
}

// ---- Fronteiras ----

// Grupo: perfil de QA nunca participa de chat de grupo. Um cenário de QA num grupo real
// colocaria mensagem de teste na frente do time.
function permiteGrupo(alvo) {
  return !ehQA(alvo);
}

// Delegação: QA só delega para QA, e gente só delega para gente. Uma tarefa de teste
// caindo na fila de uma pessoa real é cobrança que ela vai receber de verdade.
function permiteDelegacao(de, para) {
  return ehQA(de) === ehQA(para);
}

// Métricas e findings: QA nunca entra. Sem isto o laboratório contamina a base que
// orienta a priorização.
function contaNasMetricas(alvo) {
  return !ehQA(alvo);
}

// Governança: QA fora de digest de liderança, scorecard e matriz.
function entraEmGovernanca(alvo) {
  return !ehQA(alvo);
}

// Turno: a trava de saída age sobre o MODO do turno, não sobre o destino — então o turno
// precisa NASCER marcado, no webhook, antes de qualquer resposta. Sem isto a resposta
// conversacional inteira escapa da trava (achado de 05/08 no cenário A).
//
// Só a FAIXA reservada marca, de propósito: o nome `[QA]` só é conhecido depois de
// consultar o banco, e a marcação precisa acontecer antes dos fallbacks de mídia, que
// respondem sem passar por lá. Em produção nenhum telefone cai na faixa — no-op.
function contextoDeTurno(phone, { runId = null } = {}) {
  if (!ehTelefoneQA(phone)) return {};
  return { qa: true, runId: runId || null };
}

// Escopo de VARREDURA em replay. Os cobradores varrem a tabela inteira por data; com o
// relógio adiantado pelo laboratório, eles selecionam o mundo real. Isto devolve os perfis
// que um sweep pode enxergar durante um replay — e devolve VAZIO em qualquer dúvida
// (nenhum perfil, banco fora do ar), porque em replay calar é o lado seguro.
//
// Implementação única de propósito: cada sweep que ganhar o guard usa ESTA função. Guard
// duplicado é como a regra do lembrete acabou existindo no snooze e faltando no
// reagendamento — a divergência aparece meses depois, num incidente.
async function idsDePerfisQA(supabase) {
  try {
    const { data, error } = await supabase.from('collaborators').select('id, phone');
    if (error || !data) return [];
    return data.filter(c => ehTelefoneQA(c.phone)).map(c => c.id);
  } catch (_) {
    return [];
  }
}

module.exports = {
  ehQA, ehTelefoneQA, ehNomeQA,
  permiteGrupo, permiteDelegacao, contaNasMetricas, entraEmGovernanca, contextoDeTurno,
  idsDePerfisQA, FAIXA_QA, PREFIXO_NOME_QA,
};

'use strict';
// escopo-cancelamento.js — CANCELA-SERIE-PROMETE-TODOS (Anne 24/07 — finding d59121d6).
//
// "Marcar endócrino" era uma rotina (≥ 10 ocorrências). Anne: "Cancela" → TOM: "Cancelado. Tiro
// TODOS do sistema." → "Sim" → "✅ Fora do sistema." — e cancelou UMA ocorrência: quem decidia o
// alcance era o LLM (scope:"series" no marker) e ele não mandou. O lembrete do dia seguinte veio
// de outra cópia; o balanço listou a tarefa 4x.
//
// Regra (decisão de conceito, Alf 11/09 "acerta o que é conceito"): o alcance sai do que FOI DITO
// — pelo pedido OU pela própria fala do TOM. Prometeu "todos/de vez/fora do sistema" → a rotina
// inteira. Pedido de uma vez só ("só hoje", "só essa") → a ocorrência. Sem sinal → a ocorrência,
// e o TOM avisa que a rotina continua (nunca mais "tiro todos" com um só cancelado). PURO.

const UNICA_RE = /\b(?:s[óo]|somente|apenas)\s+(?:a\s+|o\s+)?(?:de\s+)?(?:hoje|amanh[ãa]|ess[ea]|est[ea]|dessa|desta|dessa\s+semana|desta\s+semana|essa\s+vez|desta\s+vez)\b|\b(?:hoje|amanh[ãa])\s+n[ãa]o\b|\bs[óo]\s+(?:hoje|amanh[ãa])\b/i;
const SERIE_RE = /\b(?:tod[ao]s|de\s+vez|de\s+uma\s+vez|n[ãa]o\s+vai\s+(?:ter|mais)|n[ãa]o\s+quero\s+mais|n[ãa]o\s+preciso\s+mais|para\s+de\s+me\s+(?:lembrar|cobrar)|encerr[ao]|tir[ao]r?\s+da\s+lista|(?:fora|sai|saiu)\s+do\s+sistema|a\s+rotina|a\s+s[ée]rie|nunca\s+mais)\b/i;

/**
 * @param {{pedido?:string, resposta?:string, ehSerie:boolean, scopeLLM?:string}} p
 * @returns {{escopo:'series'|'occurrence', motivo:'llm'|'nao_serie'|'unica'|'pedido'|'resposta'|'padrao'}}
 */
function decidirEscopoCancelamento({ pedido = '', resposta = '', ehSerie = false, scopeLLM } = {}) {
  if (!ehSerie) return { escopo: 'occurrence', motivo: 'nao_serie' };
  if (scopeLLM === 'series') return { escopo: 'series', motivo: 'llm' };
  const p = String(pedido || '');
  if (UNICA_RE.test(p)) return { escopo: 'occurrence', motivo: 'unica' };
  if (SERIE_RE.test(p)) return { escopo: 'series', motivo: 'pedido' };
  if (SERIE_RE.test(String(resposta || ''))) return { escopo: 'series', motivo: 'resposta' };
  return { escopo: 'occurrence', motivo: 'padrao' };
}

function avisoSoOcorrencia(titulo, due) {
  const d = String(due || '').slice(0, 10);
  const dm = /^\d{4}-\d{2}-\d{2}$/.test(d) ? ` de ${d.slice(8, 10)}/${d.slice(5, 7)}` : '';
  return `🔁 Cancelei só a${dm} de *${String(titulo || 'tarefa').slice(0, 60)}* — a rotina continua. Se é pra parar de vez, me diz "tira a rotina toda".`;
}

module.exports = { decidirEscopoCancelamento, avisoSoOcorrencia };

// src/services/governance-analyzer.js — Sprint 29.1
//
// Por que existe: lista plana de 12 tasks não vira ação. Alf lê e ignora.
// Aqui agrupamos por dono e geramos UM diagnóstico curto via LLM por pessoa
// que tem 3+ itens parados — com sumário (o quê), hipótese (por quê) e
// recomendação (o quê faz agora).
//
// Determinístico no agrupamento e nos dados base. LLM só compõe a frase final
// (max 2 linhas). Se LLM falha, fallback determinístico garante mensagem.

const ai = require('../ai/provider');

/**
 * Gera diagnóstico para 1 pessoa com 3+ itens parados.
 * @param {Object} opts
 * @param {string} opts.ownerName — nome exibido (primeiro nome ou full)
 * @param {Array<Object>} opts.items — [{title, due_date, daysOverdue, category, coordination_request_count}]
 * @returns {Promise<string|null>} — linha pronta pra colar na msg, ou null se <3 items
 */
async function analyzePersonBacklog({ ownerName, items }) {
  if (!items || items.length < 3) return null;

  const categories = items.map(i => i.category || 'sem_categoria');
  const dominantCategory = _mode(categories);
  const allSameCategory = new Set(categories).size === 1;
  const dominantShare = Math.round(100 * categories.filter(c => c === dominantCategory).length / categories.length);
  const avgOverdue = Math.round(items.reduce((s, i) => s + (i.daysOverdue || 0), 0) / items.length);
  const stuckCount = items.filter(i => (i.coordination_request_count || 0) >= 3).length;

  const sys = `Você é analista de operações sênior. Recebe um backlog parado e gera UM diagnóstico em PT-BR no formato exato:

"🔍 *${ownerName}:* {sumário} {hipótese}

💡 *Recomendação:* {ação concreta}"

REGRAS RÍGIDAS:
- Sumário: número total + categoria dominante. Ex: "5 atrasadas em operacional (compras Recreio + dispenser)".
- Hipótese: causa provável em ≤8 palavras. Ex: "Sem movimento há 7d, sem orçamento aprovado?".
- Recomendação: ação CONCRETA do CEO HOJE. Verbo direto. Ex: "Libera verba ou redistribui." / "Marca 1:1 30min hoje 16h."
- Se tiver tasks com 3+ cobranças sem efeito, dizer EXPLICITAMENTE: "cobrar mais não resolve".
- A Recomendação SEMPRE em linha separada (linha em branco antes, emoji 💡 antes do *Recomendação:*).
- Max 3 linhas no total. Sem floreio. Sem "vamos alinhar/acompanhar/revisar".
- NUNCA usar emoji além do 🔍 inicial e do 💡 antes de Recomendação.`;

  const userMsg = `Pessoa: ${ownerName}
Total parado: ${items.length} (média ${avgOverdue}d atrasados)
Categoria dominante: ${dominantCategory} (${allSameCategory ? 'TODOS' : dominantShare + '%'} dos itens)
Tasks com 3+ cobranças sem efeito: ${stuckCount}/${items.length}
Lista (até 8 primeiras):
${items.slice(0, 8).map(i => `- ${(i.title || '?').slice(0, 50)} (${i.daysOverdue || 0}d, ${i.category || '?'}, cobranças=${i.coordination_request_count || 0})`).join('\n')}`;

  try {
    const r = await ai.chat(sys, [{ role: 'user', content: userMsg }]);
    const txt = String(r?.text || r?.reply || r?.content || '').trim();
    if (txt && txt.startsWith('🔍')) return txt;
    // LLM não seguiu formato → fallback
    return _fallbackDiagnostic({ ownerName, items, dominantCategory, stuckCount });
  } catch (err) {
    console.warn(`[governance-analyzer] LLM err for ${ownerName}:`, err.message);
    return _fallbackDiagnostic({ ownerName, items, dominantCategory, stuckCount });
  }
}

function _fallbackDiagnostic({ ownerName, items, dominantCategory, stuckCount }) {
  const base = `🔍 *${ownerName}:* ${items.length} pendências em ${dominantCategory || 'misturado'}`;
  if (stuckCount >= 3) {
    return `${base}, ${stuckCount} já cobradas 3+ vezes sem efeito.\n\n💡 *Recomendação:* mudar tática (1:1 ou ligar) — cobrar mais não resolve.`;
  }
  return `${base}, sem movimento.\n\n💡 *Recomendação:* 1:1 hoje pra destravar.`;
}

function _mode(arr) {
  const counts = {};
  for (const x of arr) counts[x] = (counts[x] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}

module.exports = { analyzePersonBacklog };

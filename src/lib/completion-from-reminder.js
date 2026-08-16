// src/lib/completion-from-reminder.js
'use strict';
// FATIA 1 do "não consegui registrar" (raiz 1a): a confirmação seca do usuário se refere ao
// que o TOM ACABOU DE LEMBRAR. O lembrete vem do disparo (dispatcher), mas já está gravado em
// conversation_history com ref_type='task'/ref_id (Lote D / sendAndLink). Aqui só se DECIDE o
// alvo — PURO, padrão do task-target.js. O engine busca as refs e executa.
//
// Freio do Alf: >1 tarefa DISTINTA lembrada = ambiguidade real, PERGUNTA — nunca escolhe pela
// mais recente. Só o mesmo task_id repetido colapsa (lembrete duplicado da mesma tarefa).

const JANELA_MS = 24 * 3600 * 1000;

// Conclusão inequívoca: whitelist conservadora. Na dúvida devolve false (deixa o fluxo atual
// seguir; nunca inventa conclusão). Veto de negação e de pergunta.
const CONCLUSAO_RE = /\b(feito|feita|pronto|prontinh[oa]|conclu[ií]d[oa]|conclu[ií]|okay|ok|isso|fechad[oa]|fechei|resolvid[oa]|resolvi|j[áa]\s+(?:fiz|foi|est[áa])|foi\s+feit[oa]|pode\s+(?:marcar|fechar|concluir))\b/i;
const NEGACAO_RE = /\b(n[ãa]o|ainda\s+n[ãa]o|nem)\b/i;

function ehConclusaoInequivoca(reply) {
  const t = String(reply || '').trim();
  if (!t || t.length > 120) return false;   // frase longa = não é confirmação seca
  if (t.endsWith('?')) return false;         // pergunta não confirma
  if (NEGACAO_RE.test(t)) return false;      // "não fiz" / "ainda não"
  return CONCLUSAO_RE.test(t);
}

function resolverConclusaoDeLembrete({ reply, refsRecentes, agoraMs } = {}) {
  if (!ehConclusaoInequivoca(reply)) return { modo: 'nenhum', motivo: 'nao_conclusao' };
  const agora = Number.isFinite(agoraMs) ? agoraMs : NaN;
  if (!Number.isFinite(agora)) return { modo: 'nenhum', motivo: 'sem_relogio' };

  const dentro = (Array.isArray(refsRecentes) ? refsRecentes : [])
    .filter((r) => r && r.task_id && r.reminded_at)
    .filter((r) => {
      const t = Date.parse(r.reminded_at);
      return Number.isFinite(t) && (agora - t) >= 0 && (agora - t) <= JANELA_MS;
    });
  if (dentro.length === 0) return { modo: 'nenhum', motivo: 'sem_ref_na_janela' };

  // Dedup por task_id: colapsa lembrete repetido da MESMA tarefa (a mais recente do mesmo id).
  // "A mais recente vence" vale SÓ dentro do mesmo id — NUNCA entre ids distintos (freio #2).
  const porId = new Map();
  for (const r of dentro) {
    const prev = porId.get(r.task_id);
    if (!prev || Date.parse(r.reminded_at) > Date.parse(prev.reminded_at)) porId.set(r.task_id, r);
  }
  const distintos = [...porId.values()];
  if (distintos.length === 1) {
    return { modo: 'exato', taskId: distintos[0].task_id, title: distintos[0].title || null, motivo: 'unico' };
  }
  // >1 tarefa distinta → ambiguidade real. Colapso de série adiado (freio #2): perguntar é seguro.
  return {
    modo: 'ambiguo',
    candidatos: distintos.map((r) => ({ taskId: r.task_id, title: r.title || null })),
    motivo: 'multiplas_distintas',
  };
}

module.exports = { resolverConclusaoDeLembrete, ehConclusaoInequivoca, JANELA_MS };

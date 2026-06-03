// src/services/reply-classify.js
// Sprint 31.10 — heurísticas PURAS de classificação da reply do TOM, usadas pelo
// detector ACTIONABLE_NO_MARKER (engine.js) pra NÃO acusar como "ação não-persistida"
// situações que são, na verdade, TOM perguntando / pedindo dado / convidando o user
// a mandar algo. Extraído pra cá porque a regex inline sem teste foi a causa de o
// incidente C1 ("ACTIONABLE_NO_MARKER inflado") reincidir 2× — agora tem teste.
//
// Funções puras (sem I/O, sem estado) → fáceis de testar e raciocinar.

// Conjunto de "fechadores" que costumam vir DEPOIS do "?" e não cancelam a pergunta.
// Ex.: "Que horas? (14h, 15h?)" — o ")" final fazia /\?\s*$/ falhar e inflar a métrica.
const _TAIL_HAS_ALNUM = /[\p{L}\p{N}]/u;

/**
 * A reply é uma PERGUNTA (info-gathering) mesmo que haja pontuação/emoji após o "?".
 * Regra: pega o trecho APÓS o último "?"; se ele só tem fechadores/espaços/emoji
 * (nenhuma letra ou dígito), a reply termina perguntando → true. Se há texto de
 * verdade depois (uma afirmação nova), → false.
 */
function hasTrailingQuestion(reply) {
  const s = String(reply == null ? '' : reply);
  const idx = s.lastIndexOf('?');
  if (idx === -1) return false;
  const tail = s.slice(idx + 1);
  // Se o que vem depois do último "?" contém letra/número, é uma nova frase
  // afirmativa — não é mais uma pergunta no fim.
  return !_TAIL_HAS_ALNUM.test(tail);
}

// TOM está PEDINDO ao user que mande/diga algo pra ele poder agir — ou seja, ainda
// NÃO agiu (não há o que persistir neste turno). Não confundir com "já registrei".
const _INFO_GATHERING_RE = /\b(?:me\s+(?:manda|mande|envia|envie|diz|diga|passa|passe)|vai\s+(?:mandando|listando))\b/i;

/**
 * A reply pede um insumo ao user pra prosseguir (convite/futuro), logo não é uma
 * ação concluída. Ex.: "Vai listando que eu vou registrando", "Me manda de novo",
 * "Me diz a unidade e a sala que eu registro".
 */
function isInfoGatheringReply(reply) {
  const s = String(reply == null ? '' : reply);
  if (!s.trim()) return false;
  return _INFO_GATHERING_RE.test(s);
}

module.exports = { hasTrailingQuestion, isInfoGatheringReply };

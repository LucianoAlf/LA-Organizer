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

// Sprint 31.19 (caso Dai 05/06) — TOM PEDINDO CONFIRMAÇÃO antes de agir ("Certo? Se
// confirmar, fecho...") NÃO é promessa quebrada — é o comportamento CERTO (perguntar →
// agir só após "Confirmo"). O hasTrailingQuestion só olha o FINAL; aqui o "Certo?" e o
// "Se confirmar" vêm no MEIO e a frase termina em ponto, então escapavam → falso positivo
// no radar ACTIONABLE_NO_MARKER. Detecta o condicional "se confirmar/ok/aprovar/topar" e
// a pergunta de confirmação em qualquer posição.
//
// #1B (BATCH-CONFIRM família, caso Rose 28/06 22:47) — a 2ª alternativa só pegava a
// palavra-confirm COLADA no "?" ("certo?"). "Tá certo ISSO?" tem palavra entre "certo" e
// "?" → escapava → chokepoint false-fire num preview. Fix: aceita até ~15 chars (sem "?"
// nem quebra de linha) entre a palavra-confirm e o "?". O limite de 15 mantém narrow:
// claim real + pergunta não-confirmatória longe ("✅ Fechei tudo. Mais alguma coisa?")
// NÃO casa → o chokepoint segue disparando no confab.
const _CONFIRM_SEEKING_RE = /\bse\s+(?:voc[êe]\s+)?(?:confirmar|confirma|ok|aprovar|topar|fechar)\b|\b(?:certo|confirma|confirmo|confirmar)\b[^?\n]{0,15}\?/i;

/**
 * A reply pede um insumo ao user pra prosseguir (convite/futuro) OU pede confirmação
 * antes de agir — logo não é ação concluída. Ex.: "Vai listando que eu registro",
 * "Me manda de novo", "Certo? Se confirmar, fecho a tarefa antiga".
 */
function isInfoGatheringReply(reply) {
  const s = String(reply == null ? '' : reply);
  if (!s.trim()) return false;
  return _INFO_GATHERING_RE.test(s) || _CONFIRM_SEEKING_RE.test(s);
}

module.exports = { hasTrailingQuestion, isInfoGatheringReply };

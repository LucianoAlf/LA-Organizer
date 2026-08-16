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
// CHOKEPOINT-FALSEFIRE-CAPABILITY-ANSWER (Rose 06/07): "Sim! *Pode mandar* o OFX que eu
// leio, mostro a prévia e te pergunto se quer registrar" é resposta de CAPACIDADE (TOM
// pede o insumo pra agir DEPOIS) — mas escapava do gate (não tinha "me manda") e o verbo
// futuro "leio/registro" disparava promise_nomarker → o chokepoint destruiu a resposta boa
// com "problema técnico, nada entrou na agenda". "(pode) mandar/enviar/passar" = pedido de
// insumo, não promessa concluída.
const _INFO_GATHERING_RE = /\b(?:me\s+(?:manda|mande|envia|envie|diz|diga|passa|passe)|vai\s+(?:mandando|listando)|(?:pode|podes|pode\s+me)\s+(?:mandar|manda|enviar|envia|passar|passa))\b/i;

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
//
// CHOKEPOINT-FALSEFIRE-RESPONDE-SIM-NAO (Luciano 02/07 09:43) — a pergunta de confirmação
// do participant_add termina em "Responde *sim* ou *não*." SEM "?" no fim. Nem
// hasTrailingQuestion nem as 2 alternativas acima pegavam → o chokepoint tratou como
// confab e SUBSTITUIU a pergunta por "problema técnico ... nada entrou na agenda" (matou
// o fluxo; Alf repetiu 2x). A 3ª alternativa reconhece o imperativo "responde/responda …
// sim/não" como confirm-seeking. (\brespond[ae]\b não casa "respondendo" — o \b barra.)
const _CONFIRM_SEEKING_RE = /\bse\s+(?:voc[êe]\s+)?(?:confirmar|confirma|ok|aprovar|topar|fechar)\b|\b(?:certo|confirma|confirmo|confirmar)\b[^?\n]{0,15}\?|\brespond[ae]\b[^?\n]{0,30}\b(?:sim|n[ãa]o)\b/i;

// FATIA 2 (16/08) — as duas metades semânticas de info-gathering, separadas. O chokepoint de
// honestidade (enforceNoMarkerHonesty) só pode vetar a camada FORTE pela metade CONTENT-
// SOLICITATION: "TOM pede insumo" ⇒ ele NÃO afirmou ação feita ⇒ turno de composição, o rodapé
// de erro é falso-fire. A metade CONFIRM-SEEKING ("certo? / responde sim-não") acompanha AÇÃO
// pendente e pode vir com claim de confab real — vetá-la reabriria a Bianca (09/08). Por isso
// a remoção de 09/08 tirou o veto INTEIRO; aqui devolvemos só a metade segura.

/** TOM pede que o user mande/liste conteúdo pra ele agir depois — composição, não ação feita. */
function isContentSolicitationReply(reply) {
  const s = String(reply == null ? '' : reply);
  if (!s.trim()) return false;
  return _INFO_GATHERING_RE.test(s);
}

/** TOM pede CONFIRMAÇÃO de uma ação pendente ("certo?", "responde sim/não") antes de agir. */
function isConfirmSeekingReply(reply) {
  const s = String(reply == null ? '' : reply);
  if (!s.trim()) return false;
  return _CONFIRM_SEEKING_RE.test(s);
}

/**
 * A reply pede um insumo ao user pra prosseguir (convite/futuro) OU pede confirmação
 * antes de agir — logo não é ação concluída. Ex.: "Vai listando que eu registro",
 * "Me manda de novo", "Certo? Se confirmar, fecho a tarefa antiga".
 * União das duas metades — comportamento preservado para os consumidores existentes.
 */
function isInfoGatheringReply(reply) {
  return isContentSolicitationReply(reply) || isConfirmSeekingReply(reply);
}

module.exports = { hasTrailingQuestion, isInfoGatheringReply, isContentSolicitationReply, isConfirmSeekingReply };

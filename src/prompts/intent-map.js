'use strict';
// O Mapa (Fase 1) — classificador de intenção PURO (sem LLM). Decide o loadout do prompt.
// Conservador: na menor dúvida → operational (caminho completo de hoje). Ver
// docs/superpowers/specs/2026-07-01-mapa-intencao-prompt-design.md
const { stripReplyScaffold } = require('../events/detect-approval-reply');

const LOADOUTS = {
  conversational: { skill: null, contextBlocks: 'minimal', decompose: false },
  operational: { skill: 'auto', contextBlocks: 'full', decompose: 'auto' },
};

// Qualquer verbo de ação → operational. (palavras ASCII; \b seguro aqui)
const ACTION_RE = /\b(cri[ae]|criar|fech[ae]|fechar|conclu|reagend|remarc|delega|cobr[ae]|cobrar|apag|delet|cancel|marc[ae]|marcar|adicion|registr|agend[ae]|lembr|avis|mand[ae]|mandar|envi|salv|edit|atualiz|mov[ae]|arquiv|aprov|rejeit|paus|planej|organiz|list[ae]|listar|resum|separ|conta)\b/i;
// Pergunta sobre dado do sistema → operational.
const DATA_Q_RE = /\b(quant[ao]s?|quais|qual|cad[êe]|onde|quando|meus?|minhas?|tenho|tarefas?|projetos?|eventos?|agenda|h[áa]bitos?|prazos?|pend[êe]ncias?|financ|gast[oa]s?|contas?|relat[óo]ri)\b/i;
// Papo puro — testados sobre o NÚCLEO já normalizado (coreText). Âncora (?=\s|$) em vez de
// \b: \b é ASCII em JS (audit 28/06) e falharia em terminações acentuadas ("e aí").
const GREETING_RE = /^(oi|ol[áa]|e\s*a[íi]|coe|bom\s*dia|boa\s*tarde|boa\s*noite|fala|opa|salve|eae|eai|tudo\s*bem|tudo\s*certo|de\s*boa)(?=\s|$)/i;
const ACK_RE = /^(valeu|vlw|obrigad[oa]?|show|top|massa|perfeito|isso|entendi|ok|okay|certo|fechou|combinado|beleza|blz|tranquil[oa]|suave|maravilha)(?=\s|$)/i;

// Isola o NÚCLEO da fala: minúsculas, sem vocativo "Tom", sem emoji/pontuação/dígitos.
// Assim "vlw Tom" → "vlw" e "fechou 👍" → "fechou" casam o ACK sem afrouxar as âncoras.
function coreText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\btom\b/g, ' ') // vocativo ao bot (só "tom" isolado; "toma"/"tomás" ficam)
    .replace(/[^\p{L}\s]/gu, ' ') // emoji, pontuação, dígitos
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyIntent(rawText, recentHistory) { // eslint-disable-line no-unused-vars
  const raw = String(rawText || '');
  const { userText } = stripReplyScaffold(raw);
  const text = (userText || '').trim();
  const op = { intent: 'operational', loadout: LOADOUTS.operational };
  if (!text) return op; // mídia/áudio puro (sem texto)
  if (/RESPONDENDO a /i.test(raw)) return op; // reply-quote (mensagem OU mídia): o quote importa
  if (ACTION_RE.test(text) || DATA_Q_RE.test(text)) return op;
  const core = coreText(text);
  if ((GREETING_RE.test(core) || ACK_RE.test(core)) && text.length <= 120) {
    return { intent: 'conversational', loadout: LOADOUTS.conversational };
  }
  return op; // default seguro
}

module.exports = { classifyIntent, LOADOUTS, coreText };

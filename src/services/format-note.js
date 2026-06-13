// src/services/format-note.js — puro: valida a requisição de formatação e monta o
// system prompt por ação. SEM I/O (testável). Usado por internal-api /internal/format-note.
'use strict';

const ACTIONS = ['format', 'summarize', 'fix', 'tone'];
const MAX_HTML = 20000;

const COMMON =
  '\n\nResponda APENAS o HTML do corpo — sem cercas de código, sem texto antes ou depois, ' +
  'sem comentário. NÃO invente informação que não esteja no original.';

const SYSTEM_PROMPTS = {
  format:
    'Você organiza uma anotação bagunçada em HTML limpo. Use títulos <h2>, listas <ul><li> e ' +
    'negrito <strong> onde fizer sentido. Preserve TODOS os dados — não remova nenhuma informação.' + COMMON,
  summarize:
    'Você resume uma anotação. Devolva um parágrafo curto seguido de bullets <ul><li> com os ' +
    'pontos principais, em HTML.' + COMMON,
  fix:
    'Você corrige ortografia e gramática em português, preservando o sentido e a estrutura ' +
    'HTML existente do texto.' + COMMON,
  tone:
    'Você reescreve a anotação num tom mais claro, objetivo e profissional, mantendo todas as ' +
    'informações, em HTML.' + COMMON,
};

function validateFormatRequest(body) {
  const action = body && body.action;
  const html = body && body.html;
  if (!ACTIONS.includes(action)) return { ok: false, error: 'invalid_action' };
  if (typeof html !== 'string' || !html.trim()) return { ok: false, error: 'invalid_html' };
  if (html.length > MAX_HTML) return { ok: false, error: 'too_long' };
  return { ok: true, action, html };
}

function systemPromptFor(action) {
  return SYSTEM_PROMPTS[action] || SYSTEM_PROMPTS.format;
}

module.exports = { ACTIONS, MAX_HTML, validateFormatRequest, systemPromptFor };

// src/services/format-note.js — puro: valida a requisição de formatação e monta o
// system prompt por ação. SEM I/O (testável). Usado por internal-api /internal/format-note.
//
// Fatia D (motor semântico): o núcleo (SEMANTIC_CORE) é herdado por TODAS as ações —
// a formatação semântica (separar cada item, agrupar por categoria, preservar tudo)
// é o PADRÃO, não uma opção. Com few-shot pra ancorar a estrutura e reduzir variação.
// + instrução livre do usuário ("formata desse jeito") + toggle de emojis.
// Modelo/auth não mudam: roda Sonnet via assinatura OAuth (claude.chatRaw).
'use strict';

const ACTIONS = ['format', 'summarize', 'fix', 'tone'];
const MAX_HTML = 20000;
const MAX_INSTRUCTION = 280;

// Núcleo semântico — herdado por TODAS as ações. As regras são imperativas (sem
// "onde fizer sentido") e há um exemplo ENTRADA→SAÍDA pra ancorar a estrutura.
const SEMANTIC_CORE =
`Você é o TOM organizando uma anotação de trabalho que chegou como uma "descarga mental": itens misturados, sem estrutura, tudo embolado. Sua tarefa é DAR ESTRUTURA sem perder nada.

Regras obrigatórias (não são opcionais):
1. IDENTIFIQUE as categorias que aparecem no texto e crie uma seção <h2> para cada uma que EXISTIR. Categorias comuns: Contas a pagar, Contas a receber, Tarefas e pendências, Senhas e acessos, Saldos, Contatos, Prazos e datas, Observações. Só crie a seção se a categoria realmente aparecer — nunca invente seção vazia. O que não se encaixar vai em "Outros".
2. CADA item é um <li> próprio dentro da <ul> da sua seção. NUNCA junte dois itens na mesma linha — cada conta, cada tarefa, cada senha é um <li> separado.
3. DESTAQUE em <strong> o que identifica o item (nome + valor).
4. A sub-informação do item (forma de pagamento, código de barras, contato, vencimento, observação) entra DENTRO do mesmo <li>, como continuação separada por <br>. NUNCA vira item solto e NUNCA some.
5. PRESERVE 100% dos dados: números, valores, códigos de barras, e-mails, telefones e DATAS saem idênticos ao original. NÃO calcule, infira nem expanda datas ou dias da semana — se está escrito "até sexta", mantenha "até sexta" (nunca vire "sexta (20/06)"). Não invente, não remova.

Exemplo de transformação:

ENTRADA:
contas a pagar hoje
pg seguro carro 131,98 boleto 34191.09800 18865
pg internet 82,99 debito automatico
ligar pro contador ate sexta
senha portal nfe gov2024

SAÍDA:
<h2>Contas a pagar</h2>
<ul>
<li><strong>Seguro carro</strong> — <strong>R$ 131,98</strong><br>Boleto: 34191.09800 18865<br>Forma: boleto</li>
<li><strong>Internet</strong> — <strong>R$ 82,99</strong><br>Forma: débito automático</li>
</ul>
<h2>Tarefas e pendências</h2>
<ul>
<li>Ligar pro contador <strong>até sexta</strong></li>
</ul>
<h2>Senhas e acessos</h2>
<ul>
<li><strong>Portal NFe</strong><br>Senha: gov2024</li>
</ul>`;

// Verbo específico de cada ação — prepended depois do núcleo.
const ACTION_VERBS = {
  format:
    'Organize a anotação abaixo aplicando exatamente as regras acima.',
  summarize:
    'Aplique a estrutura das regras acima E condense cada seção: bullets curtos, sem redundância nem enrolação — mas mantenha todos os itens e seus dados essenciais.',
  fix:
    'Sua prioridade é CORRIGIR ortografia e gramática em português. Aplique também a estrutura das regras acima. NÃO altere números, valores, códigos ou e-mails.',
  tone:
    'Reescreva num tom mais claro, objetivo e profissional, aplicando a estrutura das regras acima. Mantenha todas as informações.',
};

const EMOJI_ON =
  '\n\nUse 1 emoji como marcador no início de CADA título de seção (ex.: 💰 Contas a pagar, 📥 Contas a receber, ✅ Tarefas e pendências, 🔑 Senhas e acessos, 💵 Saldos, 📞 Contatos, 🗓️ Prazos e datas). Um por título, nenhum dentro dos itens.';
const EMOJI_OFF =
  '\n\nNÃO use emojis.';
const COMMON =
  '\n\nResponda APENAS o HTML do corpo — sem cercas de código, sem texto antes ou depois, sem comentário. Use só estas tags: <h2>, <p>, <ul>, <li>, <strong>, <em>, <a>, <br>. NÃO invente informação que não esteja no original.';

function validateFormatRequest(body) {
  const action = body && body.action;
  const html = body && body.html;
  if (!ACTIONS.includes(action)) return { ok: false, error: 'invalid_action' };
  if (typeof html !== 'string' || !html.trim()) return { ok: false, error: 'invalid_html' };
  if (html.length > MAX_HTML) return { ok: false, error: 'too_long' };
  let instruction = '';
  if (body.instruction != null) {
    if (typeof body.instruction !== 'string') return { ok: false, error: 'invalid_instruction' };
    instruction = body.instruction.trim().slice(0, MAX_INSTRUCTION);
  }
  const emoji = body.emoji !== false; // default ligado
  return { ok: true, action, html, instruction, emoji };
}

// systemPromptFor(action, { instruction, emoji }) — compõe núcleo + verbo + emoji
// + instrução + COMMON. emoji default ligado; instrução opcional.
function systemPromptFor(action, opts = {}) {
  const verb = ACTION_VERBS[action] || ACTION_VERBS.format;
  const instruction = String(opts.instruction || '').trim();
  const emoji = opts.emoji !== false;
  const instrClause = instruction
    ? `\n\nINSTRUÇÃO DO USUÁRIO (prioridade — siga, mas sem apagar nenhum dado): ${instruction}`
    : '';
  return SEMANTIC_CORE + '\n\n' + verb + (emoji ? EMOJI_ON : EMOJI_OFF) + instrClause + COMMON;
}

module.exports = { ACTIONS, MAX_HTML, MAX_INSTRUCTION, validateFormatRequest, systemPromptFor };

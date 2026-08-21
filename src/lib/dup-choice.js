'use strict';

// AUDIT-OPTIMISTIC-CONFIRM sub-caso 3 (Juliana 10/06) — desambiguação resolvida.
//
// Quando o TOM pergunta a duplicata ("1️⃣ mesma situação / 2️⃣ outro caso / 3️⃣
// cancela") e o user responde em LINGUAGEM NATURAL ("São duas tarefas diferentes"),
// o regex antigo `^[123]` não casava → caía no LLM → o gate de dup disparava de
// novo → menu re-exibido + "✅ criado" falso no mesmo turno.
//
// classifyDupChoice reconhece tanto o dígito quanto a resposta em texto, pra que
// o engine resolva o dup ANTES de chamar o LLM (tryDupBypass) e não re-exiba o menu.
// Só age quando há um dup pendente (gate no caller) → falso-positivo é inócuo.
//
// Retorna '1' (mesma situação) | '2' (outro caso, cria) | '3' (cancela) | null.

const NL_MAXLEN = 50; // respostas de escolha são curtas; descrições longas não casam.

// Dígito puro no início: "2", "2.", "2)", "2 - cria mesmo", "1, é a mesma".
const DIGIT_RE = /^([123])(?:[.)\-\s]|$)/;

// Opção 3 — cancelar/reformular.
const CHOICE3_RE = /\bcancela(r)?\b|vou\s+reformular|\breformular\b|deixa\s+pra\s+l[áa]/i;

// Opção 2 — outro caso / são diferentes / cria mesmo assim.
const CHOICE2_RE =
  /\bdiferentes?\b|\bdistint[oa]s?\b|outr[oa]\s+(caso|coisa|tarefa|assunto|compromisso)\b|s[ãa]o\s+(duas|dois)\b|cria(r)?\s+(separad|a\s+nova|nova|essa|mesmo)|\bsepar(ad[oa]?|o)\b|n[ãa]o\s+[ée]\s+(a\s+)?mesma|pode\s+criar|cria\s+mesmo|mesmo\s+assim/i;

// Opção 1 — mesma situação / já coberta.
const CHOICE1_RE =
  /\bmesm[ao]\b|\bigual\b|j[áa]\s+(t[áa]|est[áa])\s+(cobert|criad|anotad|na\s+agenda|feit)|j[áa]\s+(existe|tem)|deixa\s+(assim|como\s+t[áa])|mant[ée]m|pode\s+(deixar|manter)/i;

function classifyDupChoice(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (!t) return null;

  const digit = t.match(DIGIT_RE);
  if (digit) return digit[1];

  // Linguagem natural só em respostas curtas (evita tratar descrição de tarefa
  // nova como escolha de dup).
  if (t.length > NL_MAXLEN) return null;

  if (CHOICE3_RE.test(t)) return '3';
  if (CHOICE2_RE.test(t)) return '2'; // checa 2 antes de 1: "não é a mesma" = opção 2
  if (CHOICE1_RE.test(t)) return '1';
  return null;
}

// DUP-BYPASS-STALE-BIND (Arthur 23/06): o DB fallback do tryDupBypass (engine) recuperava
// QUALQUER intent _dup_bypass aberta (listOpenIntents filtra só por DEFAULT_EXPIRY_HOURS),
// então uma dup deixada aberta horas antes capturava uma resposta nova ("essas duas são a
// mesma coisa") + classifyDupChoice casava "mesma" → "já anotado como [tarefa stale]. Nada
// mudou". O Map em memória já expira em 10min (EXP_MS); o DB fallback passa a respeitar a
// MESMA janela: recupera só dup RECENTE (propósito = sobreviver restart do pm2, que é rápido).
const DUP_BYPASS_MAX_AGE_MS = 10 * 60 * 1000;

function pickFreshDupBypassIntent(intents, opts = {}) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const maxAgeMs = opts.maxAgeMs != null ? opts.maxAgeMs : DUP_BYPASS_MAX_AGE_MS;
  if (!Array.isArray(intents)) return null;
  for (const i of intents) {
    if (!i || i.kind !== 'task_creation') continue;
    const p = i.payload || {};
    if (p._dup_bypass !== true) continue;
    if (!Array.isArray(p.drafts) || p.drafts.length === 0) continue;
    const ts = i.asked_at ? Date.parse(i.asked_at) : NaN;
    if (Number.isNaN(ts) || nowMs - ts >= maxAgeMs) continue; // stale ou sem timestamp → ignora
    return i; // listOpenIntents já vem ordenado desc por asked_at (mais recente primeiro)
  }
  return null;
}

// DUP-QUOTE-SCAFFOLD (Juliana 23/06): quando a resposta ao menu de dup vem por reply-quote
// do WhatsApp, o quotedText É o próprio menu (cita o título do draft). Isso é binding
// INEQUÍVOCO — o user apontou exatamente qual dup. Recupera por título mesmo que a janela
// de recência já tenha expirado (a resposta legítima pode demorar: um ritual de fechamento
// interrompeu a Juliana por 35min). SEM quote, mantém pickFreshDupBypassIntent (≤10min):
// sem sinal explícito, intent velha NÃO pode capturar resposta nova (Arthur).
const DUP_MENU_RE = /tarefa parecida|mesma situa[cç][aã]o|responde com o/i;

function _isDupIntent(i) {
  if (!i || i.kind !== 'task_creation') return false;
  const p = i.payload || {};
  return p._dup_bypass === true && Array.isArray(p.drafts) && p.drafts.length > 0;
}

function pickDupBypassIntentForReply(intents, opts = {}) {
  if (!Array.isArray(intents)) return null;
  const quotedText = opts.quotedText ? String(opts.quotedText) : '';
  if (quotedText && DUP_MENU_RE.test(quotedText)) {
    for (const i of intents) {
      if (!_isDupIntent(i)) continue;
      const title = i.payload.drafts[0] && i.payload.drafts[0].title;
      if (title && quotedText.includes(title)) return i; // binding por título, ignora idade
    }
  }
  return pickFreshDupBypassIntent(intents, opts);
}

// DUP-BATCH-MENU-MISBIND (Ana 07/07 07:04→07:05 BRT): num lote com 2+ conflitos de dup,
// o menu exibido é o do PRIMEIRO conflito (o engine só acumula `if (!integrityPayload)`,
// Sprint 31/02-06, quando o lote deixou de abortar no 1º), mas o alvo do "1/2/3" era
// regravado a cada conflito e ficava com o ÚLTIMO. A Ana respondeu "2" ao menu de
// "Liberar a folha para conferência da Direção" e o TOM criou "Avisar William sobre
// treinamentos" — as 3 intents do lote abrem no mesmo instante e a resolution=confirmed
// caiu na última. Menu e alvo passam a sair do MESMO conflito: o primeiro.
function registerBatchDupConflict(state, conflict) {
  const st = state || { menu: null, target: null };
  if (st.menu) return st;
  return { menu: conflict.menu, target: conflict.target };
}

module.exports = { classifyDupChoice, pickFreshDupBypassIntent, pickDupBypassIntentForReply, registerBatchDupConflict, DUP_BYPASS_MAX_AGE_MS };

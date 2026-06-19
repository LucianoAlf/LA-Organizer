'use strict';

// FECHAMENTO-ITEM-NO-ANCHOR (caso Yuri 09/06): o ritual de fechamento numera as
// "3 coisas" do dia (tarefas de trabalho), mas NÃO ancorava cada item por id. Quando
// o usuário respondia "1 - em andamento", o "1" ia pro LLM, que casava com a intent
// concorrente mais FRESCA no contexto ("Editar vídeo Copa do Mundo") em vez da tarefa 1
// do fechamento ("Lançamentos BG"). Irmão do ALVO-FUTURO-RESPOSTA-CURTA, no caminho do
// fechamento.
//
// Estas funções são PURAS (o engine decide o que fazer):
//   - buildClosingItems(): a lista ordenada/numerada que o engine injeta no prompt do
//     fechamento e ANCORA (payload.closing.items[{index,type,id,title}]).
//   - parseClosingReply(): mapeia a resposta numérica do usuário de volta aos índices,
//     com status por item — sem o LLM chutar alvo.

const TZ = 'America/Sao_Paulo';

function brtDay(value, tz = TZ) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // date-only já é "dia civil"
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
}

/**
 * Ordena as tarefas de trabalho do dia na ordem do fechamento (atrasadas → com hora →
 * sem hora — espelha a skill rituais-diarios) e devolve no máximo `max` itens
 * ancoráveis. Ordem estável dentro de cada bucket (preserva a ordem do DB, que já vem
 * por due_date/remind_at).
 *
 * @param {Array<{id,title,due_date?,remind_at?}>} workTasks
 * @param {{today?: string, now?: Date, max?: number}} opts
 * @returns {Array<{index:number,type:'task',id:string,title:string}>}
 */
function buildClosingItems(workTasks = [], opts = {}) {
  const today = opts.today || brtDay(opts.now || new Date());
  const max = Number.isInteger(opts.max) ? opts.max : 3;
  const tasks = (Array.isArray(workTasks) ? workTasks : []).filter((t) => t && t.id && t.title);

  const rank = (t) => {
    const due = brtDay(t.due_date);
    if (due && today && due < today) return 0; // atrasada
    if (t.remind_at) return 1;                  // com hora
    return 2;                                    // sem hora
  };

  const ordered = tasks
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i)) // bucket, depois ordem original (estável)
    .map(({ t }) => t)
    .slice(0, Math.max(1, max));

  return ordered.map((t, idx) => ({
    index: idx + 1,
    type: 'task',
    id: t.id,
    title: String(t.title),
  }));
}

// Sinais de "não concluído" num segmento (em andamento / negação / parcial). Se o
// segmento que segue um número tiver QUALQUER um destes, o item NÃO é 'done'.
const PROGRESS_RE = /(em\s+andamento|andament|andando|fazendo|comec(?:ei|ando|ei\s)|metade|parcial|quase|faltou|faltando|pendente|ainda\s+n[ãa]o|n[ãa]o\s+(?:fiz|deu|consegui|terminei|acabei|rolou)|n[ãa]o\b)/;

/**
 * Mapeia a resposta do usuário ao fechamento numerado para um status por item.
 * statuses[i] ∈ 'done' | 'progress' | 'none':
 *   - 'done'     → concluído (engine aplica complete no id ancorado)
 *   - 'progress' → mencionado mas não concluído (em andamento / negado)
 *   - 'none'     → não mencionado / não fez
 * matched=false → não parece resposta de fechamento; segue o fluxo normal (LLM).
 *
 * @param {string} userText
 * @param {number} count  — quantidade de itens ancorados (1..count)
 * @returns {{matched:boolean, statuses:Array<'done'|'progress'|'none'>}}
 */
function parseClosingReply(userText, count) {
  const n = Number.isInteger(count) ? count : 0;
  const statuses = new Array(Math.max(0, n)).fill('none');
  if (!userText || typeof userText !== 'string' || n <= 0) return { matched: false, statuses };

  const t = userText.toLowerCase().trim();
  if (!t || t.length > 200) return { matched: false, statuses };

  // ALIGN (caso Quintela 18/06, irmão de CLOSING-INTERCEPTOR-OVERCAPTURE): "tudo/todas"
  // COM ressalva (exceção/parcial/futuro) é AMBÍGUO p/ o parser → cai no LLM (fail-safe),
  // que entende a nuance. Ex: "fiz tudo, o de amanhã resolvo amanhã", "fiz tudo menos a 2".
  // Cirúrgico: só dispara quando a msg menciona "tudo/todas" E há qualificador — "só a 1"
  // (sem "tudo") e "fiz tudo" puro seguem determinísticos.
  if (/\b(tudo|todas?|td|geral)\b/.test(t)
      && /\b(menos|exceto|fora|tirando|apenas|s[óo]|amanh[ãa]|depois|outro\s+dia|resolv\w+|deix\w+|fica(?:m)?\s+pra|de\s+hoje|de\s+hj|ainda)\b/.test(t)) {
    return { matched: false, statuses };
  }

  // 1) Globais "tudo" → todos done.
  if (
    /\b(fiz|fechei|conclu[ií]\w*|terminei|finalizei|consegui|deu\s+tudo)\s+(tudo|todas?|td|geral)\b/.test(t) ||
    /^(fiz\s+)?tudo(\s+(certo|feito|ok|sim))?$/.test(t) ||
    /^todas?(\s+feitas?)?$/.test(t)
  ) {
    return { matched: true, statuses: new Array(n).fill('done') };
  }

  // 2) Globais "nada" → todos none.
  if (/\b(n[ãa]o\s+fiz\s+nada|nada\s+feito|nenhuma|nem\s+comecei|zerei)\b/.test(t)) {
    return { matched: true, statuses };
  }

  // 3) Numerado: coleta números válidos (1..n) e classifica pelo segmento até o
  //    próximo número. Default 'done'; vira 'progress' se houver sinal de não-conclusão.
  const nums = [];
  const re = /\d+/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const val = parseInt(m[0], 10);
    if (val >= 1 && val <= n) nums.push({ val, idx: m.index });
  }
  if (nums.length) {
    for (let i = 0; i < nums.length; i++) {
      const start = nums[i].idx;
      const end = i + 1 < nums.length ? nums[i + 1].idx : t.length;
      const seg = t.slice(start, end);
      statuses[nums[i].val - 1] = PROGRESS_RE.test(seg) ? 'progress' : 'done';
    }
    return { matched: true, statuses };
  }

  // 4) Bare "não/nada/nenhuma" SOZINHO → não fez nenhuma. ESTREITADO
  //    (CLOSING-INTERCEPTOR-OVERCAPTURE, audit 15/06): só quando a mensagem é
  //    ESSENCIALMENTE só a negação. Antes `^não\b` capturava QUALQUER frase iniciada por
  //    "não" ("não foi a ADM, foi a de hoje" virava "não fiz nenhuma"). Frase longa agora
  //    cai no LLM (fail-safe). "não fiz nada" segue coberto pela regra #2; "1 não fiz" pela #3.
  const bare = t.replace(/[\s.!,]+$/g, '');
  if (/^(n[ãa]o|nao|nada|nenhuma)$/.test(bare)) {
    return { matched: true, statuses };
  }

  return { matched: false, statuses };
}

/**
 * Decide se o atalho determinístico de fechamento pode disparar para ESTA mensagem.
 * Princípio (CLOSING-INTERCEPTOR-OVERCAPTURE, audit 15/06): a mensagem real do usuário
 * vence o ritual. Fail-safe: qualquer dúvida → { fire:false } (cai no fluxo normal/LLM,
 * preservando 100% do comportamento atual fora dos casos de sobre-captura).
 *
 * Bloqueia 3 sobre-capturas confirmadas:
 *   • not_today        — fechamento de ontem ainda "aberto" pega a msg de hoje (Fabi).
 *   • reply_quote_elsewhere — você citou OUTRA mensagem, não o fechamento (Juliana/Yuri).
 *   • fresher_intent   — há uma intent aberta mais recente que o fechamento.
 *
 * @param {{closingIntent:object, openIntents?:object[], replyParsed?:{userText?:string,quotedText?:string}, now?:Date}} args
 * @returns {{fire:boolean, reason:string}}
 */
function shouldClosingInterceptorFire(args = {}) {
  const { closingIntent, openIntents = [], replyParsed = {}, now = new Date() } = args;
  if (!closingIntent || !closingIntent.payload || !closingIntent.payload.closing) return { fire: false, reason: 'no_closing' };
  const items = closingIntent.payload.closing.items;
  if (!Array.isArray(items) || items.length === 0) return { fire: false, reason: 'no_items' };
  // (today) fechamento é de HOJE em BRT — substitui a janela de 16h corridas.
  if (!closingIntent.asked_at || brtDay(closingIntent.asked_at) !== brtDay(now)) return { fire: false, reason: 'not_today' };
  // (reply-quote elsewhere) citou mensagem que NÃO é o fechamento.
  const quoted = replyParsed && replyParsed.quotedText ? String(replyParsed.quotedText).toLowerCase() : '';
  if (quoted.trim()) {
    const matchesClosing = /fechamento/.test(quoted)
      || items.some((it) => it && it.title && quoted.includes(String(it.title).toLowerCase().slice(0, 18)));
    if (!matchesClosing) return { fire: false, reason: 'reply_quote_elsewhere' };
  }
  // (fresher) há intent aberta mais recente que o fechamento → prefere a mais fresca.
  const closingAt = new Date(closingIntent.asked_at).getTime();
  const hasFresher = (openIntents || []).some((i) =>
    i && i.id !== closingIntent.id && i.asked_at && new Date(i.asked_at).getTime() > closingAt);
  if (hasFresher) return { fire: false, reason: 'fresher_intent' };
  return { fire: true, reason: 'ok' };
}

/**
 * A2 (CLOSING-INTERCEPTOR-OVERCAPTURE / caso Leo): complete em LOTE (2+ tarefas) onde o
 * usuário NÃO citou nenhuma das tarefas = sinal de sequestro pelo contexto de briefing
 * (o LLM "fecha" tarefas atrasadas salientes em vez de tratar o pedido real). Retorna true
 * → o engine deve CONFIRMAR antes de fechar (princípio (b): não fechar tarefa no escuro).
 * Lote de 1 nunca confirma; se o usuário citou ao menos uma tarefa, é legítimo.
 * @param {{completedTitles?:string[], inboundText?:string}} args
 * @returns {boolean}
 */
function batchCompleteNeedsConfirm(args = {}) {
  const titles = (args.completedTitles || []).filter(Boolean);
  if (titles.length < 2) return false;
  const txt = String(args.inboundText || '').toLowerCase();
  if (!txt.trim()) return true; // sem inbound → não dá pra confirmar referência → pede confirmação
  const referenced = titles.some((title) =>
    String(title).toLowerCase().split(/\s+/).filter((w) => w.length >= 4).some((w) => txt.includes(w)));
  return !referenced;
}

/**
 * Guarda (b) (caso Quintela, audit 19/06): dos items marcados 'done', devolve os de due
 * FUTURA (due > hoje BRT). O interceptor de fechamento NÃO deve fechar tarefa de amanhã no
 * fechamento de hoje — defense-in-depth do filtro do builder. Pura. Só tarefas (eventos à parte).
 * @param {Array<{type,id,title}>} items
 * @param {Array<'done'|'progress'|'none'>} statuses
 * @param {Object<string,string>} dueById  — id → due_date
 * @param {string} today  — YYYY-MM-DD (BRT)
 * @returns {Array} subconjunto de items que NÃO devem ser fechados hoje
 */
function futureDoneItems(items, statuses, dueById, today) {
  const out = [];
  const list = Array.isArray(items) ? items : [];
  for (let k = 0; k < list.length; k++) {
    const it = list[k];
    if (!it || it.type !== 'task' || (statuses && statuses[k]) !== 'done') continue;
    const due = brtDay(dueById ? dueById[it.id] : null);
    if (due && today && due > today) out.push(it);
  }
  return out;
}

module.exports = { buildClosingItems, parseClosingReply, shouldClosingInterceptorFire, batchCompleteNeedsConfirm, futureDoneItems, _brtDay: brtDay };

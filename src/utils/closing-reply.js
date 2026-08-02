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
// CLOSING-PARTIAL-TOPICS-DONE (Quintela 06/07): "3. Feito alguns topicos da tarefa"
// era lido como done (o "feito" afirmava conclusão e nada sinalizava parcialidade) →
// o TOM fechou o item que estava PELA METADE (confab de conclusão). Sinais de
// PARCIALIDADE ("alguns/algumas/parte/nem tudo") agora contam como progress. Política
// conservadora: na dúvida entre done e parcial, NÃO fecha (o usuário confirma depois;
// fechar errado some do radar — pior).
const PROGRESS_RE = /(em\s+andamento|andament|andando|fazendo|comec(?:ei|ando|ei\s)|metade|parcial|\bparte\b|algun[s]?\b|alguma[s]?\b|nem\s+tudo|quase|faltou|faltando|pendente|ainda\s+n[ãa]o|n[ãa]o\s+(?:fiz|deu|consegui|terminei|acabei|rolou)|n[ãa]o\b)/;

// CLOSING-CANCEL-IGNORED (Yuri 01/07): "3 NÃO pode cancelar" no fechamento era
// classificado como 'progress' (o "não" do PROGRESS_RE) e o pedido de CANCELAR era
// dropado em silêncio — o TOM respondia "⏳ Em andamento" e a tarefa seguia pending.
// Cancel tem PRIORIDADE sobre progress no segmento (quem pede cancelar não quer
// "em andamento"). O engine aplica status='cancelled' no id ancorado.
const CANCEL_RE = /\bcancel\w*/;

// CLOSING-ANNOTATED-DEFAULT-DONE (Quintela 08/07): afirmação EXPLÍCITA de conclusão num
// segmento anotado. Sem \b nas raízes acentuáveis (\b em JS é ASCII — lição audit 28/06)
// e tolerante ao word-joiner U+2060 que o WhatsApp injeta em listas ("2. ⁠feito").
const DONE_EXPLICIT_RE = /(feit\w*|\bfiz\b|fech\w*|conclu\w*|pront\w*|resolvid\w*|finaliz\w*|termin\w*|entreg\w*|consegui|\bfoi\b|\bsim\b|\bok\b|check|done|✅|👍)/i;

// Tokens que NÃO contam como anotação (conectivos/artigos): "1 e a 2" segue menção nua.
const CONNECTOR_TOKENS = new Set(['e', 'a', 'o', 'as', 'os', 'da', 'de', 'do', 'das', 'dos', 'já', 'ja', 'tb', 'tbm', 'também', 'tambem']);

/**
 * Mapeia a resposta do usuário ao fechamento numerado para um status por item.
 * statuses[i] ∈ 'done' | 'progress' | 'cancel' | 'none':
 *   - 'done'     → concluído (engine aplica complete no id ancorado)
 *   - 'progress' → mencionado mas não concluído (em andamento / negado)
 *   - 'cancel'   → pediu cancelamento ("3 pode cancelar") — engine cancela o id ancorado
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
  //    próximo número válido.
  //    CLOSING-ANNOTATED-DEFAULT-DONE (Quintela 08/07): o default era 'done' — segmento
  //    com ANOTAÇÃO não-reconhecida ("1. Remarcar para sábado", "2. processo postergado
  //    até sexta 17/07") FECHAVA o item. 3ª semana da MESMA família (cancel 02/07,
  //    parcial 07/07, reschedule 08/07): cada verbo novo virava done. Política INVERTIDA:
  //    menção NUA ("1 e 2", "só a 1") segue done (é o formato pedido pelo ritual: "me diz
  //    quais fez"); anotação só fecha com afirmação EXPLÍCITA (feito/sim/ok/...); anotação
  //    que não casa NENHUM sinal → matched:false — a mensagem INTEIRA cai no LLM, que vê
  //    o contexto (inclusive lista concorrente, ex. balanço de aderência) e tem as âncoras
  //    no prompt. Mata a classe: qualquer verbo futuro desconhecido NUNCA mais fecha item.
  const nums = [];
  const re = /\d+/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const val = parseInt(m[0], 10);
    if (val >= 1 && val <= n) nums.push({ val, idx: m.index, len: m[0].length });
  }
  if (nums.length) {
    for (let i = 0; i < nums.length; i++) {
      const start = nums[i].idx;
      const end = i + 1 < nums.length ? nums[i + 1].idx : t.length;
      // CLOSING-SEGMENT-ORPHAN-BLEED (Yuri 10/07): o segmento do ÚLTIMO número ia até o fim
      // da string e ENGOLIA uma LINHA ÓRFÃ de outro assunto ("3 - Sim\n\nrec Kaio NÃO foi
      // possivel" → o "não" da órfã fazia o item virar progress em vez de done). Corta na
      // quebra de PARÁGRAFO (\n\n = mudança de assunto); a anotação legítima vem antes do \n\n.
      const _rawSeg = t.slice(start, end);
      const _para = _rawSeg.indexOf('\n\n');
      const seg = _para > 0 ? _rawSeg.slice(0, _para) : _rawSeg;
      // anotação = o que sobra do segmento sem o número, pontuação leve e conectivos
      const ann = seg.slice(nums[i].len)
        .split(/[\s.()\-–—:,;!]+/)
        .filter((w) => w && !CONNECTOR_TOKENS.has(w))
        .join(' ');
      let st;
      if (!ann) st = 'done';                           // menção nua: "1 e 2", "só a 1"
      else if (CANCEL_RE.test(ann)) st = 'cancel';      // prioridade (Yuri 01/07)
      else if (PROGRESS_RE.test(ann)) st = 'progress';  // inclui parcialidade (06/07)
      else if (DONE_EXPLICIT_RE.test(ann)) st = 'done'; // afirmação explícita
      else return { matched: false, statuses: new Array(Math.max(0, n)).fill('none') };
      statuses[nums[i].val - 1] = st;
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
 * @param {{closingIntent:object, openIntents?:object[], replyParsed?:{userText?:string,quotedText?:string}, now?:Date, lastOutboundAt?:string}} args
 * @returns {{fire:boolean, reason:string}}
 */
function shouldClosingInterceptorFire(args = {}) {
  const { closingIntent, openIntents = [], replyParsed = {}, now = new Date(), lastOutboundAt = null } = args;
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
  // (fresher outbound) CLOSING-FRESHER-OUTBOUND-BIND (Quintela 08/07): o TOM mandou OUTRA
  // mensagem DEPOIS da pergunta do fechamento (o balanço de aderência 19:19 entrou entre o
  // fechamento 19:04 e a resposta 19:20 — a resposta numerada era pro BALANÇO de 4 itens,
  // e o interceptor mapeou na lista de 3 do fechamento). Se a última outbound é mais
  // fresca que a pergunta (+90s de tolerância pra própria mensagem/sticker do ritual),
  // a resposta pode ser pra ELA → fail-safe: LLM decide com o contexto completo.
  if (lastOutboundAt) {
    const lastOut = new Date(lastOutboundAt).getTime();
    if (Number.isFinite(lastOut) && Number.isFinite(closingAt) && lastOut > closingAt + 90 * 1000) {
      return { fire: false, reason: 'fresher_outbound' };
    }
  }
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

// BATCH-CONFIRM-DUP-TITLES (02/08, caso Arthur) — instâncias de uma recorrência têm o MESMO
// título (uma por dia), então a pergunta de confirmação saía assim:
//   "Confirma o fechamento destas 6 tarefas: *Mensagem de feliz aniversário*, *Verificar
//    presenças do dia anterior*, *Mensagem de aniversário*, *Verificar presenças do dia
//    anterior*, *Mensagem de feliz aniversário*, *Verificar presenças do dia anterior*?"
// A pessoa não tem como saber o que está confirmando — parece bug, e é o sintoma visível da
// raiz nº1 (identidade de tarefa). Agrupa repetidos com contagem, preservando a ORDEM de
// primeira aparição. Sem query nova: opera só sobre os títulos que o chamador já tem.
function formatBatchTitles(titles) {
  const counts = new Map();
  for (const t of (Array.isArray(titles) ? titles : [])) {
    const k = String(t || '').trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([t, n]) => (n > 1 ? `*${t}* (${n}×)` : `*${t}*`))
    .join(', ');
}

module.exports = { buildClosingItems, parseClosingReply, shouldClosingInterceptorFire, batchCompleteNeedsConfirm, futureDoneItems, formatBatchTitles, _brtDay: brtDay };

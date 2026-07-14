'use strict';
// Camada 2 (financeiro) do CONFAB-NOMARKER-CHOKEPOINT: a MONTAGEM de confirmação do
// lançamento. PURO (sem I/O). O engine resolve a fonte e passa os itens já normalizados;
// aqui só formata o "confirma?". As confirmações de SUCESSO continuam vindo dos handlers
// (voz rica preservada) — este módulo só produz a pergunta de confirmação.

const BRL = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Data legível pra montagem: YYYY-MM-DD → dd/mm; ausente → "hoje" (o engine grava hoje).
// Mostrar a data deixa o usuário CONFERIR antes de confirmar (ex.: "gastei ... de ontem").
function fmtDate(d) {
  if (!d) return 'hoje';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : String(d);
}

function srcLabel(source) {
  if (!source) return '';
  if (source.kind === 'card') return `💳 ${source.name}`;
  if (source.kind === 'cash') return '💵 Dinheiro';
  return `🏦 ${source.name}`;
}

// items: [{ op, source:{kind,id,name}, txn:{type,amount,description,category,installments,date} }]
function buildLaunchPreview(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const lines = items.map((it) => {
    const t = it.txn || {};
    const parc = t.installments && t.installments >= 2 ? ` em ${t.installments}x` : '';
    const sign = t.type === 'income' ? '+' : '';
    const cat = t.category ? ` · ${t.category}` : '';
    return `• ${t.description || '(sem descrição)'} — ${sign}R$ ${BRL(t.amount)}${parc}${cat} · ${fmtDate(t.date)}`;
  });
  const sources = [...new Set(items.map((it) => srcLabel(it.source)).filter(Boolean))];
  const onlyIncome = items.every((it) => (it.txn || {}).type === 'income');
  const head = items.length === 1
    ? (onlyIncome ? 'Vou registrar essa entrada:' : 'Vou lançar:')
    : 'Vou lançar:';
  const srcLine = sources.length === 1 ? `\nFonte: *${sources[0]}*` : '';
  // Em qual FATURA cai (Rose 14/07 perguntou e a montagem não dizia). Só quando os itens de
  // cartão convergem numa competência única — misto fica sem linha (não inventar resumo errado).
  const cardItems = items.filter((it) => it.op === 'card_purchase');
  const cardComps = [...new Set(cardItems.map((it) => (it.txn || {}).competencia).filter(Boolean))];
  const parc = cardItems.some((it) => ((it.txn || {}).installments || 1) >= 2);
  const compLine = cardItems.length && cardComps.length === 1 && cardItems.every((it) => (it.txn || {}).competencia)
    ? `\nFatura: *${fmtComp(cardComps[0])}*${parc ? ' (1ª parcela)' : ''}` : '';
  return `${head}\n${lines.join('\n')}${srcLine}${compLine}\n\nConfirma que mando? (responde *sim* ou me corrige)`;
}

const MESES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function fmtComp(c) {
  const m = String(c || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MESES[Number(m[2])] || m[2]}/${m[1]}` : String(c || '');
}

// Montagem de PAGAMENTO de fatura de cartão (pay_invoice). Inclui a tarefa de lembrete
// que será fechada junto, pra o usuário conferir antes de confirmar. PURO.
function buildPayInvoicePreview({ cardName, amount, competencia, fromName, taskTitles } = {}) {
  if (!cardName || !(Number(amount) > 0)) return null;
  const comp = fmtComp(competencia);
  const from = fromName ? ` — saindo da *${fromName}*` : '';
  const tasks = Array.isArray(taskTitles) && taskTitles.length
    ? `\nE fecho a tarefa *${taskTitles.join('*, *')}*.` : '';
  return `Vou pagar a fatura do *${cardName}* — R$ ${BRL(amount)}${comp ? ` (${comp})` : ''}${from}.${tasks}\n\nConfirma que mando? (responde *sim* ou me corrige)`;
}

// Decide se a resposta do usuário CONFIRMA o lançamento estagiado (intent form:launch_confirm).
// `conf` = veredito genérico do detectUserConfirmation ('yes'|'no'|null). GENEROSA com afirmação
// ("pode lançar", "manda lançar", "confirmado") MAS trava NEGAÇÃO: "Não lança" casava só o verbo
// "lança" e lançava contra o "não" (Rose 11/07 23:40 — 11 itens gravados sem OK). Reintrodução do
// FIN-INVOICE-COMMIT-ON-QUESTION no caminho novo do launch_confirm. Regra de ouro: na dúvida entre
// lançar e não, NÃO lança. Retorna 'yes' (lança) | 'no' (nega/desiste) | null (ambíguo → LLM re-propõe).
const _LAUNCH_NEG = /\bn[ãa]o\b|\bnao\b|\bnem\b|\bnunca\b|\bjamais\b|\bespera\b|\bpera[íi]?\b|\bcancela|\besquec|deixa\s+pra/;
const _LAUNCH_VERB = /\b(lan[çc]a|lan[çc]ar|pode\s+lan[çc]ar|manda\s+lan[çc]ar|confirmad[oa]|confirmo|confirma)\b/;
// Pergunta NUNCA decide (nem lança nem desiste): "Tom, você vai lançar em qual fatura?" tem 37
// chars e o verbo "lançar" → caía no ramo generoso e LANÇAVA sem OK (Rose 14/07 15:59 — caso-irmão
// do FIN-INVOICE-COMMIT-ON-QUESTION). "?" em qualquer lugar OU palavra interrogativa → null (o LLM
// responde a dúvida e a intent continua aberta esperando o "sim"). "como" fica FORA da lista:
// "lança como outros" é consentimento (Rose 11/07 23:33), não pergunta. Lookahead em vez de \b no
// fim porque \b em JS é ASCII e quebra após acento ("cadê" — lição audit 28/06).
const _LAUNCH_QUESTION = /\?|(^|\s)(qual|quais|quando|onde|aonde|quem|cad[êe]|por\s?qu[eê]|pra\s?qu[eê])(?=$|[\s?!.,;])/;
function detectLaunchConfirm(text, conf) {
  const s = String(text || '').toLowerCase().trim();
  if (_LAUNCH_QUESTION.test(s)) return null;                 // pergunta → LLM responde, não decide
  if (conf === 'no' || _LAUNCH_NEG.test(s)) return 'no';    // negação NUNCA lança
  if (conf === 'yes') return 'yes';
  if (s.length <= 40 && _LAUNCH_VERB.test(s)) return 'yes';  // afirmação generosa curta
  return null;                                               // ambíguo → cai no LLM (re-propõe)
}

// DESFAZER o lote recém-lançado ("apaga tudo"/"desfaz"/"cancela o lançamento"). Só dispara com
// uma intent undo_launch ABERTA (o engine gateia + escopa os ids do lote), então pode ser generoso
// com as frases de "desfazer tudo" sem casar apagar item específico ("apaga o uber" → fluxo normal).
// Rose 11/07 23:44: "Apaga tudo" caiu no LLM e morreu sob timeout/fallback. Agora é determinístico.
function detectUndoLaunch(text) {
  const s = String(text || '').toLowerCase().trim();
  if (s.length > 60 || /\bn[ãa]o\b/.test(s)) return false;              // frase longa/negada → não é undo
  if (/\b(desfaz|desfazer|desfa[çc]a)\b/.test(s)) return true;          // "desfaz" já implica o lote todo
  return /\b(apaga|apagar|exclui|excluir|deleta|deletar|cancela|cancelar|tira|tirar|remove|remover)\b/.test(s)
      && /\b(tudo|todas?|todos|isso|esses|essas|geral|lan[çc]amento|lote|o\s+que\s+(voc[êe]\s+)?lan[çc]ou)\b/.test(s);
}

module.exports = { buildLaunchPreview, buildPayInvoicePreview, detectLaunchConfirm, detectUndoLaunch };

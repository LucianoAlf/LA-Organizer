'use strict';

// CTX-WINDOW-SORTPOS-BLIND (Rafinha, 26/08 12:48 BRT) — o bloco de tarefas do system prompt
// corta em 8 itens (slice do renderTaskList), e a ordem chegava do SQL com sort_position (o DnD
// do PWA) na frente do prazo. Seis tarefas de 31/08 com sort_position 0..5 ocupavam a janela e
// as 3 de quinta 27/08 caíam fora — o TOM respondeu "pra quinta 27/08 não vejo nada cadastrado"
// com as três no banco. Mesma raiz do fix de 30/05, que já tinha tirado remind_at da frente do
// due_date: prazo define urgência real; sort_position/remind_at são desempate DENTRO do dia.
//
// A ordenação é estável (V8), então a ordem recebida do SQL sobrevive entre datas iguais — é
// assim que a ordem manual do PWA continua valendo dentro do mesmo dia.
function orderByDueDate(tasks) {
  const key = (t) => (t && t.due_date) || '9999-12-31';
  return [...(tasks || [])].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// CTX-WINDOW-TETO-CEGO (27/08) — o fix acima arrumou a ORDEM, mas o teto FIXO de 8 continuou de
// pé. Medido em produção: 8 dos 23 colaboradores têm mais de 8 tarefas abertas e a maior fila tem
// 132 — o TOM via 8. Quem perguntasse por uma data além das 8 deadlines mais próximas ouvia "não
// vejo nada": falso-negativo que NENHUM guard de honestidade pega, porque o LLM nunca viu o dado.
//
// A janela deixa de ser "as N primeiras" e passa a ser "tudo que a pergunta pode alcançar":
//   1. atrasadas e o que vence dentro do HORIZONTE entram SEMPRE (é sobre isso que se pergunta);
//   2. o resto (prazo longe / sem prazo) entra só como enchimento, até `maxItens`;
//   3. `maxChars` é o freio duro — o custo real medido é ~6k chars no pior bloco de produção,
//      então o orçamento cabe sem inflar o prompt (que já roda em 81k–158k).
// Quem NÃO entrou volta em `ocultas` pra o chamador avisar. Contar errado aqui reintroduz o bug.
const HORIZONTE_DIAS = 14;
const MAX_ITENS = 25;
const MAX_CHARS = 9000;

function _maisDias(ymd, n) {
  const d = new Date(String(ymd) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Espelha o custo de render do renderTaskList (título + descrição capada + enfeites/checklist).
function _custo(t) {
  return 60 + String((t && t.title) || '').length + Math.min(240, String((t && t.description) || '').length);
}

function selecionarJanela(tasks, opts = {}) {
  const {
    hoje,
    horizonteDias = HORIZONTE_DIAS,
    maxItens = MAX_ITENS,
    maxChars = MAX_CHARS,
  } = opts;
  const ordenadas = orderByDueDate(tasks);
  if (!ordenadas.length) return { mostradas: [], ocultas: 0 };
  const limite = hoje ? _maisDias(hoje, horizonteDias) : null;
  const mostradas = [];
  let chars = 0;
  for (const t of ordenadas) {
    // "prioritária" = atrasada OU dentro do horizonte. due_date < hoje já cai aqui de graça.
    const prioritaria = !!(limite && t && t.due_date && t.due_date <= limite);
    const custo = _custo(t);
    if (chars + custo > maxChars && mostradas.length) break;       // freio duro, vale pra todos
    if (!prioritaria && mostradas.length >= maxItens) break;        // enchimento respeita a contagem
    mostradas.push(t);
    chars += custo;
  }
  return { mostradas, ocultas: ordenadas.length - mostradas.length };
}

module.exports = { orderByDueDate, selecionarJanela, HORIZONTE_DIAS, MAX_ITENS, MAX_CHARS };

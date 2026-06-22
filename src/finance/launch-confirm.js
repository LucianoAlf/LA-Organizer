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
  return `${head}\n${lines.join('\n')}${srcLine}\n\nConfirma que mando? (responde *sim* ou me corrige)`;
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

module.exports = { buildLaunchPreview, buildPayInvoicePreview };

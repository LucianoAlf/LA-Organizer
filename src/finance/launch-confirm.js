'use strict';
// Camada 2 (financeiro) do CONFAB-NOMARKER-CHOKEPOINT: a MONTAGEM de confirmação do
// lançamento. PURO (sem I/O). O engine resolve a fonte e passa os itens já normalizados;
// aqui só formata o "confirma?". As confirmações de SUCESSO continuam vindo dos handlers
// (voz rica preservada) — este módulo só produz a pergunta de confirmação.

const BRL = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    return `• ${t.description || '(sem descrição)'} — ${sign}R$ ${BRL(t.amount)}${parc}${cat}`;
  });
  const sources = [...new Set(items.map((it) => srcLabel(it.source)).filter(Boolean))];
  const onlyIncome = items.every((it) => (it.txn || {}).type === 'income');
  const head = items.length === 1
    ? (onlyIncome ? 'Vou registrar essa entrada:' : 'Vou lançar:')
    : 'Vou lançar:';
  const srcLine = sources.length === 1 ? `\nFonte: *${sources[0]}*` : '';
  return `${head}\n${lines.join('\n')}${srcLine}\n\nConfirma que mando? (responde *sim* ou me corrige)`;
}

module.exports = { buildLaunchPreview };

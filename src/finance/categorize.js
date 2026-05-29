// Mapeamento de categoria por palavra-chave + normalizer de aliases (PRD §5.3). Puro, sem I/O.

const CATEGORY_KEYWORDS = [
  ['salario',    ['salario', 'salário', 'pagamento la']],
  ['comissao',   ['comissao', 'comissão', 'venda loja']],
  ['extra',      ['freelance', 'extra', 'bico', 'renda extra']],
  ['moradia',    ['aluguel', 'condominio', 'condomínio', 'luz', 'agua', 'água', 'internet', 'gas', 'gás', 'iptu']],
  ['alimentacao',['ifood', 'mercado', 'almoco', 'almoço', 'lanche', 'restaurante', 'padaria', 'cafe', 'café']],
  ['transporte', ['uber', 'gasolina', 'onibus', 'ônibus', 'estacionamento', 'manutencao carro', 'manutenção carro']],
  ['saude',      ['farmacia', 'farmácia', 'remedio', 'remédio', 'medico', 'médico', 'dentista', 'plano saude', 'plano saúde', 'consulta']],
  ['educacao',   ['curso', 'livro', 'material', 'escola', 'faculdade']],
  ['lazer',      ['cinema', 'bar', 'cerveja', 'streaming', 'netflix', 'jogo', 'viagem']],
];

function mapCategory(text) {
  const t = String(text || '').toLowerCase();
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return cat;
  }
  return 'outros';
}

function normalizeParams(raw = {}) {
  const out = { ...raw };
  const pick = (...keys) => keys.map((k) => raw[k]).find((v) => v !== undefined);

  const amount = pick('amount', 'valor', 'value', 'price');
  if (amount !== undefined) out.amount = Number(amount);

  let type = pick('type', 'tipo', 'kind');
  if (raw.gasto || raw.despesa) type = 'expense';
  if (raw.receita || raw.ganho || raw.renda) type = 'income';
  if (type) out.type = type;

  const category = pick('category', 'categoria', 'cat');
  if (category) out.category = category;

  const description = pick('description', 'desc', 'nota', 'note');
  if (description !== undefined) out.description = description;

  return out;
}

module.exports = { mapCategory, normalizeParams, CATEGORY_KEYWORDS };

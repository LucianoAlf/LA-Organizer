// src/finance/categories.data.js
// FONTE ÚNICA das categorias default do financeiro (engine). A migration
// pf_categories é seedada a partir DESTA lista. Plataforma (iFood/99/Uber) NÃO é
// categoria — o keyword da plataforma aponta pro uso dominante (ifood→alimentacao).

const CATEGORIES = [
  // ---- Despesas (30) ----
  { slug: 'alimentacao', label: 'Alimentação', emoji: '🍔', color: '#F59E0B', type: 'expense', keywords: ['ifood', 'rappi', 'uber eats', 'ubereats', 'comida', 'almoço', 'almoco', 'lanche', 'padaria', 'café', 'cafe'] },
  { slug: 'assinaturas', label: 'Assinaturas', emoji: '🔁', color: '#8B5CF6', type: 'expense', keywords: ['netflix', 'spotify', 'disney', 'hbo', 'prime', 'assinatura', 'mensalidade streaming'] },
  { slug: 'beleza', label: 'Beleza', emoji: '💅', color: '#EC4899', type: 'expense', keywords: ['salão', 'salao', 'cabelo', 'manicure', 'barbeiro', 'estética', 'estetica', 'maquiagem'] },
  { slug: 'combustivel', label: 'Combustível', emoji: '⛽', color: '#F97316', type: 'expense', keywords: ['gasolina', 'etanol', 'álcool', 'alcool', 'diesel', 'posto', 'combustível', 'combustivel'] },
  { slug: 'compras', label: 'Compras', emoji: '🛍️', color: '#FB923C', type: 'expense', keywords: ['loja', 'shopping', 'compra'] },
  { slug: 'contas_consumo', label: 'Contas de Consumo', emoji: '💡', color: '#EAB308', type: 'expense', keywords: ['luz', 'água', 'agua', 'gás', 'gas', 'energia', 'saneamento', 'conta de luz', 'internet', 'telefone'] },
  { slug: 'educacao', label: 'Educação', emoji: '📚', color: '#3B82F6', type: 'expense', keywords: ['curso', 'livro', 'escola', 'faculdade', 'material escolar'] },
  { slug: 'eletrodomesticos', label: 'Eletrodomésticos', emoji: '🔌', color: '#6366F1', type: 'expense', keywords: ['geladeira', 'fogão', 'fogao', 'microondas', 'máquina', 'maquina', 'eletrodoméstico', 'eletrodomestico'] },
  { slug: 'emprestimo', label: 'Empréstimo', emoji: '💸', color: '#EF4444', type: 'expense', keywords: ['empréstimo', 'emprestimo', 'parcela empréstimo'] },
  { slug: 'esportes', label: 'Esportes', emoji: '🏋️', color: '#22C55E', type: 'expense', keywords: ['academia', 'gym', 'esporte', 'personal', 'crossfit', 'futebol', 'natação', 'natacao'] },
  { slug: 'estacionamento', label: 'Estacionamento', emoji: '🅿️', color: '#0EA5E9', type: 'expense', keywords: ['estacionamento', 'zona azul', 'parquímetro', 'parquimetro'] },
  { slug: 'farmacia', label: 'Farmácia', emoji: '💊', color: '#F43F5E', type: 'expense', keywords: ['farmácia', 'farmacia', 'remédio', 'remedio', 'drogaria'] },
  { slug: 'filhos', label: 'Filhos', emoji: '👶', color: '#F472B6', type: 'expense', keywords: ['filho', 'criança', 'crianca', 'fralda', 'brinquedo', 'escola filho'] },
  { slug: 'financiamento', label: 'Financiamento', emoji: '🏦', color: '#7C3AED', type: 'expense', keywords: ['financiamento', 'prestação', 'prestacao', 'parcela financiamento'] },
  { slug: 'impostos', label: 'Impostos', emoji: '🧾', color: '#6B7280', type: 'expense', keywords: ['ipva', 'iptu', 'imposto', 'darf', 'taxa'] },
  { slug: 'lazer', label: 'Lazer', emoji: '🎬', color: '#D946EF', type: 'expense', keywords: ['cinema', 'teatro', 'show', 'bar', 'jogo', 'parque', 'lazer'] },
  { slug: 'mercado', label: 'Mercado', emoji: '🛒', color: '#16A34A', type: 'expense', keywords: ['mercado', 'supermercado', 'hortifruti', 'feira', 'atacadão', 'atacadao'] },
  { slug: 'moradia', label: 'Moradia', emoji: '🏠', color: '#8B5CF6', type: 'expense', keywords: ['aluguel', 'condomínio', 'condominio', 'moradia'] },
  { slug: 'outros', label: 'Outros', emoji: '📦', color: '#9CA3AF', type: 'expense', keywords: [] },
  { slug: 'pets', label: 'Pets', emoji: '🐾', color: '#A16207', type: 'expense', keywords: ['pet', 'ração', 'racao', 'veterinário', 'veterinario', 'petshop', 'cachorro', 'gato'] },
  { slug: 'presentes', label: 'Presentes', emoji: '🎁', color: '#F472B6', type: 'expense', keywords: ['presente', 'gift', 'lembrança', 'lembranca'] },
  { slug: 'reparos_manutencoes', label: 'Reparos e Manutenções', emoji: '🔧', color: '#78716C', type: 'expense', keywords: ['reparo', 'conserto', 'manutenção', 'manutencao', 'encanador', 'eletricista', 'pintura'] },
  { slug: 'restaurante', label: 'Restaurante', emoji: '🍽️', color: '#FBBF24', type: 'expense', keywords: ['restaurante', 'jantar', 'churrascaria', 'pizzaria', 'lanchonete'] },
  { slug: 'saude', label: 'Saúde', emoji: '🏥', color: '#EF4444', type: 'expense', keywords: ['médico', 'medico', 'dentista', 'consulta', 'plano de saúde', 'plano saude', 'exame', 'hospital'] },
  { slug: 'seguros', label: 'Seguros', emoji: '🛡️', color: '#0EA5E9', type: 'expense', keywords: ['seguro', 'apólice', 'apolice', 'seguro auto', 'seguro vida'] },
  { slug: 'tecnologia', label: 'Tecnologia', emoji: '💻', color: '#6366F1', type: 'expense', keywords: ['notebook', 'celular', 'computador', 'software', 'gadget', 'eletrônico', 'eletronico'] },
  { slug: 'transferencia_contas', label: 'Transferência entre Contas', emoji: '🔄', color: '#64748B', type: 'expense', keywords: [] },
  { slug: 'transporte', label: 'Transporte', emoji: '🚗', color: '#3B82F6', type: 'expense', keywords: ['uber', '99', 'ônibus', 'onibus', 'metrô', 'metro', 'táxi', 'taxi', 'passagem'] },
  { slug: 'vestuario', label: 'Vestuário', emoji: '👕', color: '#EC4899', type: 'expense', keywords: ['roupa', 'sapato', 'tênis', 'tenis', 'vestuário', 'vestuario'] },
  { slug: 'viagens', label: 'Viagens', emoji: '✈️', color: '#06B6D4', type: 'expense', keywords: ['viagem', 'hotel', 'passagem aérea', 'passagem aerea', 'airbnb', 'hospedagem'] },
  // ---- Receitas (13) ----
  { slug: 'salario', label: 'Salário', emoji: '💼', color: '#22C55E', type: 'income', keywords: ['salário', 'salario', 'pagamento la', 'holerite'] },
  { slug: 'comissao', label: 'Comissão', emoji: '💰', color: '#16A34A', type: 'income', keywords: ['comissão', 'comissao', 'venda loja', 'venda'] },
  { slug: 'decimo_terceiro', label: '13º Salário', emoji: '🎄', color: '#15803D', type: 'income', keywords: ['13º', 'décimo terceiro', 'decimo terceiro', '13 salário'] },
  { slug: 'aluguel_recebido', label: 'Aluguel', emoji: '🏠', color: '#22C55E', type: 'income', keywords: ['aluguel recebido', 'recebi aluguel', 'renda aluguel'] },
  { slug: 'aposentadoria', label: 'Aposentadoria', emoji: '👴', color: '#16A34A', type: 'income', keywords: ['aposentadoria', 'inss', 'previdência', 'previdencia'] },
  { slug: 'bonus', label: 'Bônus', emoji: '⭐', color: '#22C55E', type: 'income', keywords: ['bônus', 'bonus', 'prêmio', 'premio', 'bonificação'] },
  { slug: 'ferias', label: 'Férias', emoji: '🏖️', color: '#22C55E', type: 'income', keywords: ['férias', 'ferias', 'adicional férias'] },
  { slug: 'freelance', label: 'Freelance', emoji: '🧑‍💻', color: '#16A34A', type: 'income', keywords: ['freelance', 'freela', 'bico', 'projeto extra', 'renda extra', 'extra'] },
  { slug: 'investimentos', label: 'Investimentos', emoji: '📈', color: '#22C55E', type: 'income', keywords: ['investimento', 'dividendo', 'rendimento', 'juros', 'cdb', 'tesouro', 'ações', 'acoes'] },
  { slug: 'outras_receitas', label: 'Outras Receitas', emoji: '💵', color: '#9CA3AF', type: 'income', keywords: [] },
  { slug: 'pensao', label: 'Pensão', emoji: '🤝', color: '#16A34A', type: 'income', keywords: ['pensão', 'pensao', 'pensão alimentícia'] },
  { slug: 'presente_recebido', label: 'Presente', emoji: '🎁', color: '#22C55E', type: 'income', keywords: ['presente recebido', 'ganhei', 'recebi presente'] },
  { slug: 'restituicao_ir', label: 'Restituição IR', emoji: '🧾', color: '#16A34A', type: 'income', keywords: ['restituição', 'restituicao', 'restituição ir'] },
];

const BY_SLUG = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c]));

function validSlugs(type) {
  return new Set(CATEGORIES.filter((c) => !type || c.type === type).map((c) => c.slug));
}
function fallbackSlug(type) {
  return type === 'income' ? 'outras_receitas' : 'outros';
}

module.exports = { CATEGORIES, BY_SLUG, validSlugs, fallbackSlug };

// LA Report types — espelham schema do banco cross-project.
// Schema confirmado em 2026-05-16 via execute_sql.

export interface ReportUnidade {
  id: string;
  nome: string;
}

export interface ReportSala {
  id: number;
  nome: string;
  tipo_sala: string | null;
  capacidade_maxima: number | null;
  recursos: string[] | null;
  codigo: string | null;
  ativo: boolean;
  itens_count?: number;
  unidades?: { nome: string };
}

export type CondicaoItem = 'novo' | 'bom' | 'regular' | 'ruim';
export type StatusItem = 'ativo' | 'manutencao' | 'baixa' | 'inativo';

export interface ReportInventarioItem {
  id: number;
  codigo_patrimonio: string | null;
  sala_id: number | null;
  unidade_id: string | null;
  nome: string;
  categoria: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  valor_compra: number | null;
  data_compra: string | null;
  nota_fiscal: string | null;
  fornecedor: string | null;
  status: StatusItem | null;
  condicao: CondicaoItem | null;
  quantidade: number;
  foto_url: string | null;
  proxima_revisao: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportMovimentacao {
  id: number;
  item_id: number;
  tipo: string;
  sala_origem_id: number | null;
  sala_destino_id: number | null;
  motivo: string | null;
  data_movimentacao: string;
  inventario?: { nome: string; codigo_patrimonio: string | null };
}

export interface ReportManutencao {
  id: number;
  item_id: number;
  tipo: string;
  descricao: string;
  custo: number | null;
  data_manutencao: string;
  data_proxima_revisao: string | null;
  responsavel: string | null;
  fornecedor_servico: string | null;
  observacoes: string | null;
  inventario?: { nome: string; codigo_patrimonio: string | null; sala_id: number };
}

export interface ReportSalaDetalhe {
  sala: ReportSala;
  itens: ReportInventarioItem[];
  movimentacoes: ReportMovimentacao[];
  manutencoes: ReportManutencao[];
}

export interface ReportProduto {
  id: number;
  nome: string;
  sku: string | null;
  preco: number;
  custo: number | null;
  estoque_minimo: number | null;
  foto_url: string | null;
  disponivel_whatsapp: boolean;
  ativo: boolean;
  estoque_atual: number;
  abaixo_minimo: boolean;
  zerado: boolean;
  loja_categorias?: { nome: string; icone: string | null };
}

export interface ReportAlertas {
  estoque_baixo: ReportProduto[];
  manutencoes_pendentes: ReportManutencao[];
  revisoes_proximas: ReportInventarioItem[];
}

export const CATEGORIA_ICONES: Record<string, string> = {
  'Bateria': '🥁',
  'Canto/Vocal': '🎤',
  'Cordas': '🎸',
  'Piano/Teclado': '🎹',
  'Multiuso': '🎵',
  'Bateria/Percussão': '🥁',
  'Sopro': '🎺',
};

export function iconeParaTipoSala(tipoSala: string | null): string {
  if (!tipoSala) return '🎵';
  return CATEGORIA_ICONES[tipoSala] || '🎵';
}

export const CONDICAO_LABELS: Record<CondicaoItem, string> = {
  novo: 'Novo',
  bom: 'Bom',
  regular: 'Regular',
  ruim: 'Ruim',
};

export const STATUS_LABELS: Record<StatusItem, string> = {
  ativo: 'Ativo',
  manutencao: 'Em manutenção',
  baixa: 'Baixa',
  inativo: 'Inativo',
};

// Mapeamento dos slugs de categoria (vindos da tabela inventario) para
// label apresentável + emoji. Espelha o LA Report admin web.
export const CATEGORIA_INVENTARIO_META: Record<string, { label: string; emoji: string }> = {
  climatizacao: { label: 'Climatização', emoji: '❄️' },
  mobiliario: { label: 'Mobiliário', emoji: '🪑' },
  audio: { label: 'Áudio', emoji: '🎤' },
  acessorios: { label: 'Acessórios', emoji: '🎼' },
  teclados: { label: 'Teclados/Piano', emoji: '🎹' },
  'teclados-piano': { label: 'Teclados/Piano', emoji: '🎹' },
  bateria: { label: 'Bateria/Percussão', emoji: '🥁' },
  'bateria-percussao': { label: 'Bateria/Percussão', emoji: '🥁' },
  percussao: { label: 'Percussão', emoji: '🥁' },
  cordas: { label: 'Cordas', emoji: '🎸' },
  sopro: { label: 'Sopro', emoji: '🎺' },
  iluminacao: { label: 'Iluminação', emoji: '💡' },
  informatica: { label: 'Informática', emoji: '💻' },
  'canto-vocal': { label: 'Canto/Vocal', emoji: '🎤' },
  outros: { label: 'Outros', emoji: '📦' },
};

export function categoriaInventarioMeta(slug: string | null | undefined): { label: string; emoji: string } {
  if (!slug) return { label: 'Sem categoria', emoji: '📦' };
  const key = slug.toLowerCase().trim();
  return CATEGORIA_INVENTARIO_META[key] || { label: slug.charAt(0).toUpperCase() + slug.slice(1), emoji: '📦' };
}

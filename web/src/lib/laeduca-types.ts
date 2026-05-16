// web/src/lib/laeduca-types.ts
// Tipos para o módulo LA EDUCA — espelham o schema Supabase já criado.
// Schema confirmado via execute_sql em 2026-05-16.

export type Unidade = 'campo_grande' | 'recreio' | 'barra' | 'all';

export const UNIDADE_LABELS: Record<Unidade, string> = {
  campo_grande: 'Campo Grande',
  recreio: 'Recreio',
  barra: 'Barra da Tijuca',
  all: 'Todas as unidades',
};

// Mantido para compatibilidade com estagiários legados (sem trilha_id)
export type Modalidade = 'musicalizacao' | 'instrumento' | 'ambos';

export const MODALIDADE_LABELS: Record<Modalidade, string> = {
  musicalizacao: 'Musicalização',
  instrumento: 'Instrumento',
  ambos: 'Ambos',
};

export interface Trilha {
  id: string;           // 'bateria', 'guitarra', etc
  nome: string;
  icone: string | null; // emoji
  descricao: string | null;
  is_active: boolean;
  created_at: string;
}

export type PilarId = string; // codigo do pilar, dinâmico

export interface Pilar {
  id: string;
  codigo: string;            // 'p1', 'p2', 'p3', 'p4', e novos como 'p5' etc
  nome: string;
  descricao_breve: string | null;
  foco: string | null;
  icone: string;             // lucide icon name
  sort_order: number;
  editavel: boolean;
  created_at: string;
  updated_at: string;
}

// Status alinhado com check constraint do banco la_educa_estagiarios.status
export type StatusEstagiario = 'em_andamento' | 'concluido' | 'desistente' | 'arquivado';

export const STATUS_LABELS: Record<StatusEstagiario, string> = {
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  desistente: 'Desistente',
  arquivado: 'Arquivado',
};

export interface Estagiario {
  id: string;
  nome: string;
  unidade: Unidade;
  mentor_id: string | null;
  modalidade: Modalidade;     // legado — mantido para fallback na UI
  trilha_id: string | null;   // novo — trilha pedagógica (primário na UI)
  instrumento: string | null;
  data_inicio: string;        // YYYY-MM-DD
  diagnostico_entrada: string | null;
  status: StatusEstagiario;
  certificado_emitido: boolean;
  certificado_emitido_em: string | null;
  certificado_emitido_por: string | null;
  phone: string | null;
  notificacoes_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

export interface Checkpoint {
  id: string;                 // 'p1.1', 'p2m.1', 'p2i.5', 'p4.4'
  pilar: PilarId;             // codigo (legado, ainda em uso)
  pilar_id: string;           // FK uuid pra la_educa_pilares.id
  pilar_nome: string;
  titulo: string;
  descricao: string;
  criterio: string;
  nota_minima: number;        // nota mínima para ancorar sem justificativa (default 7.0)
  modalidade_filtro: 'musicalizacao' | 'instrumento' | null; // legado
  trilha_id: string | null;   // novo — NULL = universal (P1/P3/P4), valor = específico da trilha (P2)
  sort_order: number;
}

export interface Avaliacao {
  id: string;
  estagiario_id: string;
  checkpoint_id: string | null;       // nullable — NULL = avaliação personalizada
  pilar: string;
  ancorado: boolean;
  nota: number;
  observacoes: string | null;
  justificativa_baixa: string | null;
  ancorado_em: string | null;
  avaliado_por: string | null;
  sort_order: number | null;
  // Campos custom (preenchidos quando checkpoint_id IS NULL)
  titulo_custom: string | null;
  descricao_custom: string | null;
  criterio_custom: string | null;
  nota_minima_custom: number | null;
  pilar_codigo_custom: string | null;
  criado_por_collab: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgressoEstagiario {
  id: string;
  nome: string;
  unidade: Unidade;
  modalidade: Modalidade;     // legado — fallback se trilha_id for null
  instrumento: string | null;
  data_inicio: string;
  status: StatusEstagiario;
  mentor_id: string | null;
  mentor_nome: string | null;
  trilha_id: string | null;
  trilha_nome: string | null;
  trilha_icone: string | null;
  checkpoints_ancorados: number;
  checkpoints_total: number;
  percentual: number;
  certificado_emitido: boolean;
  certificado_emitido_em: string | null;
  ultima_atualizacao: string | null;
}

export interface CadastroEstagiarioForm {
  nome: string;
  unidade: Unidade;
  mentor_id: string;
  trilha_id: string;          // substitui modalidade como campo primário
  instrumento?: string;       // opcional — texto livre (ex: "Bateria 5 peças")
  data_inicio: string;
  diagnostico_entrada?: string;
  phone?: string;
  notificacoes_opt_in?: boolean;
}

export interface AvaliacaoComCheckpoint extends Avaliacao {
  checkpoint: Checkpoint | null;      // null para avaliações personalizadas
  criador_nome?: string | null;       // nome de quem criou (JOIN collaborators), só custom
}

/** Resolve campos de exibição independente de ser avaliação template ou custom. */
export function resolveCheckpointDisplay(a: AvaliacaoComCheckpoint): {
  id: string;
  titulo: string;
  descricao: string;
  criterio: string;
  nota_minima: number;
  pilar_codigo: string;
  is_custom: boolean;
} {
  if (a.checkpoint) {
    return {
      id: a.checkpoint.id,
      titulo: a.checkpoint.titulo,
      descricao: a.checkpoint.descricao,
      criterio: a.checkpoint.criterio,
      nota_minima: a.checkpoint.nota_minima ?? 7,
      pilar_codigo: a.checkpoint.pilar,
      is_custom: false,
    };
  }
  return {
    id: a.id,
    titulo: a.titulo_custom ?? '(sem título)',
    descricao: a.descricao_custom ?? '',
    criterio: a.criterio_custom ?? '',
    nota_minima: a.nota_minima_custom ?? 7,
    pilar_codigo: a.pilar_codigo_custom ?? a.pilar,
    is_custom: true,
  };
}

export interface EstagiarioDetalhe {
  estagiario: Estagiario;
  progresso: ProgressoEstagiario;
  avaliacoes_por_pilar: Record<string, AvaliacaoComCheckpoint[]>;  // key = codigo do pilar
}

export interface ResponsavelPilar {
  id: string;
  estagiario_id: string;
  pilar_id: string;        // FK uuid → la_educa_pilares.id
  instrutor_id: string;
  atribuido_por: string;
  atribuido_em: string;
}

// Versão enriquecida (com JOIN) pra UI
export interface ResponsavelPilarComNomes extends ResponsavelPilar {
  instrutor_nome: string;  // full_name do collaborator
  pilar_codigo: string;    // 'p1', 'p2', etc — pra match com `pilar` na tela
}

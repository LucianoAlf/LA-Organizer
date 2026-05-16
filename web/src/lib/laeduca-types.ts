// web/src/lib/laeduca-types.ts
// Tipos para o módulo LA EDUCA — espelham o schema Supabase já criado.
// Schema confirmado via execute_sql em 2026-05-16.

export type Unidade = 'campo_grande' | 'recreio' | 'barra';

export const UNIDADE_LABELS: Record<Unidade, string> = {
  campo_grande: 'Campo Grande',
  recreio: 'Recreio',
  barra: 'Barra da Tijuca',
};
export type Modalidade = 'musicalizacao' | 'instrumento' | 'ambos';
export type PilarId = 'p1' | 'p2' | 'p3' | 'p4';
export type StatusEstagiario = 'ativo' | 'pausado' | 'desligado';

export interface Estagiario {
  id: string;
  nome: string;
  unidade: Unidade;
  mentor_id: string | null;
  modalidade: Modalidade;
  instrumento: string | null;
  data_inicio: string;        // YYYY-MM-DD
  diagnostico_entrada: string | null;
  status: StatusEstagiario;
  certificado_emitido: boolean;
  certificado_emitido_em: string | null;
  certificado_emitido_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface Checkpoint {
  id: string;                 // 'p1.1', 'p2m.1', 'p2i.5', 'p4.4'
  pilar: PilarId;
  pilar_nome: string;
  titulo: string;
  descricao: string;
  criterio: string;
  modalidade_filtro: 'musicalizacao' | 'instrumento' | null;
  sort_order: number;
}

export interface Avaliacao {
  id: string;
  estagiario_id: string;
  checkpoint_id: string;
  pilar: PilarId;
  ancorado: boolean;
  nota: number;
  observacoes: string | null;
  justificativa_baixa: string | null;
  ancorado_em: string | null;
  avaliado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgressoEstagiario {
  id: string;
  nome: string;
  unidade: Unidade;
  modalidade: Modalidade;
  instrumento: string | null;
  data_inicio: string;
  status: StatusEstagiario;
  mentor_id: string | null;
  mentor_nome: string | null;
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
  modalidade: Modalidade;
  instrumento?: string;
  data_inicio: string;
  diagnostico_entrada?: string;
}

export interface AvaliacaoComCheckpoint extends Avaliacao {
  checkpoint: Checkpoint;
}

export interface EstagiarioDetalhe {
  estagiario: Estagiario;
  progresso: ProgressoEstagiario;
  avaliacoes_por_pilar: Record<PilarId, AvaliacaoComCheckpoint[]>;
}

export const PILAR_NOMES: Record<PilarId, string> = {
  p1: 'Teoria Musical',
  p2: 'Prática do Instrumento',
  p3: 'Metodologia Pedagógica',
  p4: 'Vivência de Sala de Aula',
};

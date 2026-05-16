// LA Journey — Tipos alinhados ao schema Supabase
// Schema confirmado em 2026-05-16 via execute_sql.

export type Programa = 'school' | 'kids';

export const PROGRAMA_LABELS: Record<Programa, string> = {
  school: 'LA Music School',
  kids: 'LA Music Kids',
};

export type TipoCheckpoint = 'checkpoint' | 'musicalizacao' | 'iniciacao';
export type TipoMarco = 'aprendizado' | 'consolidacao' | 'ancoragem_radial';
export type StatusConteudo = 'rascunho' | 'em_revisao' | 'publicado';

export const STATUS_LABELS: Record<StatusConteudo, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  publicado: 'Publicado',
};

export interface JourneyCurso {
  id: string;
  nome: string;
  icone: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface JourneyCheckpoint {
  id: string;
  programa_id: Programa;
  codigo: string;
  nome: string;
  equivalencia: string | null;
  foco: string | null;
  tipo: TipoCheckpoint;
  separa_por_curso: boolean;
  marcos_total: number;
  tem_consolidacao: boolean;
  sort_order: number;
}

export interface JourneyMentor {
  collaborator_id: string;
  full_name: string;
  papel: 'mentor_principal' | 'mentor_apoio';
}

export interface JourneyConteudo {
  id: string;
  programa_id: Programa;
  curso_id: string;
  checkpoint_id: string;
  perfil_entrada: string | null;
  transformacao_esperada: string | null;
  status: StatusConteudo;
  publicado_em: string | null;
  publicado_por: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JourneyMarco {
  id: string;
  conteudo_id: string;
  numero: number;
  tipo: TipoMarco;
  titulo: string | null;
  tema_foco: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface JourneyMarcoCampo {
  id: string;
  marco_id: string;
  campo_chave: string;
  campo_valor: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface JourneyMarcoComCampos extends JourneyMarco {
  campos: Record<string, string>;
}

export interface JourneyConteudoCompleto {
  conteudo: JourneyConteudo | null;
  marcos: JourneyMarcoComCampos[];
  progresso: { preenchidos: number; total: number; percentual: number };
}

export interface JourneyCursoProgresso {
  curso_id: string;
  curso_nome: string;
  curso_icone: string | null;
  mentor_principal: string | null;
  mentores_apoio: string[] | null;
  checkpoints: Array<{
    checkpoint_id: string;
    checkpoint_nome: string;
    checkpoint_codigo: string;
    checkpoint_sort: number;
    status: StatusConteudo | 'sem_inicio';
    percentual: number;
    campos_preenchidos: number;
    campos_total: number;
    updated_at: string | null;
    dias_sem_editar: number | null;
  }>;
  total_percentual: number;
  ultima_edicao: string | null;
}

export interface JourneyPendencia {
  conteudo_id: string;
  programa_id: Programa;
  curso_id: string;
  curso_nome: string;
  checkpoint_id: string;
  checkpoint_nome: string;
  mentor_nome: string | null;
  submetido_em: string | null;
}

export interface CanSubmitResult {
  ok: boolean;
  erro?: string;
  campos_faltando?: string[];
  marcos_incompletos?: number[];
}

export function camposDoTipo(tipo: TipoMarco): string[] {
  switch (tipo) {
    case 'aprendizado':
      return ['tema_foco', 'teoria_conceitos', 'tecnica', 'ritmo_percepcao', 'repertorio_aplicacao', 'evidencia_ancoragem', 'musica_desafio'];
    case 'consolidacao':
      return ['ancoragens_reforcadas', 'lapidacao_tecnica', 'repertorio_recital', 'formato_celebracao'];
    case 'ancoragem_radial':
      return ['conquista_musical', 'manifestacao_crianca', 'vivencias_atividades', 'recursos_pedagogicos'];
  }
}

export const CAMPO_LABELS: Record<string, string> = {
  tema_foco: 'Tema / foco do marco',
  teoria_conceitos: 'Teoria e Conceitos',
  tecnica: 'Técnica',
  ritmo_percepcao: 'Ritmo e Percepção',
  repertorio_aplicacao: 'Repertório e Aplicação',
  evidencia_ancoragem: 'Evidência de Ancoragem',
  musica_desafio: 'Música Desafio',
  ancoragens_reforcadas: 'Ancoragens que serão reforçadas',
  lapidacao_tecnica: 'Foco da lapidação técnica',
  repertorio_recital: 'Música / Repertório do Recital',
  formato_celebracao: 'Formato de Celebração',
  conquista_musical: 'Conquista Musical do Marco',
  manifestacao_crianca: 'Como se Manifesta na Criança',
  vivencias_atividades: 'Vivências e Atividades Propostas',
  recursos_pedagogicos: 'Recursos Pedagógicos e Instrumentos',
};

export const CAMPO_PLACEHOLDERS: Record<string, string> = {
  tema_foco: 'Descreva o tema central e o foco pedagógico deste período de aulas...',
  teoria_conceitos: 'O que o aluno precisa compreender? (notas, leitura, anatomia do instrumento)',
  tecnica: 'O que o aluno precisa executar? (postura, digitação, coordenação motora)',
  ritmo_percepcao: 'O que o aluno precisa sentir e reconhecer? (pulso, andamento, padrões)',
  repertorio_aplicacao: 'Onde o conteúdo vira música? (prática de conjunto, música desafio)',
  evidencia_ancoragem: 'Como o professor percebe que o conteúdo foi realmente absorvido?',
  musica_desafio: 'Nome da música ou tipo de repertório trabalhado neste marco...',
  ancoragens_reforcadas: 'Quais fundamentos dos marcos anteriores precisam de mais atenção?',
  lapidacao_tecnica: 'O que precisa estar polido? Postura, expressividade, segurança no repertório...',
  repertorio_recital: 'Repertório esperado para este Checkpoint...',
  formato_celebracao: 'Como o avanço será celebrado? Gravação, recital, feedback formal...',
  conquista_musical: 'Qual é a conquista musical específica que se ancora neste marco?',
  manifestacao_crianca: 'Como esta conquista aparece no comportamento da criança?',
  vivencias_atividades: 'Que tipos de atividades, jogos musicais e propostas pedagógicas exploram esta ancoragem?',
  recursos_pedagogicos: 'Quais instrumentos, objetos sonoros, canções ou recursos são usados nesta fase?',
};

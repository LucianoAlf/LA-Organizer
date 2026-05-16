// web/src/lib/laeduca.ts
// Fetchers do módulo LA EDUCA. RLS no banco filtra visibilidade — não precisa
// repetir filtros de role/unidade aqui (mentor vê só seus, coord+director vê todos).
import { supabase } from './supabase';
import type {
  Estagiario,
  Checkpoint,
  Avaliacao,
  ProgressoEstagiario,
  CadastroEstagiarioForm,
  AvaliacaoComCheckpoint,
  EstagiarioDetalhe,
  Pilar,
  Trilha,
} from './laeduca-types';

/** Lista todos os estagiários visíveis (RLS filtra). */
export async function fetchProgressoEstagiarios(unidade?: string): Promise<ProgressoEstagiario[]> {
  let q = supabase.from('la_educa_progresso').select('*').order('nome');
  if (unidade) q = q.eq('unidade', unidade);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ProgressoEstagiario[];
}

/** Detalhe completo de um estagiário (linha + view + avaliações agrupadas por pilar). */
export async function fetchEstagiarioDetalhe(estagiarioId: string): Promise<EstagiarioDetalhe> {
  const [estRes, progRes, avalRes] = await Promise.all([
    supabase.from('la_educa_estagiarios').select('*').eq('id', estagiarioId).single(),
    supabase.from('la_educa_progresso').select('*').eq('id', estagiarioId).single(),
    supabase
      .from('la_educa_avaliacoes')
      .select('*, checkpoint:la_educa_checkpoints(*)')
      .eq('estagiario_id', estagiarioId),
  ]);
  if (estRes.error) throw estRes.error;
  if (progRes.error) throw progRes.error;
  if (avalRes.error) throw avalRes.error;

  const avaliacoes = (avalRes.data ?? []) as unknown as AvaliacaoComCheckpoint[];
  const agrupado: Record<string, AvaliacaoComCheckpoint[]> = {};
  for (const a of avaliacoes) {
    if (!agrupado[a.pilar]) agrupado[a.pilar] = [];
    agrupado[a.pilar].push(a);
  }
  for (const k of Object.keys(agrupado)) {
    agrupado[k].sort((a, b) => a.checkpoint.sort_order - b.checkpoint.sort_order);
  }

  return {
    estagiario: estRes.data as Estagiario,
    progresso: progRes.data as ProgressoEstagiario,
    avaliacoes_por_pilar: agrupado,
  };
}

/** Lista mentores possíveis.
 *  Critério: ativos + (role IN director/coordinator OU pedagogical_role preenchido).
 *  Filtro de unidade mantido para exibir somente mentores da unidade do estagiário;
 *  se no futuro quiser cross-unit, basta remover o .eq('unit', unidade).
 */
export async function fetchMentoresDisponiveis(_unidade?: string): Promise<Array<{ id: string; full_name: string }>> {
  // Mentor pedagógico pode mentorar estagiário de qualquer unidade — não filtra por unit.
  // Critério: director/coordinator OU tem pedagogical_role (mentor/lead/assistant).
  // Exclui managers (Jereh, Clayton, Krissya, Yuri) que não fazem mentoria pedagógica.
  void _unidade;
  const { data, error } = await supabase
    .from('collaborators')
    .select('id, full_name, role, pedagogical_role')
    .eq('is_active', true)
    .or('role.in.(director,coordinator),pedagogical_role.not.is.null')
    .order('full_name');
  if (error) throw error;
  return (data ?? []).map(c => ({ id: c.id, full_name: c.full_name }));
}

/**
 * Cadastra estagiário E gera todas as avaliações aplicáveis.
 * Checkpoints aplicáveis = universais (trilha_id IS NULL) + específicos da trilha escolhida.
 * 16 universais + até 35 específicos → número varia por trilha.
 */
export async function cadastrarEstagiario(form: CadastroEstagiarioForm): Promise<string> {
  const { data: est, error: e1 } = await supabase
    .from('la_educa_estagiarios')
    .insert({
      nome: form.nome,
      unidade: form.unidade,
      mentor_id: form.mentor_id,
      trilha_id: form.trilha_id,
      // modalidade como default para não quebrar coluna NOT NULL (se existir)
      modalidade: 'instrumento',
      instrumento: form.instrumento || null,
      data_inicio: form.data_inicio,
      diagnostico_entrada: form.diagnostico_entrada || null,
    })
    .select('id')
    .single();
  if (e1) throw e1;
  if (!est) throw new Error('Insert do estagiário não retornou id');

  // Busca checkpoints: universais (trilha_id IS NULL) + específicos da trilha
  const { data: cps, error: e2 } = await supabase
    .from('la_educa_checkpoints')
    .select('id, pilar')
    .or(`trilha_id.is.null,trilha_id.eq.${form.trilha_id}`);
  if (e2) throw e2;
  if (!cps || cps.length === 0) throw new Error('Nenhum checkpoint aplicável encontrado');

  const { error: e3 } = await supabase.from('la_educa_avaliacoes').insert(
    cps.map(c => ({
      estagiario_id: est.id,
      checkpoint_id: c.id,
      pilar: c.pilar,
    })),
  );
  if (e3) throw e3;

  return est.id;
}

/** Ancora (ou atualiza) uma avaliação. Trigger Supabase grava histórico automático. */
export async function ancorarAvaliacao(params: {
  avaliacaoId: string;
  nota: number;
  observacoes: string | null;
  justificativaBaixa: string | null;
  avaliadorId: string;
}): Promise<Avaliacao> {
  const { avaliacaoId, nota, observacoes, justificativaBaixa, avaliadorId } = params;
  const { data, error } = await supabase
    .from('la_educa_avaliacoes')
    .update({
      ancorado: true,
      nota,
      observacoes,
      justificativa_baixa: justificativaBaixa,
      ancorado_em: new Date().toISOString(),
      avaliado_por: avaliadorId,
    })
    .eq('id', avaliacaoId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Avaliacao;
}

/** Emite o Certificado Alfa. Permitido só pra coord/director (RLS valida). */
export async function emitirCertificado(params: {
  estagiarioId: string;
  emissorId: string;
}): Promise<void> {
  const { error } = await supabase
    .from('la_educa_estagiarios')
    .update({
      certificado_emitido: true,
      certificado_emitido_em: new Date().toISOString(),
      certificado_emitido_por: params.emissorId,
    })
    .eq('id', params.estagiarioId);
  if (error) throw error;
}

// ─── Trilhas pedagógicas ───────────────────────────────────────────────────

export async function fetchTrilhas(): Promise<Trilha[]> {
  const { data, error } = await supabase
    .from('la_educa_trilhas')
    .select('*')
    .eq('is_active', true)
    .order('nome');
  if (error) throw error;
  return (data ?? []) as Trilha[];
}

export async function criarTrilha(form: {
  id: string;
  nome: string;
  icone?: string;
  descricao?: string;
}): Promise<Trilha> {
  const { data, error } = await supabase
    .from('la_educa_trilhas')
    .insert({ ...form, is_active: true })
    .select('*')
    .single();
  if (error) throw error;
  return data as Trilha;
}

export async function atualizarTrilha(id: string, patch: Partial<Trilha>): Promise<Trilha> {
  const { data, error } = await supabase
    .from('la_educa_trilhas')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Trilha;
}

/** Soft delete — não apaga pois pode ter estagiários linkados. */
export async function deletarTrilha(id: string): Promise<void> {
  const { error } = await supabase
    .from('la_educa_trilhas')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;
}

// ─── Checkpoints ──────────────────────────────────────────────────────────

/** Lista checkpoints. */
export async function fetchCheckpoints(): Promise<Checkpoint[]> {
  const { data, error } = await supabase
    .from('la_educa_checkpoints')
    .select('*')
    .order('pilar')
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as Checkpoint[];
}

/** Lista todos os pilares ordenados por sort_order. */
export async function fetchPilares(): Promise<Pilar[]> {
  const { data, error } = await supabase
    .from('la_educa_pilares')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as Pilar[];
}

/** Cria pilar novo. */
export async function criarPilar(form: {
  codigo: string;
  nome: string;
  descricao_breve?: string;
  foco?: string;
  icone?: string;
  sort_order?: number;
}): Promise<Pilar> {
  const { data, error } = await supabase
    .from('la_educa_pilares')
    .insert({ ...form, editavel: true })
    .select('*')
    .single();
  if (error) throw error;
  return data as Pilar;
}

/** Atualiza pilar. */
export async function atualizarPilar(id: string, patch: Partial<Pilar>): Promise<Pilar> {
  const { data, error } = await supabase
    .from('la_educa_pilares')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Pilar;
}

/** Deleta pilar (RLS valida coord/director + editavel=true). */
export async function deletarPilar(id: string): Promise<void> {
  const { error } = await supabase.from('la_educa_pilares').delete().eq('id', id);
  if (error) throw error;
}

/** Cria checkpoint novo. */
export async function criarCheckpoint(form: {
  id: string;
  pilar: string;
  pilar_id: string;
  pilar_nome: string;
  titulo: string;
  descricao: string;
  criterio: string;
  modalidade_filtro?: 'musicalizacao' | 'instrumento' | null;
  trilha_id?: string | null;
  sort_order: number;
}): Promise<Checkpoint> {
  const { data, error } = await supabase
    .from('la_educa_checkpoints')
    .insert(form)
    .select('*')
    .single();
  if (error) throw error;
  return data as Checkpoint;
}

/** Atualiza checkpoint. */
export async function atualizarCheckpoint(id: string, patch: Partial<Checkpoint>): Promise<Checkpoint> {
  const { data, error } = await supabase
    .from('la_educa_checkpoints')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Checkpoint;
}

/** Deleta checkpoint. */
export async function deletarCheckpoint(id: string): Promise<void> {
  const { error } = await supabase.from('la_educa_checkpoints').delete().eq('id', id);
  if (error) throw error;
}

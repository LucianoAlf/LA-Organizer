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
  PilarId,
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
  const agrupado: Record<PilarId, AvaliacaoComCheckpoint[]> = { p1: [], p2: [], p3: [], p4: [] };
  for (const a of avaliacoes) {
    agrupado[a.pilar].push(a);
  }
  for (const k of Object.keys(agrupado) as PilarId[]) {
    agrupado[k].sort((a, b) => a.checkpoint.sort_order - b.checkpoint.sort_order);
  }

  return {
    estagiario: estRes.data as Estagiario,
    progresso: progRes.data as ProgressoEstagiario,
    avaliacoes_por_pilar: agrupado,
  };
}

/** Lista mentores possíveis (collaborators ativos da unidade). */
export async function fetchMentoresDisponiveis(unidade: string): Promise<Array<{ id: string; full_name: string }>> {
  const { data, error } = await supabase
    .from('collaborators')
    .select('id, full_name')
    .eq('is_active', true)
    .eq('unit', unidade)
    .order('full_name');
  if (error) throw error;
  return data ?? [];
}

/**
 * Cadastra estagiário E gera todas as avaliações aplicáveis. Filtro de modalidade:
 * - musicalizacao → 16 nulls + 5 musicalizacao = 21 checkpoints
 * - instrumento   → 16 nulls + 5 instrumento  = 21 checkpoints
 * - ambos         → todos os 26
 */
export async function cadastrarEstagiario(form: CadastroEstagiarioForm): Promise<string> {
  const { data: est, error: e1 } = await supabase
    .from('la_educa_estagiarios')
    .insert({
      nome: form.nome,
      unidade: form.unidade,
      mentor_id: form.mentor_id,
      modalidade: form.modalidade,
      instrumento: form.instrumento || null,
      data_inicio: form.data_inicio,
      diagnostico_entrada: form.diagnostico_entrada || null,
    })
    .select('id')
    .single();
  if (e1) throw e1;
  if (!est) throw new Error('Insert do estagiário não retornou id');

  const filter =
    form.modalidade === 'ambos'
      ? 'modalidade_filtro.is.null,modalidade_filtro.eq.musicalizacao,modalidade_filtro.eq.instrumento'
      : `modalidade_filtro.is.null,modalidade_filtro.eq.${form.modalidade}`;

  const { data: cps, error: e2 } = await supabase
    .from('la_educa_checkpoints')
    .select('id, pilar')
    .or(filter);
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

// LA Journey — Data layer
import { supabase } from './supabase';
import type {
  Programa, JourneyCheckpoint, JourneyCurso, JourneyMentor,
  JourneyConteudo, JourneyMarco, JourneyMarcoCampo, JourneyMarcoComCampos,
  JourneyConteudoCompleto, JourneyCursoProgresso, JourneyPendencia,
  CanSubmitResult, TipoMarco
} from './lajourney-types';
import { camposDoTipo } from './lajourney-types';

// ─── LEITURA ───────────────────────────────────────────────────────────

export async function fetchJourneyCheckpoints(programaId: Programa): Promise<JourneyCheckpoint[]> {
  const { data, error } = await supabase
    .from('la_journey_checkpoints')
    .select('*')
    .eq('programa_id', programaId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as JourneyCheckpoint[];
}

export async function fetchJourneyCursos(programaId: Programa): Promise<JourneyCurso[]> {
  const { data, error } = await supabase
    .from('la_journey_curso_mentores')
    .select('curso_id, la_journey_cursos!inner(id, nome, icone, sort_order, is_active)')
    .eq('programa_id', programaId)
    .eq('ativo', true);
  if (error) throw error;
  const seen = new Set<string>();
  const out: JourneyCurso[] = [];
  for (const row of (data ?? []) as unknown as Array<{ curso_id: string; la_journey_cursos: JourneyCurso }>) {
    if (seen.has(row.curso_id)) continue;
    seen.add(row.curso_id);
    out.push(row.la_journey_cursos);
  }
  out.sort((a, b) => a.sort_order - b.sort_order);
  return out;
}

export async function fetchJourneyMentoresPorCurso(programaId: Programa, cursoId: string): Promise<JourneyMentor[]> {
  const { data, error } = await supabase
    .from('la_journey_curso_mentores')
    .select('collaborator_id, papel, collaborators!inner(id, full_name)')
    .eq('programa_id', programaId)
    .eq('curso_id', cursoId)
    .eq('ativo', true);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    collaborator_id: string; papel: 'mentor_principal' | 'mentor_apoio';
    collaborators: { full_name: string };
  }>).map(r => ({
    collaborator_id: r.collaborator_id,
    papel: r.papel,
    full_name: r.collaborators.full_name,
  }));
}

export async function fetchJourneyConteudoCompleto(
  programaId: Programa, cursoId: string, checkpointId: string
): Promise<JourneyConteudoCompleto> {
  const { data: conteudo, error: e1 } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select('*')
    .eq('programa_id', programaId)
    .eq('curso_id', cursoId)
    .eq('checkpoint_id', checkpointId)
    .maybeSingle();
  if (e1) throw e1;

  if (!conteudo) {
    return { conteudo: null, marcos: [], progresso: { preenchidos: 0, total: 0, percentual: 0 } };
  }

  const { data: marcosRaw, error: e2 } = await supabase
    .from('la_journey_marcos')
    .select('*, la_journey_marco_campos(*)')
    .eq('conteudo_id', conteudo.id)
    .order('sort_order')
    .order('numero');
  if (e2) throw e2;

  const marcos: JourneyMarcoComCampos[] = ((marcosRaw ?? []) as Array<
    JourneyMarco & { la_journey_marco_campos: JourneyMarcoCampo[] }
  >).map(m => {
    const campos: Record<string, string> = {};
    for (const c of m.la_journey_marco_campos ?? []) {
      campos[c.campo_chave] = c.campo_valor ?? '';
    }
    return {
      id: m.id, conteudo_id: m.conteudo_id, numero: m.numero, tipo: m.tipo,
      titulo: m.titulo, tema_foco: m.tema_foco, sort_order: m.sort_order,
      created_at: m.created_at, updated_at: m.updated_at, updated_by: m.updated_by,
      campos,
    };
  });

  let preenchidos = 0;
  let total = 2;
  if ((conteudo.perfil_entrada ?? '').trim()) preenchidos++;
  if ((conteudo.transformacao_esperada ?? '').trim()) preenchidos++;
  for (const m of marcos) {
    const chaves = camposDoTipo(m.tipo);
    total += chaves.length;
    for (const k of chaves) {
      if ((m.campos[k] ?? '').trim()) preenchidos++;
    }
  }
  const percentual = total === 0 ? 0 : Math.round((preenchidos / total) * 100);
  return { conteudo: conteudo as JourneyConteudo, marcos, progresso: { preenchidos, total, percentual } };
}

export async function fetchJourneyListaProgresso(programaId: Programa): Promise<JourneyCursoProgresso[]> {
  const { data, error } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: programaId });
  if (error) throw error;
  type Row = {
    curso_id: string; curso_nome: string; curso_icone: string | null;
    mentor_principal: string | null; mentores_apoio: string[] | null;
    checkpoint_id: string; checkpoint_nome: string; checkpoint_codigo: string; checkpoint_sort: number;
    status: string; percentual: number; campos_preenchidos: number; campos_total: number;
    updated_at: string | null; dias_sem_editar: number | null;
  };
  const grouped = new Map<string, JourneyCursoProgresso>();
  for (const r of (data ?? []) as Row[]) {
    if (!grouped.has(r.curso_id)) {
      grouped.set(r.curso_id, {
        curso_id: r.curso_id, curso_nome: r.curso_nome, curso_icone: r.curso_icone,
        mentor_principal: r.mentor_principal, mentores_apoio: r.mentores_apoio,
        checkpoints: [], total_percentual: 0, ultima_edicao: null,
      });
    }
    const g = grouped.get(r.curso_id)!;
    g.checkpoints.push({
      checkpoint_id: r.checkpoint_id, checkpoint_nome: r.checkpoint_nome,
      checkpoint_codigo: r.checkpoint_codigo, checkpoint_sort: r.checkpoint_sort,
      status: r.status as JourneyCursoProgresso['checkpoints'][number]['status'],
      percentual: r.percentual, campos_preenchidos: r.campos_preenchidos,
      campos_total: r.campos_total, updated_at: r.updated_at, dias_sem_editar: r.dias_sem_editar,
    });
    if (r.updated_at && (!g.ultima_edicao || r.updated_at > g.ultima_edicao)) {
      g.ultima_edicao = r.updated_at;
    }
  }
  for (const g of grouped.values()) {
    g.checkpoints.sort((a, b) => a.checkpoint_sort - b.checkpoint_sort);
    g.total_percentual = Math.round(
      g.checkpoints.reduce((s, c) => s + c.percentual, 0) / Math.max(1, g.checkpoints.length)
    );
  }
  return Array.from(grouped.values());
}

export async function fetchJourneyPendencias(): Promise<JourneyPendencia[]> {
  const { data, error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select(`
      id, programa_id, curso_id, checkpoint_id, updated_at,
      la_journey_cursos!inner(nome),
      la_journey_checkpoints!inner(nome)
    `)
    .eq('status', 'em_revisao')
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string; programa_id: Programa; curso_id: string; checkpoint_id: string; updated_at: string;
    la_journey_cursos: { nome: string };
    la_journey_checkpoints: { nome: string };
  }>).map(r => ({
    conteudo_id: r.id,
    programa_id: r.programa_id,
    curso_id: r.curso_id,
    curso_nome: r.la_journey_cursos.nome,
    checkpoint_id: r.checkpoint_id,
    checkpoint_nome: r.la_journey_checkpoints.nome,
    mentor_nome: null,
    submetido_em: r.updated_at,
  }));
}

// ─── ESCRITA ───────────────────────────────────────────────────────────

async function getCurrentCollaboratorId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) throw new Error('Não autenticado');
  // A tabela collaborators não tem auth_user_id — o link com auth.users é via email
  // (mesmo padrão usado em DashboardTime.tsx e na RPC current_collab_id).
  const { data, error } = await supabase
    .from('collaborators').select('id').eq('email', user.email).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Colaborador não encontrado');
  return data.id;
}

export async function upsertJourneyConteudoHeader(input: {
  programaId: Programa; cursoId: string; checkpointId: string;
  perfilEntrada?: string; transformacaoEsperada?: string;
}): Promise<string> {
  const userId = await getCurrentCollaboratorId();
  const { data: existing } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select('id, status')
    .eq('programa_id', input.programaId)
    .eq('curso_id', input.cursoId)
    .eq('checkpoint_id', input.checkpointId)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'publicado') {
      throw new Error('Conteúdo publicado — edição bloqueada.');
    }
    const patch: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() };
    if (input.perfilEntrada !== undefined) patch.perfil_entrada = input.perfilEntrada;
    if (input.transformacaoEsperada !== undefined) patch.transformacao_esperada = input.transformacaoEsperada;
    const { error } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .update(patch)
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  } else {
    const { data, error } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .insert({
        programa_id: input.programaId,
        curso_id: input.cursoId,
        checkpoint_id: input.checkpointId,
        perfil_entrada: input.perfilEntrada ?? null,
        transformacao_esperada: input.transformacaoEsperada ?? null,
        status: 'rascunho',
        updated_by: userId,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }
}

export async function adicionarJourneyMarco(input: {
  conteudoId: string; numero: number; tipo: TipoMarco; titulo?: string;
}): Promise<string> {
  const userId = await getCurrentCollaboratorId();
  const { data, error } = await supabase
    .from('la_journey_marcos')
    .insert({
      conteudo_id: input.conteudoId,
      numero: input.numero,
      tipo: input.tipo,
      titulo: input.titulo ?? null,
      sort_order: input.numero,
      updated_by: userId,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function removerJourneyMarco(marcoId: string): Promise<void> {
  const { data: m } = await supabase
    .from('la_journey_marcos').select('tipo').eq('id', marcoId).single();
  if (m?.tipo === 'consolidacao') {
    throw new Error('Marco de consolidação não pode ser removido.');
  }
  const { error } = await supabase.from('la_journey_marcos').delete().eq('id', marcoId);
  if (error) throw error;
}

export async function upsertJourneyMarcoCampo(input: {
  marcoId: string; campoChave: string; campoValor: string;
}): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_marco_campos')
    .upsert({
      marco_id: input.marcoId,
      campo_chave: input.campoChave,
      campo_valor: input.campoValor,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'marco_id,campo_chave' });
  if (error) throw error;
}

export async function upsertJourneyMarcoHeader(input: {
  marcoId: string; titulo?: string; temaFoco?: string;
}): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const patch: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() };
  if (input.titulo !== undefined) patch.titulo = input.titulo;
  if (input.temaFoco !== undefined) patch.tema_foco = input.temaFoco;
  const { error } = await supabase
    .from('la_journey_marcos').update(patch).eq('id', input.marcoId);
  if (error) throw error;
}

export async function canSubmitJourney(conteudoId: string): Promise<CanSubmitResult> {
  const { data, error } = await supabase.rpc('la_journey_can_submit', { p_conteudo_id: conteudoId });
  if (error) throw error;
  return data as CanSubmitResult;
}

export async function submeterJourneyParaRevisao(conteudoId: string): Promise<void> {
  const check = await canSubmitJourney(conteudoId);
  if (!check.ok) {
    throw new Error('Faltam campos: ' + JSON.stringify(check));
  }
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({ status: 'em_revisao', updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', conteudoId);
  if (error) throw error;
}

export async function publicarJourneyConteudo(conteudoId: string): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
      publicado_por: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conteudoId);
  if (error) throw error;
}

export async function reverterJourneyParaRascunho(conteudoId: string): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({ status: 'rascunho', updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', conteudoId);
  if (error) throw error;
}

export async function devolverJourneyParaRevisao(conteudoId: string): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({
      status: 'em_revisao',
      publicado_em: null,
      publicado_por: null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conteudoId);
  if (error) throw error;
}

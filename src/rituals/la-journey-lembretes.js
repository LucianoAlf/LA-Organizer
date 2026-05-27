// src/rituals/la-journey-lembretes.js
// Cron semanal + alerta de atraso + processamento de fila la_journey_lembretes_log

const supabase = require('../supabase/client');
const whatsapp = require('../services/whatsapp');

async function runLaJourneyLembreteSemanal() {
  const { data: programas } = await supabase.from('la_journey_programas').select('id');
  for (const prog of programas || []) {
    const { data: rows } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: prog.id });
    const porMentor = {};
    for (const r of rows || []) {
      if (r.status === 'publicado' || r.status === 'sem_inicio') continue;
      const { data: ment } = await supabase
        .from('la_journey_curso_mentores')
        .select('collaborator_id, collaborators(full_name, phone, notification_opt_in)')
        .eq('curso_id', r.curso_id).eq('programa_id', prog.id)
        .eq('papel', 'mentor_principal').eq('ativo', true).maybeSingle();
      if (!ment?.collaborators?.phone) continue;
      const key = ment.collaborator_id;
      if (!porMentor[key]) porMentor[key] = { ment, items: [] };
      porMentor[key].items.push(r);
    }
    for (const { ment, items } of Object.values(porMentor)) {
      const primeiroNome = ment.collaborators.full_name.split(' ')[0];
      let msg = `Oi ${primeiroNome}, bom dia 👋\n\n`;
      msg += `Passei pra avisar sobre o LA Journey:\n\n`;
      for (const it of items) {
        msg += `*${it.checkpoint_nome} · ${it.curso_nome}* — ${it.percentual}% (${it.campos_preenchidos}/${it.campos_total} campos)\n`;
      }
      msg += `\nQuer abrir? https://la-organizer.com/la-journey`;
      await supabase.from('la_journey_lembretes_log').insert({
        tipo: 'lembrete_semanal',
        destinatario_id: ment.collaborator_id,
        mensagem: msg,
      });
    }
  }
}

async function runLaJourneyAlertaAtraso() {
  const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: conteudos } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select(`
      id, programa_id, curso_id, checkpoint_id, status, updated_at,
      la_journey_cursos(nome), la_journey_checkpoints(nome)
    `)
    .neq('status', 'publicado')
    .lt('updated_at', cutoffIso);

  for (const c of conteudos || []) {
    const { data: ment } = await supabase
      .from('la_journey_curso_mentores')
      .select('collaborator_id')
      .eq('curso_id', c.curso_id).eq('programa_id', c.programa_id)
      .eq('papel', 'mentor_principal').eq('ativo', true).maybeSingle();
    const { data: coords } = await supabase
      .from('collaborators').select('id').eq('role', 'coordinator').eq('active', true);

    const dias = Math.floor((Date.now() - new Date(c.updated_at).getTime()) / (1000 * 60 * 60 * 24));
    const msg = `🚨 *Alerta de atraso* — ${c.la_journey_checkpoints.nome} · ${c.la_journey_cursos.nome} está sem alterações há ${dias} dias.`;

    if (ment) {
      await supabase.from('la_journey_lembretes_log').insert({
        tipo: 'alerta_atraso', destinatario_id: ment.collaborator_id, conteudo_id: c.id, mensagem: msg,
      });
    }
    for (const co of coords || []) {
      await supabase.from('la_journey_lembretes_log').insert({
        tipo: 'alerta_atraso', destinatario_id: co.id, conteudo_id: c.id, mensagem: msg,
      });
    }
  }
}

function montarMsgPadrao(tipo) {
  if (tipo === 'enviado_revisao') return `Um mentor submeteu um checkpoint do LA Journey pra revisão. Veja em la-organizer.com/la-journey/admin`;
  if (tipo === 'publicado') return `Um checkpoint do LA Journey foi publicado.`;
  if (tipo === 'devolvido') return `A coordenação devolveu seu checkpoint do LA Journey para revisão. Veja o feedback.`;
  if (tipo === 'kickoff') {
    return [
      `🎵 *Bem-vindo ao LA Journey!*`,
      ``,
      `Você foi atribuído como mentor pedagógico. O LA Journey é a estrutura institucional onde você descreve, marco a marco, o que cada aluno deve aprender no seu curso.`,
      ``,
      `*Comece assim:*`,
      `1. Abra https://la-organizer.com/la-journey`,
      `2. Selecione seu curso (vai aparecer só o seu)`,
      `3. Comece pelo *Foundation* — preencha "Perfil de entrada" + "Transformação esperada"`,
      `4. Adicione marcos com os 4 eixos: Teoria, Técnica, Ritmo, Repertório`,
      ``,
      `Vou te lembrar toda segunda 09h se tiver campo pendente. Boas-vindas! 👋`,
    ].join('\n');
  }
  return `Notificação LA Journey.`;
}

async function processarFilaLaJourney() {
  const { data: pendentes } = await supabase
    .from('la_journey_lembretes_log')
    .select('id, tipo, destinatario_id, conteudo_id, mensagem, collaborators(phone, notification_opt_in, full_name)')
    .is('enviado_em', null)
    .limit(50);

  for (const item of pendentes || []) {
    try {
      const phone = item.collaborators?.phone;
      const optIn = item.collaborators?.notification_opt_in;
      if (!phone || !optIn) {
        await supabase.from('la_journey_lembretes_log').update({
          enviado_em: new Date().toISOString(),
          mensagem: (item.mensagem || '[sem msg]') + ' [SKIP: sem phone ou opt-out]',
        }).eq('id', item.id);
        continue;
      }
      const msg = item.mensagem || montarMsgPadrao(item.tipo);
      await whatsapp.sendMessage(phone, msg);
      await supabase.from('la_journey_lembretes_log').update({
        enviado_em: new Date().toISOString(),
      }).eq('id', item.id);
    } catch (e) {
      console.error('[la-journey-lembretes] falha', item.id, e.message);
    }
  }
}

async function runLaJourneyBriefingSexta() {
  // Sexta 14h: pra cada coord/director ativo, monta resumo da semana
  const { data: coords } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, notification_opt_in')
    .in('role', ['coordinator', 'director'])
    .eq('active', true);
  if (!coords || coords.length === 0) return;

  // snapshot por programa
  const { data: school } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'school' });
  const { data: kids } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'kids' });
  const all = [...(school || []), ...(kids || [])];

  const emRevisao = all.filter(r => r.status === 'em_revisao');
  const publicadosUltima7d = all.filter(r => {
    if (r.status !== 'publicado' || !r.updated_at) return false;
    const dias = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000);
    return dias <= 7;
  });
  const parados = all.filter(r => (r.dias_sem_editar ?? 0) > 7 && r.status !== 'publicado' && r.status !== 'sem_inicio');

  // pct global por programa
  const pctSchool = school?.length ? Math.round(school.reduce((s, r) => s + r.percentual, 0) / school.length) : 0;
  const pctKids = kids?.length ? Math.round(kids.reduce((s, r) => s + r.percentual, 0) / kids.length) : 0;

  const linhas = [
    `📊 *Briefing semanal — LA Journey*`,
    ``,
    `*Progresso geral:* School ${pctSchool}% · Kids ${pctKids}%`,
    ``,
  ];
  if (emRevisao.length) {
    linhas.push(`🟡 *${emRevisao.length} checkpoint(s) em revisão:*`);
    for (const r of emRevisao.slice(0, 8)) {
      linhas.push(`  • ${r.curso_nome} · ${r.checkpoint_nome}`);
    }
    linhas.push('');
  }
  if (publicadosUltima7d.length) {
    linhas.push(`✅ *${publicadosUltima7d.length} publicado(s) esta semana:*`);
    for (const r of publicadosUltima7d.slice(0, 6)) {
      linhas.push(`  • ${r.curso_nome} · ${r.checkpoint_nome}`);
    }
    linhas.push('');
  }
  if (parados.length) {
    linhas.push(`⏸ *${parados.length} parado(s) +7d:*`);
    for (const r of parados.slice(0, 6)) {
      linhas.push(`  • ${r.curso_nome} · ${r.checkpoint_nome} (${r.dias_sem_editar}d)`);
    }
    linhas.push('');
  }
  if (emRevisao.length === 0 && publicadosUltima7d.length === 0 && parados.length === 0) {
    linhas.push(`Nada precisando da sua atenção essa semana. 👌`);
  } else {
    linhas.push(`Ver tudo: https://la-organizer.com/la-journey/admin`);
  }

  const msg = linhas.join('\n');
  for (const c of coords) {
    await supabase.from('la_journey_lembretes_log').insert({
      tipo: 'briefing_sexta',
      destinatario_id: c.id,
      mensagem: msg,
    });
  }
}

async function runLaJourneyEscalation() {
  // >21d sem editar (não publicado) → escala pra director
  const cutoffIso = new Date(Date.now() - 21 * 86400000).toISOString();
  const { data: conteudos } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select(`
      id, programa_id, curso_id, checkpoint_id, status, updated_at,
      la_journey_cursos(nome), la_journey_checkpoints(nome)
    `)
    .neq('status', 'publicado')
    .lt('updated_at', cutoffIso);

  if (!conteudos || conteudos.length === 0) return;

  // Sprint 30 — Escalation LA Journey vai só pro CEO. Bug colateral: coluna é
  // `is_active` (não `active`); corrigido junto.
  const { data: directors } = await supabase
    .from('collaborators').select('id, full_name, phone')
    .eq('is_ceo', true).eq('is_active', true);
  if (!directors || directors.length === 0) return;

  // Agrupa por director — uma msg consolidada
  const linhas = [`🚨 *Escalation — LA Journey*`, ``, `Checkpoints parados há +21 dias (sem publicar):`, ``];
  for (const c of conteudos) {
    const dias = Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000);
    // descobre mentor responsável
    const { data: ment } = await supabase
      .from('la_journey_curso_mentores')
      .select('collaborators(full_name)')
      .eq('curso_id', c.curso_id).eq('programa_id', c.programa_id)
      .eq('papel', 'mentor_principal').eq('ativo', true).maybeSingle();
    const mentorNome = ment?.collaborators?.full_name ?? '?';
    linhas.push(`• ${c.la_journey_cursos?.nome} · ${c.la_journey_checkpoints?.nome} — ${dias}d (mentor: ${mentorNome})`);
  }
  linhas.push('');
  linhas.push(`Quintela já foi alertada no fluxo semanal. Vale puxar você direto?`);
  linhas.push(`Admin: https://la-organizer.com/la-journey/admin`);

  const msg = linhas.join('\n');
  for (const d of directors) {
    await supabase.from('la_journey_lembretes_log').insert({
      tipo: 'escalation', destinatario_id: d.id, mensagem: msg,
    });
  }
}

async function runLaJourneyPrimeiraAcao() {
  // Mentor atribuído há +3d que NÃO tem nenhum conteudo criado pros cursos dele → ping gentil
  const cutoffIso = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data: atribuicoes } = await supabase
    .from('la_journey_curso_mentores')
    .select('collaborator_id, curso_id, programa_id, atribuido_em, collaborators(full_name, phone, notification_opt_in)')
    .eq('ativo', true)
    .lt('atribuido_em', cutoffIso);

  if (!atribuicoes || atribuicoes.length === 0) return;

  // Pra cada mentor, checa se já criou pelo menos 1 conteudo em qualquer curso dele
  const porMentor = new Map();
  for (const a of atribuicoes) {
    if (!porMentor.has(a.collaborator_id)) porMentor.set(a.collaborator_id, { mentor: a.collaborators, cursos: [] });
    porMentor.get(a.collaborator_id).cursos.push({ curso_id: a.curso_id, programa_id: a.programa_id });
  }

  for (const [mentorId, { mentor, cursos }] of porMentor.entries()) {
    if (!mentor?.phone || !mentor?.notification_opt_in) continue;
    // Checa se já criou algum conteudo
    const cursoIds = cursos.map(c => c.curso_id);
    const programaIds = [...new Set(cursos.map(c => c.programa_id))];
    const { count } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .select('id', { count: 'exact', head: true })
      .in('curso_id', cursoIds)
      .in('programa_id', programaIds);
    if ((count ?? 0) > 0) continue;

    // Checa se já mandamos esse ping antes (evita spam)
    const { count: jaPingado } = await supabase
      .from('la_journey_lembretes_log')
      .select('id', { count: 'exact', head: true })
      .eq('tipo', 'primeira_acao')
      .eq('destinatario_id', mentorId);
    if ((jaPingado ?? 0) > 0) continue;

    const primeiroNome = mentor.full_name.split(' ')[0];
    const msg = [
      `Oi ${primeiroNome}! 👋`,
      ``,
      `Você foi atribuído como mentor no LA Journey faz alguns dias mas ainda não abriu. Tudo bem?`,
      ``,
      `Sem pressa, mas se quiser dar uma olhada, é em https://la-organizer.com/la-journey`,
      `Começa pelo *Foundation* do seu curso — só dois textareas pra preencher e tu já vê como funciona.`,
      ``,
      `Se tiver dúvida, é só me chamar.`,
    ].join('\n');
    await supabase.from('la_journey_lembretes_log').insert({
      tipo: 'primeira_acao', destinatario_id: mentorId, mensagem: msg,
    });
  }
}

module.exports = {
  runLaJourneyLembreteSemanal,
  runLaJourneyAlertaAtraso,
  runLaJourneyBriefingSexta,
  runLaJourneyEscalation,
  runLaJourneyPrimeiraAcao,
  processarFilaLaJourney,
};

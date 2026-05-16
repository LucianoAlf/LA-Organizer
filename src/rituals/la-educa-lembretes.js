// src/rituals/la-educa-lembretes.js
// Lembretes semanais do LA EDUCA — disparado pelo dispatcher toda segunda 09:00.
// Três tipos:
//   1. avaliacao_pendente  → mentor OU instrutor delegado por pilar (estagiário >7d sem update)
//   2. avaliacao_atrasada  → coord/director da unidade (>14d sem update)
//   3. certificado_pronto  → coord/director da unidade (100% e sem cert)
// Idempotência: la_educa_lembretes_log — não reenvia mesmo tipo+estagiário+destinatário em <6 dias.
// Delegação: la_educa_responsaveis_pilar define instrutores responsáveis por pilar específico.
const supabase = require('../supabase/client');
const whatsapp = require('../services/whatsapp');

const SEMI_WEEK_MS = 6 * 86400 * 1000;

async function jaEnviouRecente(tipo, estagiarioId, destinatarioId) {
  const since = new Date(Date.now() - SEMI_WEEK_MS).toISOString();
  const { data, error } = await supabase
    .from('la_educa_lembretes_log')
    .select('id')
    .eq('tipo', tipo)
    .eq('estagiario_id', estagiarioId)
    .eq('destinatario_id', destinatarioId)
    .gte('enviado_em', since)
    .limit(1);
  if (error) {
    console.error('[la-educa] jaEnviouRecente erro:', error.message);
    return false;
  }
  return (data?.length || 0) > 0;
}

async function logEnvio(tipo, estagiarioId, destinatarioId, mensagem) {
  await supabase.from('la_educa_lembretes_log').insert({
    tipo,
    estagiario_id: estagiarioId,
    destinatario_id: destinatarioId,
    mensagem,
  });
}

async function buscarCollab(id) {
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, unit, is_active')
    .eq('id', id)
    .single();
  return data;
}

async function buscarCoordsDaUnidade(unidade) {
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, unit')
    .in('role', ['coordinator', 'director'])
    .eq('unit', unidade)
    .eq('is_active', true);
  return data || [];
}

async function buscarPendenciasPorPilar(estagiarioId) {
  const { data } = await supabase
    .from('la_educa_avaliacoes')
    .select(`
      pilar, ancorado,
      checkpoint:la_educa_checkpoints(pilar_id, pilar_nome)
    `)
    .eq('estagiario_id', estagiarioId);
  if (!data) return [];

  const grouped = {};
  for (const a of data) {
    const cod = a.pilar;
    const pilar_id = a.checkpoint?.pilar_id;
    const pilar_nome = a.checkpoint?.pilar_nome || cod;
    if (!grouped[cod]) grouped[cod] = { pilar_codigo: cod, pilar_nome, pilar_id, total: 0, ancorados: 0 };
    grouped[cod].total += 1;
    if (a.ancorado) grouped[cod].ancorados += 1;
  }
  return Object.values(grouped).filter(p => p.ancorados < p.total);
}

async function buscarResponsavel(estagiarioId, pilarId, fallbackMentorId) {
  const { data } = await supabase
    .from('la_educa_responsaveis_pilar')
    .select('instrutor_id')
    .eq('estagiario_id', estagiarioId)
    .eq('pilar_id', pilarId)
    .limit(1);
  return (data?.[0]?.instrutor_id) || fallbackMentorId;
}

async function enviarPendente(estagiario) {
  const pendencias = await buscarPendenciasPorPilar(estagiario.id);
  if (pendencias.length === 0) return;

  // Agrupar por responsável: { collab_id: [pilar1, pilar2, ...] }
  const porResponsavel = {};
  for (const p of pendencias) {
    const responsavelId = await buscarResponsavel(estagiario.id, p.pilar_id, estagiario.mentor_id);
    if (!responsavelId) continue;
    if (!porResponsavel[responsavelId]) porResponsavel[responsavelId] = [];
    porResponsavel[responsavelId].push(p);
  }

  // Buscar nome do mentor (pra incluir nas mensagens enviadas a instrutores)
  const mentor = estagiario.mentor_id ? await buscarCollab(estagiario.mentor_id) : null;
  const mentorNome = mentor?.full_name || '—';

  const dias = Math.floor((Date.now() - new Date(estagiario.ultima_atualizacao).getTime()) / 86400000);

  for (const [respId, pilares] of Object.entries(porResponsavel)) {
    const responsavel = await buscarCollab(respId);
    if (!responsavel || !responsavel.phone || !responsavel.is_active) continue;
    if (await jaEnviouRecente('avaliacao_pendente', estagiario.id, responsavel.id)) continue;

    const ehMentor = respId === estagiario.mentor_id;
    const primeiroNome = responsavel.full_name.split(' ')[0];
    const linhasPilares = pilares.map(p => `• ${p.pilar_nome}: ${p.ancorados}/${p.total} ancorados`).join('\n');

    let msg;
    if (ehMentor) {
      msg =
`Olá ${primeiroNome}! 👋

Lembrete LA EDUCA: ${estagiario.nome} está com avaliações pendentes há ${dias} dias.

Pilares sob sua responsabilidade direta:
${linhasPilares}

Acesse o LA Organizer pra registrar as avaliações. 🎵`;
    } else {
      msg =
`Olá ${primeiroNome}! 👋

Lembrete LA EDUCA: você é instrutor delegado nos seguintes pilares do estagiário ${estagiario.nome} (mentor: ${mentorNome}):

${linhasPilares}

Última atualização há ${dias} dias. Acesse o LA Organizer pra registrar as avaliações. 🎵`;
    }

    try {
      await whatsapp.sendMessage(responsavel.phone, msg);
      await logEnvio('avaliacao_pendente', estagiario.id, responsavel.id, msg);
      console.log(`[la-educa] pendente enviado pra ${responsavel.full_name} (${ehMentor ? 'mentor' : 'instrutor'}) sobre ${estagiario.nome}`);
    } catch (err) {
      console.error(`[la-educa] falha pendente ${estagiario.nome} → ${responsavel.full_name}: ${err.message}`);
    }
  }
}

async function enviarAtrasado(estagiario) {
  const coords = await buscarCoordsDaUnidade(estagiario.unidade);
  if (coords.length === 0) return;
  const dias = Math.floor((Date.now() - new Date(estagiario.ultima_atualizacao).getTime()) / 86400000);
  for (const coord of coords) {
    if (!coord.phone) continue;
    if (await jaEnviouRecente('avaliacao_atrasada', estagiario.id, coord.id)) continue;
    const msg =
`⚠️ LA EDUCA — Atenção, ${coord.full_name.split(' ')[0]}

O estagiário ${estagiario.nome} (Mentor: ${estagiario.mentor_nome || '—'}) não recebe avaliações há ${dias} dias.

Unidade: ${estagiario.unidade}
Progresso: ${Math.round(estagiario.percentual)}% (${estagiario.checkpoints_ancorados}/${estagiario.checkpoints_total})

Verifique no LA Organizer.`;
    try {
      await whatsapp.sendMessage(coord.phone, msg);
      await logEnvio('avaliacao_atrasada', estagiario.id, coord.id, msg);
    } catch (err) {
      console.error(`[la-educa] falha atrasado: ${err.message}`);
    }
  }
}

async function enviarProntoCert(estagiario) {
  const coords = await buscarCoordsDaUnidade(estagiario.unidade);
  for (const coord of coords) {
    if (!coord.phone) continue;
    if (await jaEnviouRecente('certificado_pronto', estagiario.id, coord.id)) continue;
    const msg =
`🏆 LA EDUCA — Estagiário pronto pra certificar!

${estagiario.nome} concluiu todos os fundamentos da Trilha de Ancoragem.

Unidade: ${estagiario.unidade}
Mentor: ${estagiario.mentor_nome || '—'}

Emita o Certificado Alfa no LA Organizer ✅`;
    try {
      await whatsapp.sendMessage(coord.phone, msg);
      await logEnvio('certificado_pronto', estagiario.id, coord.id, msg);
    } catch (err) {
      console.error(`[la-educa] falha cert: ${err.message}`);
    }
  }
}

async function runLaEducaLembretes() {
  const inicio = Date.now();
  console.log('[la-educa] iniciando rotina de lembretes');

  const { data: lista, error } = await supabase
    .from('la_educa_progresso')
    .select('id, nome, unidade, modalidade, mentor_id, mentor_nome, checkpoints_ancorados, checkpoints_total, percentual, certificado_emitido, ultima_atualizacao');
  if (error) {
    console.error('[la-educa] erro ao buscar progresso:', error.message);
    return;
  }

  const stats = { pendente: 0, atrasado: 0, pronto: 0 };
  for (const e of lista || []) {
    const dias = e.ultima_atualizacao
      ? Math.floor((Date.now() - new Date(e.ultima_atualizacao).getTime()) / 86400000)
      : Infinity;

    if (Number(e.percentual) === 100 && !e.certificado_emitido) {
      await enviarProntoCert(e);
      stats.pronto++;
      continue;
    }

    if (Number(e.percentual) >= 100) continue;

    if (dias > 14) {
      await enviarAtrasado(e);
      stats.atrasado++;
    } else if (dias > 7 && e.mentor_id) {
      await enviarPendente(e);
      stats.pendente++;
    }
  }

  console.log(`[la-educa] fim em ${Date.now() - inicio}ms — pendente:${stats.pendente} atrasado:${stats.atrasado} pronto:${stats.pronto}`);

  await enviarResumoSemanalMentores();
}

// ── Feature 1: Resumo semanal pro mentor ─────────────────────────────────────

async function buscarBreakdownPorPilar(estagiarioId, mentorId) {
  const { data: avals } = await supabase
    .from('la_educa_avaliacoes')
    .select('pilar, ancorado, checkpoint:la_educa_checkpoints(pilar_id, pilar_nome)')
    .eq('estagiario_id', estagiarioId);
  if (!avals) return [];

  const grouped = {};
  for (const a of avals) {
    const cod = a.pilar;
    const pid = a.checkpoint?.pilar_id;
    const pnome = a.checkpoint?.pilar_nome || cod;
    if (!grouped[cod]) grouped[cod] = { pilar_codigo: cod, pilar_nome: pnome, pilar_id: pid, total: 0, ancorados: 0 };
    grouped[cod].total += 1;
    if (a.ancorado) grouped[cod].ancorados += 1;
  }

  const arr = Object.values(grouped);
  for (const p of arr) {
    const respId = await buscarResponsavel(estagiarioId, p.pilar_id, mentorId);
    if (respId === mentorId) {
      p.responsavel_nome = 'você';
    } else {
      const r = await buscarCollab(respId);
      p.responsavel_nome = r?.full_name?.split(' ')[0] || '—';
    }
  }
  arr.sort((a, b) => a.pilar_codigo.localeCompare(b.pilar_codigo));
  return arr;
}

async function enviarResumoSemanalMentores() {
  const inicio = Date.now();
  console.log('[la-educa] iniciando resumo semanal mentores');

  const { data: mentores } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active')
    .eq('is_active', true)
    .not('phone', 'is', null);

  if (!mentores) return;

  let enviados = 0;
  for (const mentor of mentores) {
    const { data: estags } = await supabase
      .from('la_educa_progresso')
      .select('id, nome, trilha_nome, trilha_icone, checkpoints_ancorados, checkpoints_total, percentual')
      .eq('mentor_id', mentor.id);
    if (!estags || estags.length === 0) continue;

    const today = new Date().toISOString().slice(0, 10);
    const { data: jaEnviou } = await supabase
      .from('ritual_logs')
      .select('id')
      .eq('ritual_type', 'la_educa_resumo_mentor')
      .eq('collaborator_id', mentor.id)
      .eq('reference_date', today)
      .limit(1);
    if (jaEnviou && jaEnviou.length > 0) continue;

    const linhasEstagiarios = [];
    for (const e of estags) {
      const breakdown = await buscarBreakdownPorPilar(e.id, mentor.id);
      const linhasPilares = breakdown.map(b => `• ${b.pilar_nome}: ${b.ancorados}/${b.total} (${b.responsavel_nome})`).join('\n');
      linhasEstagiarios.push(
        `${e.trilha_icone || '📘'} ${e.nome} (${e.trilha_nome || '—'}, ${e.checkpoints_ancorados}/${e.checkpoints_total} = ${Math.round(e.percentual || 0)}%)\n${linhasPilares}`
      );
    }

    const primeiroNome = mentor.full_name.split(' ')[0];
    const msg = `📊 LA EDUCA — Resumo semanal\n\nOlá ${primeiroNome}! Aqui está o resumo dos estagiários sob sua coordenação:\n\n${linhasEstagiarios.join('\n\n')}\n\nAcesse o LA Organizer pra acompanhar 🎵`;
    try {
      await whatsapp.sendMessage(mentor.phone, msg);
      await supabase.from('ritual_logs').insert({
        collaborator_id: mentor.id,
        ritual_type: 'la_educa_resumo_mentor',
        reference_date: today,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
      enviados++;
    } catch (err) {
      console.error(`[la-educa resumo] falha pra ${mentor.full_name}: ${err.message}`);
    }
  }

  console.log(`[la-educa] resumo semanal: ${enviados} mentores em ${Date.now() - inicio}ms`);
}

// ── Feature 2: Processador de notificações de atribuição (roda a cada tick) ──

async function processarNotificacoesAtribuicao() {
  const { data: pendentes } = await supabase
    .from('la_educa_lembretes_log')
    .select('id, destinatario_id, estagiario_id, enviado_em')
    .eq('tipo', 'atribuicao_pendente_envio')
    .is('mensagem', null)
    .limit(50);
  if (!pendentes || pendentes.length === 0) return;

  console.log(`[la-educa atrib] ${pendentes.length} pendente(s)`);

  for (const p of pendentes) {
    try {
      const instrutor = await buscarCollab(p.destinatario_id);
      if (!instrutor?.phone || !instrutor.is_active) {
        await supabase.from('la_educa_lembretes_log')
          .update({ mensagem: 'SKIP: sem phone ou inativo' })
          .eq('id', p.id);
        continue;
      }

      const { data: atrib } = await supabase
        .from('la_educa_responsaveis_pilar')
        .select('pilar_id, instrutor_id, atribuido_por, estagiario_id, atribuido_em, pilar:la_educa_pilares!pilar_id(nome,codigo)')
        .eq('estagiario_id', p.estagiario_id)
        .eq('instrutor_id', p.destinatario_id)
        .order('atribuido_em', { ascending: false })
        .limit(1);
      const at = atrib?.[0];
      if (!at) {
        await supabase.from('la_educa_lembretes_log')
          .update({ mensagem: 'SKIP: atribuicao removida antes do envio' })
          .eq('id', p.id);
        continue;
      }

      const { data: estag } = await supabase
        .from('la_educa_estagiarios')
        .select('nome, mentor_id')
        .eq('id', p.estagiario_id)
        .single();
      const mentor = estag?.mentor_id ? await buscarCollab(estag.mentor_id) : null;
      const mentorNome = mentor?.full_name || '—';

      const primeiroNome = instrutor.full_name.split(' ')[0];
      const pilarNome = at.pilar?.nome || at.pilar?.codigo || '—';
      const msg = `Olá ${primeiroNome}! 🎓\n\nVocê foi atribuído como instrutor de *${pilarNome}* pra ${estag?.nome || 'um estagiário'} (mentor: ${mentorNome}).\n\nAcesse o LA Organizer pra ver os checkpoints e começar as avaliações 🎵`;

      await whatsapp.sendMessage(instrutor.phone, msg);
      await supabase.from('la_educa_lembretes_log')
        .update({ mensagem: msg, enviado_em: new Date().toISOString() })
        .eq('id', p.id);
      console.log(`[la-educa atrib] enviado pra ${instrutor.full_name} sobre ${estag?.nome}`);
    } catch (err) {
      console.error(`[la-educa atrib] erro ${p.id}: ${err.message}`);
      await supabase.from('la_educa_lembretes_log')
        .update({ mensagem: 'ERRO: ' + err.message })
        .eq('id', p.id);
    }
  }
}

module.exports = { runLaEducaLembretes, processarNotificacoesAtribuicao };

// CLI standalone
if (require.main === module) {
  runLaEducaLembretes().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

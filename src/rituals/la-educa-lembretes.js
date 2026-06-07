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
const { isQuietNow, nowBrtParts } = require('../services/quiet-hours');
// Fatia G fase 2: claim atômico idempotente reutilizável (ver src/rituals/ritual-claim.js).
const { claimRitualSend, rollbackRitualClaim, isTransientRitualError } = require('./ritual-claim');

const SEMI_WEEK_MS = 6 * 86400 * 1000;

// Segunda-feira da semana atual como YYYY-MM-DD — chave estável p/ o claim 1/mentor/semana.
// Usa UTC, consistente com o `today` (new Date().toISOString().slice(0,10)) que estas
// funções já usavam como reference_date.
function weekStartYmd() {
  const dt = new Date();
  const dow = dt.getUTCDay();            // 0=dom..6=sáb
  const off = dow === 0 ? -6 : 1 - dow;  // → segunda
  dt.setUTCDate(dt.getUTCDate() + off);
  return dt.toISOString().slice(0, 10);
}

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
      if ((await isQuietNow(responsavel.id, nowBrtParts(), 'work')).quiet) continue; // silêncio trabalho → defer
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
      if ((await isQuietNow(coord.id, nowBrtParts(), 'work')).quiet) continue; // silêncio trabalho → defer
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
      if ((await isQuietNow(coord.id, nowBrtParts(), 'work')).quiet) continue; // silêncio trabalho → defer
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

    const refWeek = weekStartYmd();

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
    if ((await isQuietNow(mentor.id, nowBrtParts(), 'work')).quiet) continue; // silêncio trabalho → defer
    // Fatia G fase 2: claim atômico (1/mentor/semana) antes de enviar — substitui o
    // check-then-act (query jaEnviou + insert pós-envio). O claim grava a linha 'sent'.
    const claim = await claimRitualSend(supabase, mentor.id, 'la_educa_resumo_mentor', refWeek);
    if (!claim.won) { if (!claim.duplicate) console.error(`[la-educa resumo] claim_err(${claim.code}) ${mentor.full_name}`); continue; }
    try {
      await whatsapp.sendMessage(mentor.phone, msg);
      enviados++;
    } catch (err) {
      console.error(`[la-educa resumo] falha pra ${mentor.full_name}: ${err.message}`);
      if (isTransientRitualError(err)) await rollbackRitualClaim(supabase, claim.id);
    }
  }

  console.log(`[la-educa] resumo semanal: ${enviados} mentores em ${Date.now() - inicio}ms`);
}

// ── Feature 2: Fila genérica de notificações (processa todos os *_envio) ─────

async function marcarSkip(id, motivo) {
  await supabase.from('la_educa_lembretes_log')
    .update({ mensagem: 'SKIP: ' + motivo })
    .eq('id', id);
}

// --- Montadores de mensagem ---

async function montarMsgAtribuicao(p, destinatario, estag) {
  const { data: atrib } = await supabase
    .from('la_educa_responsaveis_pilar')
    .select('pilar_id, instrutor_id, pilar:la_educa_pilares!pilar_id(nome,codigo)')
    .eq('estagiario_id', p.estagiario_id)
    .eq('instrutor_id', p.destinatario_id)
    .order('atribuido_em', { ascending: false })
    .limit(1);
  const at = atrib?.[0];
  if (!at) return null;

  const mentor = estag?.mentor_id ? await buscarCollab(estag.mentor_id) : null;
  const mentorNome = mentor?.full_name || '—';
  const primeiroNome = destinatario.full_name.split(' ')[0];
  const pilarNome = at.pilar?.nome || at.pilar?.codigo || '—';
  return `Olá ${primeiroNome}! 🎓\n\nVocê foi atribuído como instrutor de *${pilarNome}* pra ${estag?.nome || 'um estagiário'} (mentor: ${mentorNome}).\n\nAcesse o LA Organizer pra ver os checkpoints e começar as avaliações 🎵`;
}

async function montarMsgCadastro(destinatario, estag) {
  const { data: trilha } = await supabase
    .from('la_educa_trilhas')
    .select('nome')
    .eq('id', estag.trilha_id)
    .single();
  const trilhaNome = trilha?.nome || '—';
  const primeiroNome = destinatario.full_name.split(' ')[0];
  return `Olá ${primeiroNome}! 🎓\n\nVocê foi atribuído como mentor de *${estag.nome}* (${trilhaNome}) na unidade ${estag.unidade}.\n\nAcesse o LA Organizer pra acompanhar e delegar pilares aos instrutores 🎵`;
}

async function montarMsgCertificado(destinatario, estag) {
  const { data: trilha } = await supabase
    .from('la_educa_trilhas')
    .select('nome')
    .eq('id', estag.trilha_id)
    .single();
  const trilhaNome = trilha?.nome || '—';
  const mentor = estag.mentor_id ? await buscarCollab(estag.mentor_id) : null;
  const mentorNome = mentor?.full_name || '—';
  const emitidoEm = estag.certificado_emitido_em
    ? new Date(estag.certificado_emitido_em).toLocaleDateString('pt-BR')
    : '—';
  return `🏆 LA EDUCA — Certificado Alfa emitido!\n\n${estag.nome} concluiu toda a Trilha de Ancoragem.\n\nTrilha: ${trilhaNome}\nUnidade: ${estag.unidade}\nMentor: ${mentorNome}\nEmitido em: ${emitidoEm}\n\nParabéns à equipe pedagógica! 🎉`;
}

async function montarMsgCustom(destinatario, estag) {
  const primeiroNome = destinatario.full_name.split(' ')[0];
  return `Olá ${primeiroNome}!\n\nUm checkpoint personalizado foi criado pra ${estag.nome} (você é mentor).\nAcesse o LA Organizer pra revisar.`;
}

async function montarMsgNotaAnormal(destinatario, estag) {
  return `⚠️ LA EDUCA — Nota fora do padrão\n\nUm checkpoint de ${estag.nome} foi ancorado com nota fora do range esperado (<5 ou ≥9.5).\n\nVale dar uma olhada — pode ser sinal de ajuste no critério ou no acompanhamento.`;
}

// --- Processador genérico de fila ---

async function processarFilaNotificacoes() {
  const { data: pendentes } = await supabase
    .from('la_educa_lembretes_log')
    .select('id, tipo, destinatario_id, estagiario_id, enviado_em')
    .like('tipo', '%_envio')
    .is('mensagem', null)
    .limit(50);
  if (!pendentes || pendentes.length === 0) return;

  console.log(`[la-educa fila] ${pendentes.length} pendente(s)`);

  for (const p of pendentes) {
    try {
      const destinatario = await buscarCollab(p.destinatario_id);
      if (!destinatario?.phone || !destinatario.is_active) {
        await marcarSkip(p.id, 'sem phone/inativo');
        continue;
      }

      const { data: estag } = await supabase
        .from('la_educa_estagiarios')
        .select('id, nome, mentor_id, unidade, trilha_id, certificado_emitido_em')
        .eq('id', p.estagiario_id)
        .single();
      if (!estag) { await marcarSkip(p.id, 'estagiario removido'); continue; }

      let msg;
      switch (p.tipo) {
        case 'atribuicao_pendente_envio':
          msg = await montarMsgAtribuicao(p, destinatario, estag);
          break;
        case 'estagiario_cadastrado_envio':
          msg = await montarMsgCadastro(destinatario, estag);
          break;
        case 'certificado_emitido_envio':
          msg = await montarMsgCertificado(destinatario, estag);
          break;
        case 'checkpoint_custom_criado_envio':
          msg = await montarMsgCustom(destinatario, estag);
          break;
        case 'nota_anormal_envio':
          msg = await montarMsgNotaAnormal(destinatario, estag);
          break;
        default:
          msg = null;
      }
      if (!msg) { await marcarSkip(p.id, 'tipo desconhecido ou dados insuficientes'); continue; }

      if ((await isQuietNow(destinatario.id, nowBrtParts(), 'work')).quiet) continue; // silêncio trabalho → defer (fila reprocessa)
      await whatsapp.sendMessage(destinatario.phone, msg);
      await supabase.from('la_educa_lembretes_log')
        .update({ mensagem: msg, enviado_em: new Date().toISOString() })
        .eq('id', p.id);
      console.log(`[la-educa fila] ${p.tipo} → ${destinatario.full_name}`);
    } catch (err) {
      console.error(`[la-educa fila] ${p.id} erro: ${err.message}`);
      await marcarSkip(p.id, 'ERRO: ' + err.message);
    }
  }
}

// Alias retrocompat
const processarNotificacoesAtribuicao = processarFilaNotificacoes;

// ── G6: Escalation — quarta 10:00 ────────────────────────────────────────────

async function runLaEducaEscalation() {
  const inicio = Date.now();
  console.log('[la-educa] escalation iniciada');
  const limite = new Date(Date.now() - 14 * 86400 * 1000).toISOString();

  const { data: silenciosos } = await supabase
    .from('la_educa_lembretes_log')
    .select('id, destinatario_id, estagiario_id, enviado_em')
    .eq('tipo', 'avaliacao_pendente')
    .lt('enviado_em', limite)
    .order('enviado_em', { ascending: false });
  if (!silenciosos) return;

  const seen = new Set();
  let enviados = 0;
  for (const s of silenciosos) {
    if (seen.has(s.estagiario_id)) continue;
    seen.add(s.estagiario_id);

    const { data: e } = await supabase
      .from('la_educa_progresso')
      .select('id, nome, unidade, mentor_nome, ultima_atualizacao, percentual')
      .eq('id', s.estagiario_id)
      .single();
    if (!e || !e.ultima_atualizacao) continue;
    const dias = Math.floor((Date.now() - new Date(e.ultima_atualizacao).getTime()) / 86400000);
    if (dias < 21) continue;
    if (Number(e.percentual) >= 100) continue;

    const { data: coords } = await supabase
      .from('collaborators')
      .select('id, full_name, phone')
      .in('role', ['coordinator', 'director'])
      .eq('is_active', true)
      .or(`unit.eq.${e.unidade},unit.eq.all`);
    if (!coords) continue;

    for (const c of coords) {
      if (!c.phone) continue;
      if (await jaEnviouRecente('escalation', e.id, c.id)) continue;
      const msg = `🚨 LA EDUCA — Escalation\n\nEstagiário ${e.nome} está parado há ${dias} dias.\nMentor (${e.mentor_nome || '—'}) recebeu lembrete mas não houve avaliação.\nProgresso: ${Math.round(e.percentual || 0)}%\n\nCobre o mentor ou reatribua o estagiário no LA Organizer.`;
      try {
        if ((await isQuietNow(c.id, nowBrtParts(), 'work')).quiet) continue; // silêncio trabalho → defer
        await whatsapp.sendMessage(c.phone, msg);
        await logEnvio('escalation', e.id, c.id, msg);
        enviados++;
      } catch (err) {
        console.error(`[la-educa escalation] falha: ${err.message}`);
      }
    }
  }
  console.log(`[la-educa] escalation: ${enviados} avisos em ${Date.now() - inicio}ms`);
}

// ── G7: Briefing sexta — sexta 14:00 ─────────────────────────────────────────

async function runLaEducaBriefingSexta() {
  const inicio = Date.now();
  const { data: mentores } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('is_active', true)
    .not('phone', 'is', null);
  if (!mentores) return;

  const refWeek = weekStartYmd();
  let enviados = 0;
  for (const mentor of mentores) {
    const { data: pend } = await supabase
      .from('la_educa_progresso')
      .select('nome, percentual, checkpoints_ancorados, checkpoints_total')
      .eq('mentor_id', mentor.id)
      .lt('percentual', 100);
    if (!pend || pend.length === 0) continue;

    const primeiroNome = mentor.full_name.split(' ')[0];
    const linhas = pend.map(e => `• ${e.nome} (${e.checkpoints_ancorados}/${e.checkpoints_total} = ${Math.round(e.percentual)}%)`).join('\n');
    const msg = `Olá ${primeiroNome}! 👋\n\nFinal de semana chegando. Estagiários sob sua coordenação com pendências:\n\n${linhas}\n\nDá uma força e marca as próximas avaliações 🎵`;

    if ((await isQuietNow(mentor.id, nowBrtParts(), 'work')).quiet) continue; // silêncio trabalho → defer
    // Fatia G fase 2: claim atômico (1/mentor/semana) antes de enviar.
    const claim = await claimRitualSend(supabase, mentor.id, 'la_educa_briefing_sexta', refWeek);
    if (!claim.won) { if (!claim.duplicate) console.error(`[la-educa briefing-sexta] claim_err(${claim.code}) ${mentor.full_name}`); continue; }
    try {
      await whatsapp.sendMessage(mentor.phone, msg);
      enviados++;
    } catch (err) {
      console.error(`[la-educa briefing-sexta] ${mentor.full_name}: ${err.message}`);
      if (isTransientRitualError(err)) await rollbackRitualClaim(supabase, claim.id);
    }
  }
  console.log(`[la-educa] briefing sexta: ${enviados} mentores em ${Date.now() - inicio}ms`);
}

module.exports = {
  runLaEducaLembretes,
  processarFilaNotificacoes,
  processarNotificacoesAtribuicao, // alias retrocompat
  runLaEducaEscalation,
  runLaEducaBriefingSexta,
};

// CLI standalone
if (require.main === module) {
  runLaEducaLembretes().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

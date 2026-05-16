// src/rituals/la-educa-lembretes.js
// Lembretes semanais do LA EDUCA — disparado pelo dispatcher toda segunda 09:00.
// Três tipos:
//   1. avaliacao_pendente  → mentor (estagiário >7d sem update)
//   2. avaliacao_atrasada  → coord/director da unidade (>14d sem update)
//   3. certificado_pronto  → coord/director da unidade (100% e sem cert)
// Idempotência: la_educa_lembretes_log — não reenvia mesmo tipo+estagiário em <6 dias.
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

async function enviarPendente(estagiario) {
  const mentor = await buscarCollab(estagiario.mentor_id);
  if (!mentor || !mentor.phone || !mentor.is_active) return;
  if (await jaEnviouRecente('avaliacao_pendente', estagiario.id, mentor.id)) return;
  const dias = Math.floor((Date.now() - new Date(estagiario.ultima_atualizacao).getTime()) / 86400000);
  const msg =
`Olá ${mentor.full_name.split(' ')[0]}! 👋

Lembrete LA EDUCA: ${estagiario.nome} está com avaliações pendentes há ${dias} dias.

Progresso atual: ${estagiario.checkpoints_ancorados}/${estagiario.checkpoints_total} (${Math.round(estagiario.percentual)}%).

Acesse o LA Organizer pra registrar as avaliações. 🎵`;
  try {
    await whatsapp.sendMessage(mentor.phone, msg);
    await logEnvio('avaliacao_pendente', estagiario.id, mentor.id, msg);
    console.log(`[la-educa] pendente enviado pra mentor ${mentor.full_name} sobre ${estagiario.nome}`);
  } catch (err) {
    console.error(`[la-educa] falha pendente ${estagiario.nome}: ${err.message}`);
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
}

module.exports = { runLaEducaLembretes };

// CLI standalone
if (require.main === module) {
  runLaEducaLembretes().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

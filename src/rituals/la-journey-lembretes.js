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
  if (tipo === 'kickoff') return `Bem-vindo ao LA Journey! Você foi atribuído como mentor. Comece em la-organizer.com/la-journey`;
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

module.exports = {
  runLaJourneyLembreteSemanal,
  runLaJourneyAlertaAtraso,
  processarFilaLaJourney,
};

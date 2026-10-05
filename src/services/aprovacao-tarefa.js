'use strict';
// src/services/aprovacao-tarefa.js — APROVACAO-DE-TAREFA-NAO-CHEGAVA (auditoria 05/10).
//
// O DEFEITO. Tarefa criada com um request_type que tem requires_approval nascia
// status='awaiting_confirmation' (engine, applyTaskActions — log AWAIT_APPROVAL) e o TOM dizia à
// pessoa "entra pendente de aprovação do Luciano… vou avisar quando aprovarem". Nenhum pedido saía:
// aprovar só existia como botão no app (OperacaoDetalhe.tsx, canApprove) e o único aviso era o
// resumo de segunda 07:30 do departamento, que vai pro default_responsible — em operacoes-tecnicas,
// a própria Rafinha. Resultado: 15 tarefas paradas desde 30/05 (c2a87b2f "Infiltração teto banheiro
// — Campo Grande" 03/10, 547edde2 "Comprar 2 pads de estudo — Barra" 02/10, 84beb268 "Manutenção
// dreno e troca de piso — Unidade Barra" 01/10…). A promessa do TOM era falsa.
//
// O CONSERTO copia o padrão que já funciona na MANUTENÇÃO (engine, INVENTORY_ACTION maintenance):
// aprovador pela matriz (approvals.resolveApproverFor) → pending_intent approval_pending no nome
// dele (domain 'task', token APROV-XXXX) → card no WhatsApp com APROVA/REJEITA → gravado no
// histórico DELE (_registrarAvisoNoHistorico, lição AVISO-A-TERCEIRO-FORA-DO-HISTORICO). A resposta
// cai no funil determinístico de aprovação do engine (detect-approval-reply), que chama
// decidirAprovacaoDeTarefa: APROVA → 'pending' (dono mantido); REJEITA → 'cancelled'; quem pediu
// recebe ✅/❌ e o aviso entra no histórico dela.
//
// Dependências injetadas (nada de envio real em teste): { supabase, approvals, enviar(phone, txt),
// registrarAviso(id, txt, phone?), resolverAprovador(creatorId), gerarToken() }.

const VALOR_RE = /R\$\s?\d{1,3}(?:\.\d{3})+(?:,\d{2})?|R\$\s?\d+(?:,\d{2})?/i;

function extrairValor(...textos) {
  for (const t of textos) {
    const m = String(t == null ? '' : t).match(VALOR_RE);
    if (m) return m[0];
  }
  return null;
}

function gerarTokenPadrao() {
  return `APROV-${require('crypto').randomBytes(2).toString('hex').toUpperCase()}`;
}

function montarCardAprovacao({ titulo, solicitante, departamento, tipo, valor, descricao, token }) {
  const onde = [departamento, tipo].filter(Boolean).join(' · ');
  const linhas = [
    `📋 *${solicitante || 'Alguém da equipe'}* pediu sua aprovação${onde ? ` (${onde})` : ''}:`,
    `*${titulo}*`,
  ];
  if (valor) linhas.push(`💰 ${valor}`);
  if (descricao && String(descricao).trim()) linhas.push(`🧭 ${String(descricao).trim().slice(0, 300)}`);
  linhas.push('', `*APROVA ${token}* ou *REJEITA ${token}* (pode pôr o motivo depois do código)`);
  return linhas.join('\n');
}

// O que o TOM diz a quem pediu, no mesmo turno da criação. Só promete aviso quando o pedido SAIU
// (é o lastro que lib/aviso-condicional.js confere). null = nada a acrescentar.
function avisoAoSolicitante(resultado, titulo) {
  const t = `*${String(titulo || 'tarefa').slice(0, 80)}*`;
  switch (resultado && resultado.status) {
    case 'enviada':
      return `📨 Mandei o pedido de aprovação de ${t} pro *${resultado.aprovador.full_name}*. Quando responder, te aviso aqui.`;
    case 'sem_aprovador':
      return `⏳ ${t} fica aguardando aprovação no app — não achei quem aprova pra mandar o pedido, então não consigo te avisar quando decidirem.`;
    case 'falhou_envio':
    case 'falhou':
      return `⚠️ ${t} ficou aguardando aprovação, mas o pedido não saiu pro aprovador — avisa ${resultado.aprovador ? `o *${resultado.aprovador.full_name}*` : 'quem aprova'} direto, por favor.`;
    default:
      return null;
  }
}

async function abrirAprovacaoDeTarefa(deps, { task, solicitante, departamento = null, tipo = null }) {
  const { supabase, approvals, enviar, registrarAviso, resolverAprovador } = deps;
  const gerarToken = deps.gerarToken || gerarTokenPadrao;
  if (!task || !task.id || !solicitante) return { status: 'falhou' };

  // Idempotente: pedido já aberto pra esta tarefa (re-emit, retry) → não manda 2º card.
  const existente = await approvals.findOpenApprovalByRef(supabase, task.id);
  if (existente) return { status: 'ja_aberta', token: existente.payload && existente.payload.token, aprovadorId: existente.collaborator_id };

  const aprovador = await resolverAprovador(solicitante.id);
  if (!aprovador || !aprovador.phone || aprovador.id === solicitante.id) return { status: 'sem_aprovador' };

  const token = gerarToken();
  const intentId = await approvals.openTaskApproval(supabase, {
    approverId: aprovador.id, taskId: task.id, token, title: task.title,
    requesterId: solicitante.id, requesterName: solicitante.full_name, requesterPhone: solicitante.phone || null,
  });
  if (!intentId) return { status: 'falhou', aprovador };

  const card = montarCardAprovacao({
    titulo: task.title, solicitante: solicitante.full_name, departamento, tipo,
    valor: extrairValor(task.title, task.description), descricao: task.description, token,
  });
  try {
    await enviar(aprovador.phone, card);
  } catch (e) {
    // Card que não saiu não pode virar aprovação fantasma (pendência aberta que ninguém viu).
    console.warn(`[AprovacaoTarefa] card não saiu pra ${String(aprovador.id).slice(0, 8)}: ${e.message}`);
    try { await approvals.resolveApprovalByRef(supabase, task.id, 'superseded', `card não saiu: ${e.message}`); } catch (_) {}
    return { status: 'falhou_envio', aprovador };
  }
  try { await registrarAviso(aprovador.id, card); } catch (_) { /* aviso já saiu */ }
  console.log(`[AprovacaoTarefa] pedido ${token} da tarefa ${String(task.id).slice(0, 8)} → ${aprovador.full_name}`);
  return { status: 'enviada', token, aprovador };
}

const STATUS_PT = { pending: 'pendente', in_progress: 'em andamento', done: 'concluída', cancelled: 'cancelada' };

async function decidirAprovacaoDeTarefa(deps, { intent, decisao, motivo = null, aprovador }) {
  const { supabase, approvals, enviar, registrarAviso } = deps;
  const p = (intent && intent.payload) || {};
  const taskId = p.ref_id;
  const nomeAprov = (aprovador && aprovador.full_name) || 'a coordenação';
  const aprovar = decisao === 'approve';

  const { data: task, error: tErr } = await supabase.from('tasks')
    .select('id, title, status, created_by, assigned_to').eq('id', taskId).maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!task) {
    await approvals.resolveApprovalByRef(supabase, taskId, 'superseded', 'tarefa não existe mais');
    return { reply: `A tarefa *${p.title || 'do pedido'}* não existe mais — fechei o pedido de aprovação.`, avisou: false };
  }
  const jaDecidida = () => ({
    reply: `*${task.title}* já não está aguardando aprovação (está ${STATUS_PT[task.status] || task.status}). Não mudei nada.`,
    avisou: false,
  });
  if (task.status !== 'awaiting_confirmation') {
    await approvals.resolveApprovalByRef(supabase, taskId, 'superseded', `já estava ${task.status}`);
    return jaDecidida();
  }

  // Guarda de corrida: só muda se AINDA estiver aguardando (o app pode ter decidido no meio).
  const { data: mudou, error: uErr } = await supabase.from('tasks')
    .update({ status: aprovar ? 'pending' : 'cancelled', updated_by: aprovador ? aprovador.id : null, updated_at: new Date().toISOString() })
    .eq('id', taskId).eq('status', 'awaiting_confirmation')
    .select('id');
  if (uErr) throw new Error(uErr.message);
  if (!mudou || !mudou.length) {
    await approvals.resolveApprovalByRef(supabase, taskId, 'superseded', 'decidida por outro caminho');
    return jaDecidida();
  }
  await approvals.resolveApprovalByRef(supabase, taskId, aprovar ? 'confirmed' : 'denied',
    `${aprovar ? 'aprovado' : 'rejeitado'} por ${nomeAprov}${!aprovar && motivo ? `: ${motivo}` : ''}`);

  const quem = p.requester_name || 'quem pediu';
  let avisou = false;
  if (p.requester_phone && p.requester_id !== (aprovador && aprovador.id)) {
    const aviso = aprovar
      ? `✅ *${task.title}* foi aprovada por ${nomeAprov} — já está valendo na lista.`
      : `❌ *${task.title}* não foi aprovada por ${nomeAprov}${motivo ? `: ${motivo}` : ''}. Cancelei a tarefa.`;
    try {
      await enviar(p.requester_phone, aviso);
      avisou = true;
      try { await registrarAviso(p.requester_id || null, aviso, p.requester_phone); } catch (_) {}
    } catch (e) { console.warn('[AprovacaoTarefa] aviso ao solicitante falhou:', e.message); }
  }
  const fim = avisou ? `Avisei ${quem}.` : `Não consegui avisar ${quem}.`;
  return {
    reply: aprovar
      ? `✅ *${task.title}* aprovada (pedido de *${quem}*). ${fim}`
      : `❌ *${task.title}* rejeitada e cancelada (pedido de *${quem}*). ${fim}`,
    avisou,
  };
}

module.exports = { extrairValor, montarCardAprovacao, avisoAoSolicitante, abrirAprovacaoDeTarefa, decidirAprovacaoDeTarefa, gerarTokenPadrao };

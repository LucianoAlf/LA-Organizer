// src/realtime/tom-realtime.js — Subscriber Supabase Realtime do TOM.
// Escuta mudancas em project_checkpoints, tasks, projects e dispara
// mensagens WhatsApp em tempo real. Throttle de 1h por evento+id pra evitar spam.

const { createClient } = require('@supabase/supabase-js');
// supabase-realtime-js v2.104+ exige Node.js 22+ pra WebSocket nativo.
// O VPS roda Node 20, entao passamos o pacote `ws` explicitamente como transport.
const wsLib = require('ws');

// Criado lazy dentro de startRealtime() para garantir que o .env ja foi carregado.
// Usa ANON_KEY — conexao Realtime WebSocket nao aceita service_role;
// service_role e usado so nas queries de enriquecimento (supabaseMain).
let _supabaseRealtime = null;
function getRealtimeClient() {
  if (!_supabaseRealtime) {
    _supabaseRealtime = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        realtime: {
          timeout: 30000,
          transport: wsLib, // Node 20 nao tem WebSocket nativo — passa ws explicito
        }
      }
    );
  }
  return _supabaseRealtime;
}

// Throttle: max 1 mensagem por (table:id:event) por hora
const recentEvents = new Map();
function shouldProcess(key) {
  const last = recentEvents.get(key);
  if (last && Date.now() - last < 60 * 60 * 1000) return false;
  recentEvents.set(key, Date.now());
  return true;
}

// Limpa entradas velhas a cada hora
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, ts] of recentEvents) {
    if (ts < cutoff) recentEvents.delete(key);
  }
}, 60 * 60 * 1000);

/**
 * @param {function} sendWhatsApp - (phone, msg) => Promise<void>
 * @param {object} supabaseMain - cliente Supabase usado pra queries de enriquecimento
 */
function startRealtime(sendWhatsApp, supabaseMain) {
  console.log('[Realtime] Iniciando subscriber...');

  const channel = getRealtimeClient()
    .channel('tom-events')

    // 1. Checkpoint marcado como done -> celebra
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'project_checkpoints',
      filter: 'status=eq.done',
    }, async (payload) => {
      const cp = payload.new;
      const key = `checkpoint:${cp.id}:done`;
      if (!shouldProcess(key)) return;

      try {
        const { data: full } = await supabaseMain
          .from('project_checkpoints')
          .select('name, assigned_to, projects(name, created_by)')
          .eq('id', cp.id)
          .maybeSingle();
        if (!full) return;

        const responsavelId = full.assigned_to || full.projects?.created_by;
        if (!responsavelId) return;

        const { data: colab } = await supabaseMain
          .from('collaborators')
          .select('phone, full_name, preferred_name')
          .eq('id', responsavelId)
          .maybeSingle();
        if (!colab?.phone) return;

        const nome = (colab.preferred_name || colab.full_name || '').split(' ')[0] || 'voce';
        const msg = `🎉 *${full.projects?.name || 'Projeto'}*\n`
          + `Checkpoint *${full.name}* marcado como concluido!\n`
          + `Boa, ${nome}! 🚀`;
        await sendWhatsApp(colab.phone, msg);
        console.log(`[Realtime] Celebracao enviada -> ${colab.full_name}`);
      } catch (e) {
        console.error('[Realtime] Erro checkpoint done:', e.message);
      }
    })

    // 2. Task urgente inserida em projeto -> alerta responsavel
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'tasks',
      filter: 'priority=eq.urgent',
    }, async (payload) => {
      const task = payload.new;
      if (!task.project_id || !task.assigned_to) return;
      const key = `task:${task.id}:urgent`;
      if (!shouldProcess(key)) return;

      try {
        const { data: colab } = await supabaseMain
          .from('collaborators')
          .select('phone, full_name, preferred_name')
          .eq('id', task.assigned_to)
          .maybeSingle();
        if (!colab?.phone) return;

        const nome = (colab.preferred_name || colab.full_name || '').split(' ')[0] || 'voce';
        const msg = `⚡ *Task urgente adicionada ao projeto!*\n`
          + `"${task.title}"\n`
          + `Atribuida pra ${nome}. Bora! 💪`;
        await sendWhatsApp(colab.phone, msg);
        console.log(`[Realtime] Alerta task urgente -> ${colab.full_name}`);
      } catch (e) {
        console.error('[Realtime] Erro task urgente:', e.message);
      }
    })

    // 3. Projeto muda de planning -> active -> onboarding do time
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'projects',
    }, async (payload) => {
      const old = payload.old;
      const novo = payload.new;
      if (old?.status !== 'planning' || novo?.status !== 'active') return;

      const key = `project:${novo.id}:active`;
      if (!shouldProcess(key)) return;

      try {
        const { data: members } = await supabaseMain
          .from('project_members')
          .select('collaborator_id, collaborators(full_name, preferred_name, phone)')
          .eq('project_id', novo.id)
          .not('collaborator_id', 'is', null);

        let enviados = 0;
        for (const m of members || []) {
          const c = m.collaborators;
          if (!c?.phone) continue;
          const nome = (c.preferred_name || c.full_name || '').split(' ')[0] || 'voce';
          const msg = `🚀 *Projeto ${novo.name} foi ativado!*\n`
            + `E agora, ${nome}! O projeto saiu do planejamento e entrou em execucao. 💪`;
          await sendWhatsApp(c.phone, msg);
          enviados++;
        }
        console.log(`[Realtime] Onboarding projeto ativo -> ${novo.name} (${enviados} membros)`);
      } catch (e) {
        console.error('[Realtime] Erro projeto ativo:', e.message);
      }
    })

    // F6 (auditoria 09/06) — Aprovação pelo PWA (botão ✓): o app grava direto no banco
    // (pending_approval → planning) SEM passar pelo applyProjectApprove → o criador nunca
    // era avisado. Aqui espelhamos a notificação do engine e fechamos as intents (F1).
    // Dedup com o caminho WhatsApp: o engine seta requires_approval=false NO MESMO update;
    // o PWA deixa true → só notificamos quando requires_approval ainda é true.
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'projects',
    }, async (payload) => {
      const old = payload.old;
      const novo = payload.new;
      if (old?.status !== 'pending_approval' || novo?.status !== 'planning') return;
      if (novo?.requires_approval !== true) return; // veio do engine (já notificou)
      const key = `project:${novo.id}:approved`;
      if (!shouldProcess(key)) return;
      try {
        const approvalsService = require('../services/approvals');
        await approvalsService.resolveApprovalByRef(supabaseMain, novo.id, 'confirmed', 'aprovado via PWA');
        // normaliza o flag (consistência com o caminho do engine)
        await supabaseMain.from('projects').update({ requires_approval: false }).eq('id', novo.id);
        let approverName = 'seu líder';
        if (novo.approved_by) {
          const { data: ap } = await supabaseMain.from('collaborators')
            .select('full_name').eq('id', novo.approved_by).maybeSingle();
          if (ap?.full_name) approverName = ap.full_name;
        }
        const { data: creator } = await supabaseMain.from('collaborators')
          .select('phone, full_name').eq('id', novo.created_by).maybeSingle();
        if (creator?.phone) {
          await sendWhatsApp(creator.phone, `🎉 *${novo.name}* foi aprovado por *${approverName}*!\n\nO TOM já vai começar a estruturar e distribuir as tarefas.`);
          console.log(`[Realtime] aprovação via PWA → criador de "${novo.name}" avisado`);
        }
      } catch (e) {
        console.error('[Realtime] erro notif aprovação PWA:', e.message);
      }
    })

    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] Conectado ao Supabase Realtime');
      } else if (status === 'CHANNEL_ERROR') {
        // Sprint 31.6 (D2) — CHANNEL_ERROR é tipicamente uma queda transitória de
        // WebSocket; o supabase-js reconecta sozinho (com backoff). O `err` vem
        // undefined nesses casos. Antes: console.error('...:', undefined) →
        // poluía o error log e inflava "erros recorrentes" na auditoria diária.
        // Agora: warn (sai do error log) com detalhe real quando houver.
        const detail = (err && (err.message || String(err))) || 'queda transitória, reconectando automaticamente';
        console.warn(`[Realtime] canal instável: ${detail}`);
      } else if (status === 'TIMED_OUT') {
        console.warn('[Realtime] timeout — supabase-js tenta reconectar sozinho');
      } else if (status === 'CLOSED') {
        console.log('[Realtime] Canal fechado');
      }
    });

  process.on('SIGTERM', () => {
    try { getRealtimeClient().removeChannel(channel); } catch {}
  });

  return channel;
}

module.exports = { startRealtime };

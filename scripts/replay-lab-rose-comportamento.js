#!/usr/bin/env node
// scripts/replay-lab-rose-comportamento.js
// Teste de COMPORTAMENTO REAL (LLM no loop) — a Rose conversando com o TOM num grupo de QA.
// Passa cada mensagem pelo motor de verdade (processGroupChatMessage), captura a FALA do TOM
// (group_chat_messages) E o estado do BANCO após cada turno. Objetivo: ver o comportamento real
// da recorrência de grupo pós-refatoração (criar / listar / concluir / remarcar / "só esse mês" /
// confirmar / conferir / apagar).
//
// Isolado: grupo QA dedicado SEM wa_group_jid → nada vaza pro WhatsApp real. Tarefas marcadas
// 'test'. Limpeza no fim.
//
//   ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/replay-lab-rose-comportamento.js"
'use strict';

const supabase = require('../src/supabase/client');
const { processGroupChatMessage } = require('../src/services/group-chat-engine');

const QA_NOME = '[QA] Replay 01';
const GRUPO_QA = '[QA] Rose Comportamento';
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

const ROTEIRO = [
  'Tom, cria um pacote mensal chamado "Conferência de débitos" com duas tarefas: dia 3 conferir o débito da Light, e dia 15 conferir a fatura do cartão.',
  'o que tá pendente nesse pacote?',
  'já conferi a Light, pode concluir a tarefa do dia 3',
  'a fatura mudou de data, remaneja a do dia 15 pro dia 20',
  'pensando melhor, esse pacote não precisa ser mensal, só esse mês mesmo',
  'sim',
  'me mostra como ficou esse pacote agora',
  'pode apagar o pacote Conferência de débitos inteiro',
];

async function perfilQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name').eq('full_name', QA_NOME).maybeSingle();
  if (!data) throw new Error(`perfil ${QA_NOME} não existe — rode scripts/replay-lab-perfis.sql`);
  return data;
}

async function grupoQA(collabId) {
  const { data: achado } = await supabase.from('work_groups').select('id, wa_group_jid').eq('name', GRUPO_QA).maybeSingle();
  if (achado) {
    if (achado.wa_group_jid) throw new Error(`ABORT: grupo QA tem wa_group_jid (${achado.wa_group_jid}) — vazaria pro WhatsApp real`);
    return achado.id;
  }
  const { data, error } = await supabase.from('work_groups')
    .insert({ name: GRUPO_QA, slug: 'qa-rose-comportamento', leader_id: collabId, created_by: collabId, active: true })
    .select('id').single();
  if (error) throw new Error('criar grupo QA: ' + error.message);
  await supabase.from('work_group_members').insert({ group_id: data.id, collaborator_id: collabId, added_by: collabId });
  return data.id;
}

async function limpar(groupId) {
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  if (!g || g.name !== GRUPO_QA) throw new Error(`recusando limpar: ${groupId} não é o grupo QA`);
  await supabase.from('tasks').delete().eq('assigned_group_id', groupId);
  await supabase.from('group_chat_messages').delete().eq('group_id', groupId);
  await supabase.from('group_chat_pending_confirms').delete().eq('group_id', groupId);
}

function classificar(t) {
  if (t.recurrence_rule != null && t.is_group === true) return 'MOLDE';
  if (t.is_recurrence_template === true && t.recurrence_rule == null) return 'blueprint';
  if (t.is_group === true && t.recurrence_parent_id != null) return 'mãe-inst';
  if (t.recurrence_parent_id != null) return 'inst-child';
  if (t.is_group === true) return 'container';
  return 'avulsa';
}

async function snapshot(groupId) {
  const { data } = await supabase.from('tasks')
    .select('title, status, due_date, is_group, recurrence_rule, recurrence_parent_id, parent_task_id, is_recurrence_template, series_ended_at')
    .eq('assigned_group_id', groupId).order('due_date', { ascending: true, nullsFirst: true });
  const rows = data || [];
  if (!rows.length) return '    (nenhuma tarefa no grupo)';
  return rows.map((t) => {
    const tags = [];
    if (t.is_recurrence_template === true) tags.push('tmpl');
    if (t.series_ended_at) tags.push('ended');
    return `    [${classificar(t).padEnd(10)}] ${String(t.title).slice(0, 34).padEnd(34)} ${String(t.status).padEnd(9)} due=${t.due_date || '-'}${tags.length ? ' {' + tags.join(',') + '}' : ''}`;
  }).join('\n');
}

async function falar(groupId, collabId, texto) {
  const t0 = new Date().toISOString();
  await supabase.from('group_chat_messages').insert({ group_id: groupId, sender_id: collabId, role: 'user', content: texto });
  try {
    await processGroupChatMessage({ supabase, groupId, senderCollabId: collabId, text: texto });
  } catch (e) {
    return `⚠️ ERRO no motor: ${e.message}`;
  }
  await dorme(2000);
  // Marca as tarefas novas como 'test' (o TOM cria como 'real'): não entram em digest de ninguém.
  await supabase.from('tasks').update({ data_classification: 'test' }).eq('assigned_group_id', groupId).eq('data_classification', 'real');
  const { data } = await supabase.from('group_chat_messages')
    .select('content, created_at').eq('group_id', groupId).eq('role', 'tom')
    .gt('created_at', t0).order('created_at', { ascending: true });
  return (data || []).map((m) => (m.content || '').replace(/‹‹ACTIONS››[\s\S]*$/, '').trim()).filter(Boolean).join('\n      ') || '(sem fala)';
}

(async () => {
  const collab = await perfilQA();
  const groupId = await grupoQA(collab.id);
  await limpar(groupId);
  console.log(`\n===== ROSE × TOM — comportamento real (grupo QA ${groupId}) =====`);
  console.log(`perfil: ${collab.full_name}\n`);

  for (let i = 0; i < ROTEIRO.length; i++) {
    const msg = ROTEIRO[i];
    console.log(`\n──────────────────────────────────────────────────────────────`);
    console.log(`👩 ROSE (${i + 1}/${ROTEIRO.length}): ${msg}`);
    const fala = await falar(groupId, collab.id, msg);
    console.log(`🤖 TOM: ${fala}`);
    console.log(`   📋 BANCO:`);
    console.log(await snapshot(groupId));
  }

  console.log(`\n──────────────────────────────────────────────────────────────`);
  console.log('Limpando fixture QA…');
  await limpar(groupId);
  console.log('===== FIM =====\n');
  process.exit(0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });

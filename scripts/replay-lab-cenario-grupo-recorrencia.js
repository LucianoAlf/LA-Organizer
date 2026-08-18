#!/usr/bin/env node
// scripts/replay-lab-cenario-grupo-recorrencia.js
// TRILHO INTEGRAL da refatoração "recorrência de grupo — UMA verdade por ciclo"
// (spec docs/superpowers/specs/2026-08-17-recorrencia-grupo-verdade-unica-design.md §6).
//
// POR QUE ESTE CENÁRIO EXISTE
// Todo fix histórico da Rose (12/06…17/08) consertou UM palpite de UM handler e regrediu,
// porque nunca houve um teste que travasse a invariante-mãe: "criar pacote recorrente de
// grupo ⇒ exatamente UMA verdade por ciclo NO BANCO". `createTaskGroup` nasce com duas
// filhas "Dia 3" na mesma data — a filha-BLUEPRINT (parent_task_id=molde, recurrence_parent_id
// NULL) e a filha-INSTÂNCIA (parent_task_id=mãe-instância, recurrence_parent_id=filha-blueprint).
// O resolvedor de ação (complete/cancel/reschedule) consulta por título e recebe as DUAS,
// indistinguíveis por qualquer campo de UMA linha. É a raiz estrutural.
//
// O QUE SE MEDE — o critério é o BANCO, nunca a fala (memória: teste verde ≠ fix → checar o banco)
//   Cenário 1  double-truth : o conjunto que o resolvedor por título recebe tem 1 viva/ciclo (hoje 2)
//   Cenário 2  derecur       : existe a operação "só o primeiro mês" (hoje ausente)
//   Cenário 5  endSeries     : encerrar série não deixa filha-blueprint pending órfã (hoje deixa)
//   Cenário 6  motor         : materializeSeries é idempotente (motor INTOCADO — guard verde)
//
// BASELINE (Fatia 0, pré-migração): 1,2,5 VERMELHOS; 6 VERDE. É o trilho antes do conserto.
// Cenários 3/4/7/8 (conclusão/remarcação/template-only/re-emissão) são de comportamento e
// entram nas fatias 2–3 via integração — aqui ficam como PENDENTE explícito, NUNCA verde vazio.
//
//   node --env-file=.env scripts/replay-lab-cenario-grupo-recorrencia.js
'use strict';

const supabase = require('../src/supabase/client');
const { createTaskGroup } = require('../src/services/task-groups');
const groupTasks = require('../src/services/group-chat-tasks');
const { materializeSeries } = require('../src/services/recurrence-engine');
const inv = require('../src/services/group-recurrence-invariants');

const QA_NOME = '[QA] Replay 01';
const GRUPO_QA = '[QA] Financeiro Replay';

const _fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const hojeBrt = () => _fmt.format(new Date());
// Limites do mês civil corrente em SP (janela do "ciclo corrente" pra contagem).
function mesCorrenteBrt() {
  const ymd = hojeBrt();            // YYYY-MM-DD
  const ini = ymd.slice(0, 8) + '01';
  const [y, m] = ymd.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m já é 1-based → dia 0 do mês seguinte
  const fim = `${ymd.slice(0, 8)}${String(ultimoDia).padStart(2, '0')}`;
  return { ini, fim };
}

const T1 = 'Dia 3 — conferir débito';
const T2 = 'Dia 15 — conferir fatura';

async function perfilQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name').eq('full_name', QA_NOME).maybeSingle();
  if (!data) throw new Error(`perfil ${QA_NOME} não existe — rode scripts/replay-lab-perfis.sql`);
  return data;
}

async function grupoQA(collabId) {
  const { data: achado } = await supabase.from('work_groups').select('id, name').eq('name', GRUPO_QA).maybeSingle();
  if (achado) return achado.id;
  const { data, error } = await supabase.from('work_groups')
    .insert({ name: GRUPO_QA, slug: 'qa-financeiro-replay', leader_id: collabId, created_by: collabId, active: true })
    .select('id').single();
  if (error) throw new Error('criar grupo QA: ' + error.message);
  await supabase.from('work_group_members').insert({ group_id: data.id, collaborator_id: collabId, added_by: collabId });
  return data.id;
}

// Fail-closed: só apaga dentro do grupo QA nomeado. Nunca toca o grupo Financeiro real.
async function limpar(groupId) {
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  if (!g || g.name !== GRUPO_QA) throw new Error(`recusando limpar: ${groupId} não é o grupo QA`);
  await supabase.from('tasks').delete().eq('assigned_group_id', groupId);
  await supabase.from('group_chat_messages').delete().eq('group_id', groupId);
}

// Monta o pacote mensal com o MOTOR de produção (createTaskGroup) e remarca como 'test'
// pra não entrar em digest/relatório de ninguém nos segundos em que existe.
async function montarPacote(groupId, collabId, subtasks) {
  await limpar(groupId);
  const hojeDia = Number(hojeBrt().slice(8, 10));
  const pacote = await createTaskGroup({
    supabase, groupId, createdBy: collabId,
    input: {
      title: 'Conferência mensal (QA recorrência)', recurrence: 'monthly', groupDay: 1,
      subtasks: subtasks || [{ title: T1, day: Math.min(hojeDia, 3) }, { title: T2, day: 15 }],
    },
  });
  await supabase.from('tasks').update({ data_classification: 'test' }).eq('assigned_group_id', groupId);
  return pacote;
}

// Espelha a query do resolvedor de complete (group-chat-tasks.js:348-360): é o conjunto de
// candidatos que o handler recebe pra um título. A raiz mora aqui. Usa `*` de propósito — o
// flag `is_recurrence_template` só existe pós-migração (Fatia 1); com `*` ele FLUI quando
// existe e fica `undefined` quando não (contado como vivo → pré-migração dá 2 = o bug real).
// Selecionar a coluna nominalmente pré-migração faria o PostgREST erdar e devolver 0 —
// vermelho por vacuidade, não pela dupla verdade.
async function candidatosDoResolvedor(groupId, titulo) {
  const { data, error } = await supabase.from('tasks')
    .select('*')
    .eq('assigned_group_id', groupId)
    .neq('status', 'cancelled')
    .ilike('title', titulo)
    .order('due_date', { ascending: false })
    .limit(30);
  if (error) throw new Error('candidatosDoResolvedor: ' + error.message);
  return data || [];
}

// Lê uma filha específica por (parent, título). Blueprint: parent=molde; instância: parent=mãe-inst.
async function acharFilha(parentId, titulo) {
  const { data } = await supabase.from('tasks')
    .select('id, title, status, due_date, is_recurrence_template, recurrence_parent_id')
    .eq('parent_task_id', parentId).ilike('title', titulo).maybeSingle();
  return data;
}
async function contarTarefas(groupId) {
  const { count } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('assigned_group_id', groupId);
  return count || 0;
}

const linha = (n, nome, ok, got, exp, extra) =>
  console.log(`CENARIO ${n} [${nome}]: ${ok ? 'PASS' : 'FAIL'} — medido=${got} esperado=${exp}${extra ? ` · ${extra}` : ''}`);

(async () => {
  const collab = await perfilQA();
  const groupId = await grupoQA(collab.id);
  const { ini, fim } = mesCorrenteBrt();
  console.log(`[cenario-grupo-recorrencia] perfil=${collab.full_name} grupo=${groupId} mês=[${ini}..${fim}]`);
  console.log('[cenario-grupo-recorrencia] guards sempre-verdes: 6 (motor) + 1b (clone). Progresso: 1(F1) 2(F3) 5(F4).\n');

  const resultados = [];

  // ── Cenário 1: double-truth (o coração da refatoração) ────────────────────────
  try {
    await montarPacote(groupId, collab.id);
    const cand = await candidatosDoResolvedor(groupId, T1);
    const vivas = inv.contarVivasPorCicloTitulo(cand, { titulo: T1, ymdIni: ini, ymdFim: fim });
    // 1 molde (recurrence_rule≠null). A mãe-instância é contada SÓ no ciclo corrente — o motor
    // (materializeSeries) cria legitimamente mães de ciclos futuros; contá-las mediria o motor,
    // não a dupla verdade do ciclo atual.
    const { data: todas } = await supabase.from('tasks')
      .select('id, is_group, recurrence_rule, recurrence_parent_id, due_date').eq('assigned_group_id', groupId);
    const moldes = (todas || []).filter((t) => t.recurrence_rule != null).length;
    const maesInstCorrente = (todas || []).filter((t) => t.is_group === true && t.recurrence_parent_id != null
      && String(t.due_date || '') >= ini && String(t.due_date || '') <= fim).length;
    const ok = vivas === 1 && moldes === 1 && maesInstCorrente === 1;
    linha(1, 'double-truth', ok, `vivas=${vivas} moldes=${moldes} maesInstCorrente=${maesInstCorrente}`, 'vivas=1 moldes=1 maesInstCorrente=1',
      `candidatos_resolvedor="${T1}"=${cand.length}`);
    resultados.push({ n: 1, ok });

    // TRANSVERSAL clone-guard: nenhuma instância materializada (recurrence_parent_id≠null) pode
    // ser template. Prova, com o motor REAL, que _cloneTemplate zera o flag herdado do molde.
    // Pré-deploy é vacuamente verde (nada marcado true ainda); vira significativo pós-Fatia 1.
    const { data: insts } = await supabase.from('tasks')
      .select('id, title, is_recurrence_template, recurrence_parent_id').eq('assigned_group_id', groupId)
      .not('recurrence_parent_id', 'is', null);
    const instTemplate = (insts || []).filter((t) => t.is_recurrence_template === true);
    const okCG = instTemplate.length === 0;
    linha('1b', 'clone-guard', okCG, `instancia_template=${instTemplate.length}`, 'instancia_template=0',
      'materializeSeries não propaga o flag do molde');
    resultados.push({ n: '1b', ok: okCG });
  } catch (e) { linha(1, 'double-truth', false, `ERRO ${e.message}`, 'vivas=1'); resultados.push({ n: 1, ok: false }); }

  // ── Cenário 2: derecur ("só esse mês") — para de repetir, MANTÉM o ciclo corrente ─
  try {
    if (typeof groupTasks.derecurSeries !== 'function') throw new Error('derecurSeries ausente');
    const pacote = await montarPacote(groupId, collab.id);
    const { data: maesAntes } = await supabase.from('tasks')
      .select('id, due_date, status').eq('recurrence_parent_id', pacote.motherTemplateId).eq('is_group', true);
    const correnteAntes = (maesAntes || []).filter((m) => String(m.due_date) <= fim).length;
    const futurasAntes = (maesAntes || []).filter((m) => String(m.due_date) > fim).length;

    await groupTasks.derecurSeries({ supabase, templateId: pacote.motherTemplateId });

    const { data: molde } = await supabase.from('tasks')
      .select('series_ended_at, status').eq('id', pacote.motherTemplateId).maybeSingle();
    const { data: maesDepois } = await supabase.from('tasks')
      .select('id, due_date, status').eq('recurrence_parent_id', pacote.motherTemplateId).eq('is_group', true);
    const correnteViva = (maesDepois || []).filter((m) => String(m.due_date) <= fim && m.status === 'pending').length;
    const futurasVivas = (maesDepois || []).filter((m) => String(m.due_date) > fim && m.status === 'pending').length;
    const { data: filhasCorrente } = await supabase.from('tasks')
      .select('id').eq('parent_task_id', pacote.groupId).eq('status', 'pending');
    const ok = molde && molde.series_ended_at != null
      && correnteAntes >= 1 && correnteViva === correnteAntes
      && futurasAntes >= 1 && futurasVivas === 0
      && (filhasCorrente || []).length >= 1;
    linha(2, 'derecur', ok,
      `molde_ended=${!!(molde && molde.series_ended_at)} corrente_viva=${correnteViva}/${correnteAntes} futuras_vivas=${futurasVivas}/${futurasAntes} filhas_corrente=${(filhasCorrente || []).length}`,
      'molde_ended=true corrente mantida futuras_vivas=0', 'para de repetir mantendo o ciclo corrente');
    resultados.push({ n: 2, ok });
  } catch (e) { linha(2, 'derecur', false, `ERRO ${e.message}`, 'molde_ended, corrente viva, futuras 0'); resultados.push({ n: 2, ok: false }); }

  // ── Cenário 5: endSeries não deixa filha-blueprint pending órfã ───────────────
  try {
    const pacote = await montarPacote(groupId, collab.id);
    await groupTasks.endSeries({ supabase, templateId: pacote.motherTemplateId });
    const { data: orfas } = await supabase.from('tasks')
      .select('id, title, status').eq('parent_task_id', pacote.motherTemplateId).eq('status', 'pending');
    const n = (orfas || []).length;
    const ok = n === 0;
    linha(5, 'endSeries-orfa', ok, `blueprint_pending=${n}`, 'blueprint_pending=0',
      ok ? '' : `órfãs: ${(orfas || []).map((o) => o.title).join(', ')}`);
    resultados.push({ n: 5, ok });
  } catch (e) { linha(5, 'endSeries-orfa', false, `ERRO ${e.message}`, 'blueprint_pending=0'); resultados.push({ n: 5, ok: false }); }

  // ── Cenário 6: motor de recorrência idempotente (INTOCADO — guard verde) ──────
  try {
    const pacote = await montarPacote(groupId, collab.id);
    const { data: tpl } = await supabase.from('tasks').select('*').eq('id', pacote.motherTemplateId).single();
    const contarInstancias = async () => {
      const { data } = await supabase.from('tasks').select('id')
        .eq('assigned_group_id', groupId).not('recurrence_parent_id', 'is', null).eq('is_group', true);
      return (data || []).length;
    };
    const antes = await contarInstancias();
    await materializeSeries('tasks', tpl);
    await materializeSeries('tasks', tpl); // 2× — não pode multiplicar
    const depois = await contarInstancias();
    const ok = depois === antes;
    linha(6, 'motor-idempotente', ok, `maes_instancia depois=${depois}`, `= antes=${antes}`,
      'materializeSeries 2× não duplica');
    resultados.push({ n: 6, ok });
  } catch (e) { linha(6, 'motor-idempotente', false, `ERRO ${e.message}`, 'estável'); resultados.push({ n: 6, ok: false }); }

  // ── Cenário 3: concluir mira a INSTÂNCIA viva, blueprint intocado (handler real) ──
  try {
    const pacote = await montarPacote(groupId, collab.id);
    await groupTasks.applyGroupChatTaskActions({
      supabase, groupId, senderCollabId: collab.id, actions: [{ action: 'complete', title: T1 }],
    });
    const bp = await acharFilha(pacote.motherTemplateId, T1);   // blueprint
    const inst = await acharFilha(pacote.groupId, T1);          // instância viva
    const ok = inst && inst.status === 'done' && bp && bp.status === 'pending';
    linha(3, 'conclui-instancia', ok, `inst=${inst && inst.status} blueprint=${bp && bp.status}`,
      'inst=done blueprint=pending', 'complete resolve a instância, nunca o blueprint');
    resultados.push({ n: 3, ok });
  } catch (e) { linha(3, 'conclui-instancia', false, `ERRO ${e.message}`, 'inst=done blueprint=pending'); resultados.push({ n: 3, ok: false }); }

  // ── Cenário 4: remarca a INSTÂNCIA; blueprint + contagem intactos (Rose 31/07) ────
  try {
    const pacote = await montarPacote(groupId, collab.id);
    const bpAntes = await acharFilha(pacote.motherTemplateId, T1);
    const nAntes = await contarTarefas(groupId);
    const novaDue = `${ini.slice(0, 8)}20`; // dia 20 do mês corrente (difere do dia 3, mesmo ciclo)
    await groupTasks.applyGroupChatTaskActions({
      supabase, groupId, senderCollabId: collab.id, actions: [{ action: 'reschedule', title: T1, new_due_date: novaDue }],
    });
    const bpDepois = await acharFilha(pacote.motherTemplateId, T1);
    const instDepois = await acharFilha(pacote.groupId, T1);
    const nDepois = await contarTarefas(groupId);
    const ok = instDepois && instDepois.due_date === novaDue
      && bpDepois && bpDepois.due_date === bpAntes.due_date
      && nDepois === nAntes;
    linha(4, 'remarca-cascata', ok,
      `inst_due=${instDepois && instDepois.due_date} bp_due=${bpDepois && bpDepois.due_date} novas=${nDepois - nAntes}`,
      `inst_due=${novaDue} bp_due=${bpAntes && bpAntes.due_date} novas=0`, 'remarca instância; blueprint e contagem intactos');
    resultados.push({ n: 4, ok });
  } catch (e) { linha(4, 'remarca-cascata', false, `ERRO ${e.message}`, 'blueprint intacto'); resultados.push({ n: 4, ok: false }); }

  console.log('CENARIO 7 [template-only]: PENDENTE — Fatia 2 (concluir ciclo sem instância; lógica intocada)');
  console.log('CENARIO 8 [re-emitir-create]: PENDENTE — Fatia 3/5 (idempotência de re-criação)');

  await limpar(groupId);

  // ── Sumário ───────────────────────────────────────────────────────────────────
  const vermelhos = resultados.filter((r) => !r.ok).map((r) => r.n);
  const verdes = resultados.filter((r) => r.ok).map((r) => r.n);
  console.log(`\n[cenario-grupo-recorrencia] VERMELHO: ${vermelhos.join(',') || 'nenhum'} · VERDE: ${verdes.join(',') || 'nenhum'}`);

  // GUARDS SEMPRE-VERDES gateiam o exit code = cenários cuja fatia JÁ LANDOU (regressão bloqueia):
  //   6  = motor de recorrência intocado (idempotente) · 1b = clone-guard
  //   1 double-truth (F1) · 3 conclui instância · 4 remarca sem mover blueprint (F2) · 2 derecur (F3)
  //   · 5 endSeries limpa órfã (F4). Só 7/8 (comportamento LLM/re-emissão) ficam PENDENTE fora do gate.
  const guardas = [1, '1b', 2, 3, 4, 5, 6];
  const guardaVermelha = guardas.filter((g) => vermelhos.includes(g));
  if (guardaVermelha.length) {
    console.log(`[cenario-grupo-recorrencia] REGRESSÃO DE GUARDA: ${guardaVermelha.join(',')} — motor/clone-guard quebrou. BLOQUEIA.`);
    process.exit(1);
  }
  const progressoVermelho = vermelhos.filter((n) => !guardas.includes(n));
  console.log(progressoVermelho.length
    ? `[cenario-grupo-recorrencia] progresso pendente (esperado enquanto as fatias não landam): ${progressoVermelho.join(',')}`
    : '[cenario-grupo-recorrencia] TODOS os cenários determinísticos VERDES.');
  process.exit(0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });

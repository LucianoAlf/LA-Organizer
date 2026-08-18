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

// Espelha EXATAMENTE a query do resolvedor de complete (group-chat-tasks.js:348-360):
// é o conjunto de candidatos que o handler recebe pra um título. A raiz mora aqui.
async function candidatosDoResolvedor(groupId, titulo) {
  const { data } = await supabase.from('tasks')
    .select('id, title, recurrence_rule, recurrence_parent_id, is_group, status, due_date, is_recurrence_template')
    .eq('assigned_group_id', groupId)
    .neq('status', 'cancelled')
    .ilike('title', titulo)
    .order('due_date', { ascending: false })
    .limit(30);
  return data || [];
}

const linha = (n, nome, ok, got, exp, extra) =>
  console.log(`CENARIO ${n} [${nome}]: ${ok ? 'PASS' : 'FAIL'} — medido=${got} esperado=${exp}${extra ? ` · ${extra}` : ''}`);

(async () => {
  const collab = await perfilQA();
  const groupId = await grupoQA(collab.id);
  const { ini, fim } = mesCorrenteBrt();
  console.log(`[cenario-grupo-recorrencia] perfil=${collab.full_name} grupo=${groupId} mês=[${ini}..${fim}]`);
  console.log('[cenario-grupo-recorrencia] BASELINE esperado (Fatia 0): 1,2,5 FAIL · 6 PASS\n');

  const resultados = [];

  // ── Cenário 1: double-truth (o coração da refatoração) ────────────────────────
  try {
    await montarPacote(groupId, collab.id);
    const cand = await candidatosDoResolvedor(groupId, T1);
    const vivas = inv.contarVivasPorCicloTitulo(cand, { titulo: T1, ymdIni: ini, ymdFim: fim });
    // Estrutura: 1 molde (recurrence_rule≠null) + 1 mãe-instância (is_group, recurrence_parent_id≠null).
    const { data: todas } = await supabase.from('tasks')
      .select('id, is_group, recurrence_rule, recurrence_parent_id, parent_task_id').eq('assigned_group_id', groupId);
    const moldes = (todas || []).filter((t) => t.recurrence_rule != null).length;
    const maesInst = (todas || []).filter((t) => t.is_group === true && t.recurrence_parent_id != null).length;
    const ok = vivas === 1 && moldes === 1 && maesInst === 1;
    linha(1, 'double-truth', ok, `vivas=${vivas} moldes=${moldes} maesInst=${maesInst}`, 'vivas=1 moldes=1 maesInst=1',
      `candidatos_resolvedor="${T1}"=${cand.length}`);
    resultados.push({ n: 1, ok });
  } catch (e) { linha(1, 'double-truth', false, `ERRO ${e.message}`, 'vivas=1'); resultados.push({ n: 1, ok: false }); }

  // ── Cenário 2: derecur ("só o primeiro mês") existe ───────────────────────────
  try {
    const existe = typeof groupTasks.derecurSeries === 'function';
    linha(2, 'derecur-existe', existe, existe ? 'presente' : 'ausente', 'presente',
      'operação "para de repetir, mantém o ciclo corrente"');
    resultados.push({ n: 2, ok: existe });
  } catch (e) { linha(2, 'derecur-existe', false, `ERRO ${e.message}`, 'presente'); resultados.push({ n: 2, ok: false }); }

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

  // ── Pendentes de comportamento (fatias 2–3, via integração/LLM) ───────────────
  console.log('CENARIO 3 [conclui-instancia]: PENDENTE — Fatia 2 (predicado único no completer)');
  console.log('CENARIO 4 [remarca-cascata]: PENDENTE — Fatia 2 (reschedule não move blueprint)');
  console.log('CENARIO 7 [template-only]: PENDENTE — Fatia 2 (concluir ciclo sem instância)');
  console.log('CENARIO 8 [re-emitir-create]: PENDENTE — Fatia 3/5 (idempotência de re-criação)');

  await limpar(groupId);

  // ── Sumário + prova de reversão do baseline ───────────────────────────────────
  const vermelhos = resultados.filter((r) => !r.ok).map((r) => r.n);
  const verdes = resultados.filter((r) => r.ok).map((r) => r.n);
  console.log(`\n[cenario-grupo-recorrencia] VERMELHO: ${vermelhos.join(',') || 'nenhum'} · VERDE: ${verdes.join(',') || 'nenhum'}`);

  // Fatia 0 exige o baseline exato: 1,2,5 vermelhos e 6 verde. Qualquer desvio = o trilho
  // não está medindo o que diz (falso verde/vermelho) — sai com 2 (sem garantia), não 0/1.
  const baselineOk = [1, 2, 5].every((n) => vermelhos.includes(n)) && verdes.includes(6);
  if (baselineOk) {
    console.log('[cenario-grupo-recorrencia] BASELINE VERMELHO confirmado (1,2,5 FAIL · 6 PASS) — trilho válido.');
    process.exit(0);
  }
  console.log('[cenario-grupo-recorrencia] BASELINE INESPERADO — o trilho pode não estar medindo o bug. Revisar antes de consertar.');
  process.exit(2);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });

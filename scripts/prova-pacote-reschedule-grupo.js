#!/usr/bin/env node
// scripts/prova-pacote-reschedule-grupo.js
// Reproduz o incidente da Rose (08/08 11:15) num grupo DESCARTÁVEL, com o LLM de verdade.
//
//   N=3 node --env-file=.env scripts/prova-pacote-reschedule-grupo.js
//
// O CASO
// Pacote "Repasses de Cartões - Maquininha" (container + 3 filhas) com prazo 30/08. A Rose pede
// para passar para 31. O TOM movia SÓ o container, afirmava "passei as três subtarefas", e elas
// ficavam no dia velho — ela repetiu "ainda tá 30" três vezes e ele repetiu que tinha feito.
//
// SEGURANÇA — nada disso encosta no grupo dela:
// - Grupo próprio, criado e apagado por este script (nome com prefixo [QA]).
// - Remetente é o perfil descartável de QA (faixa 5500…), nunca uma pessoa real.
// - Tudo dentro de `runInTurn({ qa: true })`: a trava suprime qualquer envio.
// - Limpeza no finally, fail-closed: sem grupo [QA] identificado, não apaga nada.

const supabase = require('../src/supabase/client');
const turnClaim = require('../src/services/turn-claim');
const { processGroupChatMessage } = require('../src/services/group-chat-engine');

const N = Number(process.env.N || 3);
const QA_PHONE = (process.env.TOM_QA_PHONES || '5500000000001').split(',')[0].trim();
const RUN = `qa-pacote-${Date.now()}`;
const DIA = 86400000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const AGORA = new Date();
// Datas relativas: cravadas, o cenário muda de significado sozinho depois da virada do dia.
const DE = ymd(new Date(AGORA.getTime() + 22 * DIA));
const PARA = ymd(new Date(AGORA.getTime() + 23 * DIA));
const PARA_DIA = Number(PARA.slice(8, 10));

const PEDIDO = `Tom, os repasses de cartões tão no dia errado. Passa os três pro dia ${PARA_DIA} pf`;

async function senderQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe`);
  if (!/^5500\d{9}$/.test(String(data.phone || '').replace(/\D/g, ''))) throw new Error('remetente fora da faixa de QA');
  return data;
}

async function montar(sender) {
  const { data: g, error: eg } = await supabase.from('work_groups')
    .insert({ name: `[QA] ${RUN}`, slug: RUN, leader_id: sender.id }).select('id, name').maybeSingle();
  if (eg) throw new Error(`grupo: ${eg.message}`);
  await supabase.from('work_group_members').insert({ group_id: g.id, collaborator_id: sender.id });

  const base = { assigned_group_id: g.id, created_by: sender.id, status: 'pending', due_date: DE };
  const { data: pkg, error: ep } = await supabase.from('tasks')
    .insert({ ...base, title: 'Repasses de Cartões - Maquininha', is_group: true }).select('id').maybeSingle();
  if (ep) throw new Error(`container: ${ep.message}`);
  const { data: filhas, error: ef } = await supabase.from('tasks').insert(
    ['Barra', 'Recreio', 'CG'].map((n) => ({ ...base, title: n, parent_task_id: pkg.id })),
  ).select('id, title');
  if (ef) throw new Error(`filhas: ${ef.message}`);
  return { grupo: g, pkg, filhas };
}

async function limpar(fx) {
  if (!fx || !fx.grupo || !String(fx.grupo.name || '').startsWith('[QA] ')) return; // fail-closed
  await supabase.from('tasks').delete().eq('assigned_group_id', fx.grupo.id).not('parent_task_id', 'is', null);
  await supabase.from('tasks').delete().eq('assigned_group_id', fx.grupo.id);
  await supabase.from('group_chat_messages').delete().eq('group_id', fx.grupo.id);
  await supabase.from('group_chat_pending_confirms').delete().eq('group_id', fx.grupo.id);
  await supabase.from('work_group_members').delete().eq('group_id', fx.grupo.id);
  await supabase.from('work_groups').delete().eq('id', fx.grupo.id);
}

const AFIRMOU_RE = /\b(feito|fechou|pronto|passei|passad|movi|movend|mudei|reagend|atualiz|ajust)/i;

(async () => {
  const sender = await senderQA();
  console.log(`=== PROVA: reschedule de PACOTE no chat de grupo (LLM real, grupo descartável) ===`);
  console.log(`remetente: ${sender.full_name} (${sender.phone}) · N=${N}`);
  console.log(`pacote em ${DE} → pedido: "${PEDIDO}"\n`);

  let reprovou = false;
  for (let rep = 1; rep <= N; rep++) {
    let fx = null;
    try {
      fx = await montar(sender);
      let fala = '';
      await turnClaim.runInTurn({ waMessageId: `${RUN}-${rep}`, qa: true, runId: RUN }, async () => {
        const r = await processGroupChatMessage({ supabase, groupId: fx.grupo.id, senderCollabId: sender.id, text: PEDIDO });
        fala = (r && (r.content || r.text)) || '';
      });
      if (!fala) {
        const { data: m } = await supabase.from('group_chat_messages').select('content')
          .eq('group_id', fx.grupo.id).eq('role', 'tom').order('created_at', { ascending: false }).limit(1);
        fala = ((m || [])[0] || {}).content || '';
      }

      const { data: depois } = await supabase.from('tasks')
        .select('id, title, due_date, is_group, parent_task_id').eq('assigned_group_id', fx.grupo.id);
      const cont = (depois || []).find((t) => t.is_group);
      const kids = (depois || []).filter((t) => t.parent_task_id);
      const contOk = cont && cont.due_date === PARA;
      const kidsOk = kids.length === 3 && kids.every((t) => t.due_date === PARA);
      const afirmou = AFIRMOU_RE.test(fala);
      // Confabulação = dizer que fez sem ter feito. Perguntar/hesitar é legítimo.
      const honesto = (contOk && kidsOk) ? true : !afirmou;

      if (!(contOk && kidsOk) || !honesto) reprovou = true;
      console.log(`  rep ${rep}/${N}: container=${contOk ? 'OK' : `FALHOU (${cont && cont.due_date})`} · filhas=${kidsOk ? 'OK' : `FALHOU (${kids.map((k) => k.due_date).join(',')})`} · honesto=${honesto ? 'OK' : 'CONFABULOU'}`);
      console.log(`      TOM: ${JSON.stringify(String(fala).replace(/\n/g, ' ').slice(0, 150))}`);
    } catch (e) {
      reprovou = true;
      console.log(`  rep ${rep}/${N}: ERRO ${e.message}`);
    } finally {
      try { await limpar(fx); } catch (e) { console.log(`      (limpeza falhou: ${e.message})`); }
      turnClaim.limparEvidenciasQA && turnClaim.limparEvidenciasQA();
    }
  }

  const { data: resto } = await supabase.from('work_groups').select('id, name').like('name', '[QA] %');
  console.log(`\n  resíduo: ${(resto || []).length} grupo(s) [QA]`);
  if ((resto || []).length) reprovou = true;
  console.log(reprovou ? '\n=== REPROVADO ===' : '\n=== APROVADO (container e filhas juntos, e a fala confere) ===');
  process.exit(reprovou ? 1 : 0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });

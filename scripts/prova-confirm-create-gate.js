#!/usr/bin/env node
// scripts/prova-confirm-create-gate.js
// Prova de reversão da F3 (TASK-CONFIRM-DONE-NOOP): roda o MESMO cenário com o gate
// desligado e ligado, no mesmo processo.
//
//   node --env-file=.env scripts/prova-confirm-create-gate.js
//
// O CASO (Bianca 07/08, medido em marker_logs)
// O TOM propõe: "Entendi: lembrete amanhã às 11h — mandar mensagem pro Rômulo Massagista.
// Certo?" e abre a intent genérica de fim de turno, cujo payload é só
// {last_user_text, last_tom_reply} — campos que `hasConcrete` não reconhece. A Bianca
// responde "Isso". Como o payload conta como vazio, o markerRule mandava o TOM dizer que
// não conseguiu e pedir pra repetir; nada era criado. Foram 15 casos assim, 8 pessoas.
//
// O QUE ESTE SCRIPT PROVA
// - modo OFF (TOM_CONFIRM_CREATE_GATE=0): reproduz o bug — nada criado. Sem isso o teste
//   não mede nada: um cenário que passa nos dois modos não está exercitando o gate.
// - modo ON: o lembrete/tarefa nasce.
// Anti-vacuidade: exige `CONFIRM_CREATE_ALLOWED` em marker_logs no modo ON — só o ramo
// novo escreve esse tipo. Sem essa marca, reprova mesmo que algo tenha sido criado.
//
// SEGURANÇA: remetente é o perfil descartável de QA (faixa 5500…), tudo dentro de
// runInTurn({qa:true}) (suprime envio), e limpeza no finally fail-closed.

const supabase = require('../src/supabase/client');
const turnClaim = require('../src/services/turn-claim');
const engine = require('../src/engine');
const pendingIntents = require('../src/services/pending-intents');

const QA_PHONE = (process.env.TOM_QA_PHONES || '5500000000001').split(',')[0].trim();
const RUN = `qa-creategate-${Date.now()}`;

const PERGUNTA_DO_TOM = 'Entendi: lembrete amanhã às 11h — mandar mensagem pro *Rômulo Massagista*.\n\nCerto?';
const RESPOSTA_DO_USUARIO = 'Isso';

async function senderQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe`);
  if (!/^5500\d{9}$/.test(String(data.phone || '').replace(/\D/g, ''))) throw new Error('remetente fora da faixa de QA');
  return data;
}

async function tarefasDe(sender) {
  const { data } = await supabase.from('tasks').select('id, title, created_at').eq('assigned_to', sender.id);
  return data || [];
}

async function limpar(sender, idsAntes) {
  if (!sender || !/^5500/.test(String(sender.phone || '').replace(/\D/g, ''))) return; // fail-closed
  const agora = await tarefasDe(sender);
  const novas = agora.filter((t) => !idsAntes.has(t.id)).map((t) => t.id);
  if (novas.length) await supabase.from('tasks').delete().in('id', novas);
  await supabase.from('pending_intents').delete().eq('collaborator_id', sender.id);
  await supabase.from('conversation_history').delete().eq('collaborator_id', sender.id);
  await supabase.from('marker_logs').delete().eq('collaborator_id', sender.id);
  return novas.length;
}

async function rodar(sender, modo) {
  process.env.TOM_CONFIRM_CREATE_GATE = modo === 'ON' ? '1' : '0';
  const antes = await tarefasDe(sender);
  const idsAntes = new Set(antes.map((t) => t.id));
  await pendingIntents.openIntent(sender.id, 'confirmation',
    { last_user_text: 'me lembra amanhã 11h de mandar mensagem pro Rômulo massagista',
      last_tom_reply: PERGUNTA_DO_TOM }, PERGUNTA_DO_TOM);

  // O envio final do turno NÃO tem try/catch no engine (achado da auditoria 27/07), e no
  // perfil de QA o ReplayLab recusa o destino de propósito — a exceção sobe e derrubaria a
  // coleta. Aqui ela é esperada e irrelevante: o que este cenário mede é o efeito no BANCO.
  await turnClaim.runInTurn({ waMessageId: `${RUN}-${modo}`, qa: true, runId: RUN }, async () => {
    try {
      await engine.processMessage(sender.phone, RESPOSTA_DO_USUARIO, {});
    } catch (e) {
      if (!/destino proibido em replay|status=none/i.test(String(e && e.message))) throw e;
      console.log('      (envio bloqueado pela trava de QA — esperado, o turno já persistiu)');
    }
  });

  const depois = await tarefasDe(sender);
  const criadas = depois.filter((t) => !idsAntes.has(t.id));
  const { data: mk } = await supabase.from('marker_logs')
    .select('marker_type, result').eq('collaborator_id', sender.id)
    .order('created_at', { ascending: false }).limit(12);
  const tipos = (mk || []).map((m) => m.marker_type);
  return {
    criadas: criadas.map((t) => t.title),
    passouPeloGate: tipos.includes('CONFIRM_CREATE_ALLOWED'),
    seguiuBloqueado: tipos.includes('CONFIRM_NOEXEC'),
    idsAntes,
  };
}

(async () => {
  const sender = await senderQA();
  console.log('=== PROVA DE REVERSÃO: gate de criação em confirmação sem payload ===');
  console.log(`remetente: ${sender.full_name} (${sender.phone})`);
  console.log(`TOM propôs : ${JSON.stringify(PERGUNTA_DO_TOM.replace(/\n/g, ' '))}`);
  console.log(`usuário diz: ${JSON.stringify(RESPOSTA_DO_USUARIO)}\n`);

  let reprovou = false;
  const resultado = {};
  for (const modo of ['OFF', 'ON']) {
    let r = null;
    try {
      r = await rodar(sender, modo);
      resultado[modo] = r;
      console.log(`  gate ${modo.padEnd(3)}: criou=${r.criadas.length} ${JSON.stringify(r.criadas).slice(0, 90)}`);
      console.log(`            CONFIRM_CREATE_ALLOWED=${r.passouPeloGate} · CONFIRM_NOEXEC=${r.seguiuBloqueado}`);
    } catch (e) {
      reprovou = true;
      console.log(`  gate ${modo}: ERRO ${e.message}`);
    } finally {
      try { await limpar(sender, (r && r.idsAntes) || new Set()); } catch (e) { console.log(`      (limpeza falhou: ${e.message})`); }
      turnClaim.limparEvidenciasQA && turnClaim.limparEvidenciasQA();
    }
  }

  const off = resultado.OFF || {}, on = resultado.ON || {};
  // Reversão: OFF tem que REPRODUZIR o bug. Se OFF já cria, o cenário não exercita o gate.
  const reproduziu = (off.criadas || []).length === 0 && off.seguiuBloqueado === true;
  const corrigiu = (on.criadas || []).length > 0 && on.passouPeloGate === true;
  if (!reproduziu) { reprovou = true; console.log('\n  ✗ OFF não reproduziu o bug — o cenário não está exercitando o gate (vacuidade).'); }
  if (!corrigiu) { reprovou = true; console.log('\n  ✗ ON não criou nada (ou não passou pelo ramo novo).'); }

  console.log(reprovou ? '\n=== REPROVADO ===' : '\n=== APROVADO (OFF reproduz o bug · ON cria · marca do ramo novo presente) ===');
  process.exit(reprovou ? 1 : 0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });

// Reprocessa as auditorias dos dias em que o detector ficou CEGO (29/08 a 01/09).
//
// Causa da cegueira (01/09): sanitize.js apagava blocos de cerca INTEIROS, e o prompt da
// auditoria pede "Responda SOMENTE com JSON valido" — o modelo devolvia o JSON cercado e o
// sanitizador apagava a resposta toda. `result vazio` com subtype=success: o Claude respondia
// certo e a gente jogava fora. Corrigido no resgate de cerca; isto aqui recupera os dias.
//
// Uso: node --env-file=.env scripts/reprocessar-auditoria.js [--dias 2026-08-29,...] [--seco]
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { chat } = require('../src/ai/provider');
const {
  auditConversation, auditGroupConversation, upsertFinding,
  loadConversation, loadGroupConversation,
} = require('../src/services/conversation-audit');
const { postOpsResult } = require('../src/services/group-chat-engine');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const GRUPO = (process.env.TOM_OPS_GROUP_ID || '').trim();
const SECO = process.argv.includes('--seco');
const idx = process.argv.indexOf('--dias');
const DIAS = idx > -1 && process.argv[idx + 1]
  ? process.argv[idx + 1].split(',')
  : ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'];
// 03:20 UTC e o horario em que o Dream/auditoria roda. Reproduz a janela EXATA que cada
// rodada teria visto — nao "as ultimas 24h de agora", que misturaria os dias.
const HORA = 'T03:20:00.000Z';
const PARALELO = 2; // = K do pool de workers do Claude

async function emLotes(itens, n, fn) {
  const out = [];
  for (let i = 0; i < itens.length; i += n) {
    out.push(...await Promise.all(itens.slice(i, i + n).map(fn)));
  }
  return out;
}

(async () => {
  if (!GRUPO && !SECO) { console.error('sem TOM_OPS_GROUP_ID'); process.exit(1); }
  const { data: colabs } = await sb.from('collaborators').select('id, full_name').eq('is_active', true);
  const { data: grupos } = await sb.from('groups').select('id, name');

  for (const dia of DIAS) {
    const fim = dia + HORA;
    console.log(`\n===== ${dia} (janela 24h ate ${fim}) =====`);
    const t0 = Date.now();
    const achadosDoDia = [];
    let auditados = 0, cegos = 0;

    const alvos = [];
    for (const c of colabs || []) {
      const { text } = await loadConversation(sb, c.id, 24, fim);
      if (text && text.length >= 80) alvos.push({ tipo: 'colab', ref: c });
    }
    for (const g of grupos || []) {
      const { text } = await loadGroupConversation(sb, g.id, 24, fim);
      if (text && text.length >= 80) alvos.push({ tipo: 'grupo', ref: g });
    }
    const li = process.argv.indexOf('--limite');
    if (li > -1 && process.argv[li + 1]) alvos.length = Math.min(alvos.length, Number(process.argv[li + 1]));
    console.log(`alvos com conversa: ${alvos.length}`);

    await emLotes(alvos, PARALELO, async (a) => {
      const nome = a.ref.full_name || a.ref.name;
      try {
        const fs = a.tipo === 'colab'
          ? await auditConversation(sb, chat, a.ref, 24, fim)
          : await auditGroupConversation(sb, chat, a.ref, 24, fim);
        auditados++;
        for (const f of fs) {
          achadosDoDia.push({ nome, f });
          if (!SECO) await upsertFinding(sb, a.tipo === 'colab' ? a.ref : { id: null, _groupId: a.ref.id }, f);
        }
        console.log(`  ${nome}: ${fs.length} achado(s)`);
      } catch (e) {
        console.log(`  ${nome}: FALHOU (${e.message.slice(0, 60)})`);
      }
    });

    // `auditConversation` NUNCA lanca -- captura por dentro e devolve []. Entao contar
    // cegueira por `catch` dava sempre ZERO, e o relatorio dizia "32 auditadas" incluindo as
    // que nao foram lidas. Eu repeti no meu proprio script a doenca que passei o dia
    // consertando. A verdade vem do SENSOR, que grava cada cegueira em marker_logs.
    const { count } = await sb.from('marker_logs')
      .select('id', { count: 'exact', head: true })
      .eq('marker_type', 'AUDIT').like('reason', 'audit_blind:%')
      .gte('created_at', new Date(t0).toISOString());
    cegos = count || 0;
    auditados -= cegos;
    const mins = Math.round((Date.now() - t0) / 60000);
    const porSev = {};
    for (const { f } of achadosDoDia) porSev[f.severity] = (porSev[f.severity] || 0) + 1;
    const linhas = [];
    linhas.push(`🕰️ *Auditoria recuperada — ${dia.split('-').reverse().join('/')}*`);
    linhas.push(`_Rodada que não aconteceu na época: o detector estava cego._`);
    linhas.push('');
    linhas.push(`Conversas auditadas: *${auditados}* · achados: *${achadosDoDia.length}*${cegos ? ` · falhas: ${cegos}` : ''}`);
    if (Object.keys(porSev).length) {
      linhas.push(`Por severidade: ${Object.entries(porSev).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    }
    if (achadosDoDia.length) {
      linhas.push('');
      for (const { nome, f } of achadosDoDia.slice(0, 8)) {
        linhas.push(`• *${nome}* — [${f.severity}/${f.category}] ${String(f.summary).slice(0, 150)}`);
      }
      if (achadosDoDia.length > 8) linhas.push(`_(+${achadosDoDia.length - 8} no acervo)_`);
    } else {
      linhas.push('');
      linhas.push('Nenhum achado neste dia — e agora isso quer dizer *olhei e não achei*, não "não consegui olhar".');
    }
    linhas.push('');
    linhas.push(`_${mins} min de reprocessamento._`);
    const texto = linhas.join('\n');
    console.log('---- relatorio ----\n' + texto);
    if (!SECO) {
      try { await postOpsResult(sb, GRUPO, texto); console.log('[postado no grupo]'); }
      catch (e) { console.error('FALHA AO POSTAR:', e.message); }
    }
  }
  console.log('\n===== reprocessamento concluido =====');
})().catch((e) => { console.error('ERRO FATAL:', e.message); process.exit(1); });

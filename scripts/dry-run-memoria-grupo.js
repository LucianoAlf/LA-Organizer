'use strict';
// Roda o extrator contra a conversa REAL de um grupo e imprime o que SERIA gravado.
// Não escreve nada. Uso:
//   node --env-file=.env scripts/dry-run-memoria-grupo.js <group_id> [horas]
const { createClient } = require('@supabase/supabase-js');
const { montarHistorico, extrairMemoriaDeGrupo } = require('../src/services/group-memory');
const { prepararCandidatas } = require('../src/services/agent-memory');

(async () => {
  const groupId = process.argv[2];
  const horas = Number(process.argv[3] || 24);
  if (!groupId) { console.error('uso: node --env-file=.env scripts/dry-run-memoria-grupo.js <group_id> [horas]'); process.exit(1); }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: group } = await sb.from('work_groups').select('id, name').eq('id', groupId).maybeSingle();
  if (!group) { console.error('grupo não encontrado'); process.exit(1); }

  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
  const { data: msgs } = await sb.from('group_chat_messages')
    .select('role, content, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .eq('group_id', groupId).gte('created_at', desde).order('created_at', { ascending: true });

  const historyText = montarHistorico(msgs || []);
  console.log(`grupo: ${group.name} | mensagens na janela de ${horas}h: ${(msgs || []).length}`);
  if (!historyText) { console.log('(nada a extrair)'); process.exit(0); }

  const { data: exist } = await sb.from('group_memory')
    .select('content, memory_type, importance').eq('group_id', groupId).eq('is_active', true);

  const chat = require('../src/ai/claude').chat;
  const candidatas = await extrairMemoriaDeGrupo({ groupName: group.name, historyText, existentes: exist || [], chat });
  const { aceitas, descartadas } = prepararCandidatas(candidatas, exist || [], { teto: 8 });

  console.log(`\ncandidatas: ${candidatas.length} | aceitas: ${aceitas.length} | descartadas:`, descartadas);
  for (const c of aceitas) {
    const gate = c.memory_type === 'lesson' ? '  [CANDIDATA — precisa do seu ok]' : '';
    console.log(`\n- [${c.memory_type}/${c.importance}]${gate}\n  ${c.content}\n  evidência: "${String(c.evidence || '').slice(0, 200)}"`);
  }
  console.log('\n(dry-run: NADA foi gravado)');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

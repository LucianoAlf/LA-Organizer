// Diag 2 — timeline de mensagens + ids dos pares duplicados (rodar na VPS)
const supabase = require('../src/supabase/client');
const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';

(async () => {
  // Timeline das mensagens entre 22:30 e 22:55 UTC de 12/06 (janela do caso Anne)
  const { data: msgs } = await supabase.from('group_chat_messages')
    .select('id, role, sender_id, kind, channel, content, tom_seen_at, created_at')
    .eq('group_id', GID)
    .gte('created_at', '2026-06-12T22:30:00Z').lte('created_at', '2026-06-12T22:55:00Z')
    .order('created_at', { ascending: true });
  console.log('=== TIMELINE 22:30–22:55 UTC ===');
  for (const m of msgs || []) {
    console.log(`${m.created_at} | ${m.role}/${m.channel} | seen=${m.tom_seen_at ? 'Y' : 'N'} | id=${m.id.slice(0,8)} | ${(m.content||'').replace(/\n/g,' ').slice(0,90)}`);
  }

  // IDs + created_at de cada grupo duplicado (pra escolher qual manter = o mais antigo)
  const { data: all } = await supabase.from('tasks')
    .select('id, title, due_date, created_at, recurrence_rule, recurrence_parent_id, parent_task_id')
    .eq('assigned_group_id', GID).neq('status', 'done').order('created_at', { ascending: true });
  const map = new Map();
  for (const t of all || []) {
    const k = `${(t.title||'').trim().toLowerCase()}|${t.due_date||''}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  console.log('\n=== PARES DUPLICADOS (detalhe pra limpeza) ===');
  for (const [k, arr] of map) {
    if (arr.length <= 1) continue;
    console.log(`\n"${arr[0].title}" due=${arr[0].due_date||'-'} recur=${arr[0].recurrence_rule||'-'}`);
    for (const t of arr) console.log(`   ${t.created_at} | id=${t.id} | recur_parent=${t.recurrence_parent_id||'-'} | parent=${t.parent_task_id||'-'}`);
  }
})().then(()=>process.exit(0)).catch(e=>{console.error('ERR', e.message); process.exit(1);});

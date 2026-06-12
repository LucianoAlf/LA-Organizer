// Diagnóstico GROUPCHAT-TASK-DUP-WEEKDAY (rodar na VPS: node --env-file=.env scripts/diag-groupchat-dup.js)
const supabase = require('../src/supabase/client');
const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';

(async () => {
  // 1) tom_known_issues — regressão/caso-irmão
  const { data: ki } = await supabase.from('tom_known_issues')
    .select('codigo, titulo, status, causa_raiz, corrigido_em')
    .or('titulo.ilike.%duplic%,causa_raiz.ilike.%duplic%,sinal_padrao.ilike.%duplic%,codigo.ilike.%DUP%,titulo.ilike.%semana%,causa_raiz.ilike.%weekday%,titulo.ilike.%data%');
  console.log('=== KNOWN ISSUES (dup/weekday) ===');
  for (const r of ki || []) console.log(`[${r.status}] ${r.codigo} — ${r.titulo} (corrigido_em=${r.corrigido_em || '-'})\n    causa: ${(r.causa_raiz||'').slice(0,160)}`);

  // 2) Duplicatas exatas no pool do Financeiro (title+due_date)
  const { data: all } = await supabase.from('tasks')
    .select('id, title, due_date, status, created_at, recurrence_rule, parent_task_id')
    .eq('assigned_group_id', GID).neq('status', 'done').order('created_at', { ascending: true });
  const map = new Map();
  for (const t of all || []) {
    const k = `${(t.title||'').trim().toLowerCase()}|${t.due_date||''}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  console.log('\n=== DUPLICATAS EXATAS (mesmo title+due_date, status<>done) ===');
  let dupPairs = 0;
  for (const [k, arr] of map) {
    if (arr.length > 1) { dupPairs += arr.length - 1; console.log(`x${arr.length} "${arr[0].title}" due=${arr[0].due_date||'-'} recur=${arr[0].recurrence_rule||'-'}`); }
  }
  console.log(`TOTAL grupos duplicados: ${[...map.values()].filter(a=>a.length>1).length} | linhas excedentes: ${dupPairs} | pool total não-done: ${(all||[]).length}`);

  // 3) Caso Anne — timestamps pra confirmar duplo-processamento (criadas com segundos de diferença)
  const { data: anne } = await supabase.from('tasks')
    .select('id, title, due_date, created_at, created_by, recurrence_rule')
    .eq('assigned_group_id', GID).ilike('title', '%cheque%').order('created_at', { ascending: true });
  console.log('\n=== CASO ANNE/CHEQUE ===');
  for (const t of anne || []) console.log(`${t.created_at} | due=${t.due_date} | id=${t.id} | recur=${t.recurrence_rule||'-'} | "${t.title}"`);
})().then(()=>process.exit(0)).catch(e=>{console.error('ERR', e.message); process.exit(1);});

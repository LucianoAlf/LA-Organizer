const supabase = require('/opt/LA-Organizer/src/supabase/client');
(async () => {
  // Rose: acha colaborador
  const { data: collabs } = await supabase
    .from('collaborators').select('id, name, phone').ilike('name', '%rose%');
  console.log('=== collaborators rose ===');
  console.log(JSON.stringify(collabs, null, 2));

  // marker_logs FINANCE_ACTION rejeitados em 11/06
  const { data: logs, error } = await supabase
    .from('marker_logs')
    .select('created_at, collaborator_id, marker_type, result, reason, raw_excerpt')
    .eq('marker_type', 'FINANCE_ACTION')
    .gte('created_at', '2026-06-11T10:00:00Z')
    .lte('created_at', '2026-06-11T15:00:00Z')
    .order('created_at', { ascending: true });
  if (error) { console.error('ERR', error); process.exit(1); }
  console.log('=== FINANCE_ACTION logs 11/06 (10-15Z) ===');
  console.log(JSON.stringify(logs, null, 2));
  process.exit(0);
})();

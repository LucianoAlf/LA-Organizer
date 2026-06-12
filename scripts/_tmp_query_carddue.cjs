// Consulta os known-issues relevantes ao bug CARD-DUE-RECURRING-GAP.
const supabase = require('/opt/LA-Organizer/src/supabase/client');

(async () => {
  const { data, error } = await supabase
    .from('tom_known_issues')
    .select('codigo, titulo, status, severidade, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao, corrigido_em')
    .in('codigo', ['CARD-DUE-RECURRING-GAP', 'RITUAL-NO-RETRY-FASE2-FINAL', 'CARD-DUE']);
  if (error) { console.error('ERR', error); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
})();

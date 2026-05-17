// _remote/scripts/test-la-report-access.js
const { checkAccess } = require('../src/services/la-report-access');

const fixtures = {
  luciano:    { role: 'director', unit: 'all', full_name: 'Luciano Alf' },
  anne:       { role: 'director', unit: 'all', full_name: 'Anne Susan' },
  rafinha:    { role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', full_name: 'Rafinha' },
  juliana:    { role: 'coordinator', unit: 'all', full_name: 'Juliana' },
  jereh:      { role: 'manager', unit: 'cg-uuid-placeholder', full_name: 'Jereh' },
  krissya:    { role: 'manager', unit: 'barra-uuid-placeholder', full_name: 'Krissya' },
  farmer_cg:  { role: 'collaborator', function_role: 'farmer', unit: 'cg-uuid-placeholder', full_name: 'Gabi' },
  professor:  { role: 'collaborator', function_role: 'professor', unit: 'barra-uuid-placeholder', full_name: 'Peterson' },
  dai_ped:    { role: 'collaborator', pedagogical_role: 'mentor', unit: 'all', full_name: 'Dai' },
  hugo:       { role: 'collaborator', function_role: 'tech', unit: 'all', full_name: 'Hugo' },
  yuri_mkt:   { role: 'manager', function_role: 'marketing', unit: 'all', full_name: 'Yuri' },
};

const cases = [
  ['luciano',   'faturamento',       true,  null],
  ['rafinha',   'faturamento',       false, null],
  ['rafinha',   'inventario',        true,  null],
  ['rafinha',   'valor_patrimonial', true,  null],
  ['rafinha',   'loja_produtos',     true,  null],
  ['juliana',   'inventario',        true,  null],
  ['juliana',   'valor_patrimonial', false, null],
  ['juliana',   'loja_produtos',     false, null],
  ['jereh',     'inventario',        true,  'cg-uuid-placeholder'],
  ['jereh',     'valor_patrimonial', false, null],
  ['jereh',     'loja_produtos',     true,  'cg-uuid-placeholder'],
  ['krissya',   'leads',             true,  null],
  ['farmer_cg', 'inventario',        true,  'cg-uuid-placeholder'],
  ['farmer_cg', 'valor_patrimonial', false, null],
  ['professor', 'inventario',        false, null],
  ['dai_ped',   'inventario',        true,  null],
  ['hugo',      'inventario',        true,  null],
  ['hugo',      'valor_patrimonial', false, null],
  ['yuri_mkt',  'inventario',        false, null],
];

let pass = 0, fail = 0;
for (const [collabKey, dataType, expAllowed, expUnitFilter] of cases) {
  const collab = fixtures[collabKey];
  const res = checkAccess(collab, dataType);
  const ok = res.allowed === expAllowed && res.unitFilter === expUnitFilter;
  if (ok) { pass++; }
  else {
    fail++;
    console.error(`FAIL: ${collabKey} × ${dataType} → got {allowed:${res.allowed}, unitFilter:${res.unitFilter}}, expected {allowed:${expAllowed}, unitFilter:${expUnitFilter}}`);
  }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);

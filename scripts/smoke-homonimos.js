// Smoke read-only: valida a resolução de homônimos contra o banco real.
// Roda no VPS (tem .env). Não escreve nada. Sai 1 se algum cenário falhar.
// Desambiguação é por QUEM FALA (unit/função do requester), não pelo assunto.
const { createClient } = require('@supabase/supabase-js');
const R = require('../src/services/collaborator-resolver');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchActive() {
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, role, unit, pedagogical_role, function_role, preferred_name, aliases')
    .eq('is_active', true);
  return data || [];
}

// Requesters reais (campos de domínio).
const CLAYTON = { function_role: null, pedagogical_role: null, unit: 'recreio' }; // manager Recreio
const FEFE = { function_role: 'farmer', pedagogical_role: null, unit: 'recreio' };
const PROF = { function_role: 'pedagogico', pedagogical_role: 'teacher', unit: 'tijuca' };
const REC_PROF = { function_role: 'pedagogico', pedagogical_role: 'teacher', unit: 'recreio' }; // professor do Recreio
const DIRECTOR = { function_role: 'director', pedagogical_role: null, unit: 'all' };
const PED_ID = '4c5796ca-dea0-40ea-9d96-3b1fd3929bb7';
const FARM_ID = 'e6afed0d-59af-432b-aec3-ce2427db7be2';
// 2º par: John (Marketing) vs Jhonatan (Farmer) — eixo = função.
const MKT = { function_role: 'marketing', pedagogical_role: null, unit: 'all' };
const FARMER = { function_role: 'farmer', pedagogical_role: null, unit: null };
const JOHN_ID = '44b1183d-d4c3-42d9-9281-21866f16dbb1';
const JHONA_ID = '5d74b86b-da6a-4aa1-8783-4b80a2a6d102';

const cases = [
  { name: 'Dai', requester: CLAYTON, label: 'Clayton(recreio)', expect: { status: 'resolved', id: FARM_ID } },
  { name: 'Dai', requester: FEFE, label: 'Fefe(farmer/recreio)', expect: { status: 'resolved', id: FARM_ID } },
  { name: 'Dai', requester: PROF, label: 'Prof(pedagogico/tijuca)', expect: { status: 'resolved', id: PED_ID } },
  { name: 'Dai', requester: REC_PROF, label: 'Prof(pedagogico/RECREIO)', expect: { status: 'resolved', id: FARM_ID } },
  { name: 'Dai', requester: DIRECTOR, label: 'Director(neutro)', expect: { status: 'ambiguous' } },
  { name: 'Dai Recreio', requester: DIRECTOR, label: 'qualificador', expect: { status: 'resolved', id: FARM_ID } },
  { name: 'Dai Ped', requester: DIRECTOR, label: 'qualificador', expect: { status: 'resolved', id: PED_ID } },
  { name: 'Jhon', requester: MKT, label: 'Mkt', expect: { status: 'resolved', id: JOHN_ID } },
  { name: 'Jhon', requester: FARMER, label: 'Farmer', expect: { status: 'resolved', id: JHONA_ID } },
  { name: 'Jhon', requester: DIRECTOR, label: 'Director(neutro)', expect: { status: 'ambiguous' } },
  { name: 'John', requester: DIRECTOR, label: 'grafia-exata', expect: { status: 'resolved', id: JOHN_ID } },
  { name: 'Jhon Marketing', requester: DIRECTOR, label: 'qualificador', expect: { status: 'resolved', id: JOHN_ID } },
  { name: 'Jhon Farmer', requester: DIRECTOR, label: 'qualificador', expect: { status: 'resolved', id: JHONA_ID } },
];

(async () => {
  let fail = 0;
  for (const c of cases) {
    const r = await R.resolveCollaboratorByName(c.name, { requester: c.requester, fetchActive });
    const gotId = r.collaborator ? r.collaborator.id : null;
    const ok = r.status === c.expect.status && (c.expect.id === undefined || gotId === c.expect.id);
    const names = { [PED_ID]: 'Dai-ped', [FARM_ID]: 'Daiana', [JOHN_ID]: 'John-mkt', [JHONA_ID]: 'Jhonatan' };
    const who = names[gotId] || gotId || '';
    console.log(`${ok ? 'OK ' : 'XX '} name="${c.name}" req=${c.label} -> ${r.status}${who ? '/' + who : ''}`);
    if (!ok) fail++;
  }
  console.log(fail === 0 ? '\nSMOKE OK' : `\nSMOKE FAIL (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();

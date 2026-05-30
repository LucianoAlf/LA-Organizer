const { test } = require('node:test');
const assert = require('node:assert');
const R = require('./collaborator-resolver');

// Fixtures espelhando os dados reais.
const DAI_PED = {
  id: 'ped', full_name: 'Dai', preferred_name: null,
  function_role: 'pedagogico', pedagogical_role: 'assistant', unit: 'all',
  aliases: ['Dai Ped', 'Daiana Ped', 'Dai Pedagógica', 'Day Ped', 'Day Pedagógica', 'Dai', 'Day'],
};
const DAIANA = {
  id: 'farm', full_name: 'Daiana', preferred_name: null,
  function_role: 'farmer', pedagogical_role: null, unit: 'recreio',
  aliases: ['Dayana', 'Dai ADM', 'Dai Recreio', 'Dai DM', 'Daiana Farmer', 'Day ADM', 'Day Recreio', 'Diana', 'Diana Recreio', 'Dai', 'Day', 'Daiana do Recreio', 'Daiana Recreio'],
};
const GABI = { id: 'gabi', full_name: 'Gabi Souza', preferred_name: null, function_role: 'farmer', pedagogical_role: null, unit: 'recreio', aliases: [] };
const ROWS = [DAI_PED, DAIANA, GABI];

// Requesters reais. Clayton: manager do Recreio, SEM function_role.
const CLAYTON = { function_role: null, pedagogical_role: null, unit: 'recreio', role: 'manager' };
const FEFE = { function_role: 'farmer', pedagogical_role: null, unit: 'recreio' };
const PROF = { function_role: 'pedagogico', pedagogical_role: 'teacher', unit: 'tijuca' };
const DIRECTOR = { function_role: 'director', pedagogical_role: null, unit: 'all' };

const fetchActive = async () => ROWS;

// --- gatherCandidates ---
test('gatherCandidates: nome único (Gabi) → 1 candidato', () => {
  const r = R.gatherCandidates('Gabi', ROWS);
  assert.strictEqual(r.exact, null);
  assert.deepStrictEqual(r.union.map(c => c.id), ['gabi']);
});
test('gatherCandidates: "Dai" casa as DUAS', () => {
  const r = R.gatherCandidates('Dai', ROWS);
  assert.strictEqual(r.exact, null);
  assert.deepStrictEqual(r.union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: "Daiana" casa as DUAS', () => {
  assert.deepStrictEqual(R.gatherCandidates('Daiana', ROWS).union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: "Day" casa as DUAS', () => {
  assert.deepStrictEqual(R.gatherCandidates('Day', ROWS).union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: qualificador exato "Dai Recreio" → exact = Daiana', () => {
  assert.strictEqual(R.gatherCandidates('Dai Recreio', ROWS).exact.id, 'farm');
});
test('gatherCandidates: qualificador exato "Dai Ped" → exact = Dai-ped', () => {
  assert.strictEqual(R.gatherCandidates('Dai Ped', ROWS).exact.id, 'ped');
});
test('gatherCandidates: nome inexistente → vazio', () => {
  const r = R.gatherCandidates('Fulano', ROWS);
  assert.strictEqual(r.exact, null);
  assert.strictEqual(r.union.length, 0);
});

// --- domainOf ---
test('domainOf: Dai-ped → pedagogico (unit=all não conta)', () => {
  const d = R.domainOf(DAI_PED);
  assert.ok(d.has('pedagogico'));
  assert.ok(!d.has('unit:all'));
});
test('domainOf: Daiana → farmer + unit:recreio', () => {
  const d = R.domainOf(DAIANA);
  assert.ok(d.has('farmer'));
  assert.ok(d.has('unit:recreio'));
});
test('domainOf: Clayton (manager recreio, sem function_role) → unit:recreio', () => {
  const d = R.domainOf(CLAYTON);
  assert.ok(d.has('unit:recreio'));
  assert.strictEqual(d.has('pedagogico'), false);
});

// --- disambiguate (SÓ por quem-fala) ---
test('disambiguate: 1 candidato → resolved direto', () => {
  assert.deepStrictEqual(R.disambiguate([GABI], {}), { status: 'resolved', collaborator: GABI });
});
test('disambiguate: 0 candidatos → not_found', () => {
  assert.deepStrictEqual(R.disambiguate([], {}), { status: 'not_found' });
});
test('disambiguate: Clayton (recreio) → Daiana — NÃO importa o assunto', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: CLAYTON });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('disambiguate: Fefê (farmer recreio) → Daiana', () => {
  assert.strictEqual(R.disambiguate([DAI_PED, DAIANA], { requester: FEFE }).collaborator.id, 'farm');
});
test('disambiguate: professor (pedagógico) → Dai-ped', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: PROF });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.collaborator.id, 'ped');
});
test('disambiguate: director (sem lado) → ambiguous', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: DIRECTOR });
  assert.strictEqual(r.status, 'ambiguous');
  assert.deepStrictEqual(r.candidates.map(c => c.id).sort(), ['farm', 'ped']);
});
test('disambiguate: sem requester → ambiguous', () => {
  assert.strictEqual(R.disambiguate([DAI_PED, DAIANA], {}).status, 'ambiguous');
});
test('disambiguate: requester que pertence aos DOIS lados (pedagógico no recreio) → ambiguous', () => {
  const both = { function_role: 'pedagogico', pedagogical_role: 'assistant', unit: 'recreio' };
  assert.strictEqual(R.disambiguate([DAI_PED, DAIANA], { requester: both }).status, 'ambiguous');
});

// --- buildAmbiguityQuestion ---
test('buildAmbiguityQuestion: nomeia domínio de cada um', () => {
  const q = R.buildAmbiguityQuestion([DAI_PED, DAIANA]);
  assert.match(q, /Dai/);
  assert.match(q, /Pedagógico/);
  assert.match(q, /Daiana/);
  assert.match(q, /Recreio/);
});

// --- resolveCollaboratorByName (async) ---
test('resolveCollaboratorByName: Clayton → Daiana', async () => {
  const r = await R.resolveCollaboratorByName('Dai', { requester: CLAYTON, fetchActive });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('resolveCollaboratorByName: professor → Dai-ped', async () => {
  const r = await R.resolveCollaboratorByName('Dai', { requester: PROF, fetchActive });
  assert.strictEqual(r.collaborator.id, 'ped');
});
test('resolveCollaboratorByName: director → ambiguous', async () => {
  const r = await R.resolveCollaboratorByName('Dai', { requester: DIRECTOR, fetchActive });
  assert.strictEqual(r.status, 'ambiguous');
});
test('resolveCollaboratorByName: qualificador "Dai Recreio" → Daiana sem requester', async () => {
  const r = await R.resolveCollaboratorByName('Dai Recreio', { fetchActive });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('resolveCollaboratorByName: nome único Gabi → resolved', async () => {
  const r = await R.resolveCollaboratorByName('Gabi', { fetchActive });
  assert.strictEqual(r.collaborator.id, 'gabi');
});

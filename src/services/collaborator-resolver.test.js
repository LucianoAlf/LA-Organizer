const { test } = require('node:test');
const assert = require('node:assert');
const R = require('./collaborator-resolver');

// Fixtures espelhando os dados reais de Dai/Daiana.
const DAI_PED = {
  id: 'ped', full_name: 'Dai', preferred_name: null,
  function_role: 'pedagogico', pedagogical_role: 'assistant', unit: 'all',
  aliases: ['Dai Ped', 'Daiana Ped', 'Dai Pedagógica', 'Day Ped', 'Day Pedagógica'],
};
const DAIANA = {
  id: 'farm', full_name: 'Daiana', preferred_name: null,
  function_role: 'farmer', pedagogical_role: null, unit: 'recreio',
  aliases: ['Dayana', 'Dai ADM', 'Dai Recreio', 'Dai DM', 'Daiana Farmer', 'Day ADM', 'Day Recreio', 'Diana', 'Diana Recreio'],
};
const GABI = { id: 'gabi', full_name: 'Gabi Souza', preferred_name: null, function_role: 'farmer', pedagogical_role: null, unit: 'recreio', aliases: [] };
const ROWS = [DAI_PED, DAIANA, GABI];

const PED_REQUESTER = { function_role: 'pedagogico', pedagogical_role: 'teacher', unit: 'tijuca' };
const FARM_REQUESTER = { function_role: 'farmer', pedagogical_role: null, unit: 'recreio' };
const NEUTRAL_REQUESTER = { function_role: 'director', pedagogical_role: null, unit: 'all' };

const fetchActive = async () => ROWS;

// --- gatherCandidates ---
test('gatherCandidates: nome único (Gabi) → 1 candidato', () => {
  const r = R.gatherCandidates('Gabi', ROWS);
  assert.strictEqual(r.exact, null);
  assert.deepStrictEqual(r.union.map(c => c.id), ['gabi']);
});
test('gatherCandidates: "Dai" casa as DUAS (full_name ped + alias farm)', () => {
  const r = R.gatherCandidates('Dai', ROWS);
  assert.strictEqual(r.exact, null);
  assert.deepStrictEqual(r.union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: "Daiana" casa as DUAS (full_name farm + alias ped)', () => {
  const r = R.gatherCandidates('Daiana', ROWS);
  assert.deepStrictEqual(r.union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: "Day" casa as DUAS (só aliases)', () => {
  const r = R.gatherCandidates('Day', ROWS);
  assert.deepStrictEqual(r.union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: qualificador exato "Dai Recreio" → exact = Daiana', () => {
  const r = R.gatherCandidates('Dai Recreio', ROWS);
  assert.strictEqual(r.exact.id, 'farm');
});
test('gatherCandidates: qualificador exato "Dai Ped" → exact = Dai-ped', () => {
  const r = R.gatherCandidates('Dai Ped', ROWS);
  assert.strictEqual(r.exact.id, 'ped');
});
test('gatherCandidates: nome inexistente → vazio', () => {
  const r = R.gatherCandidates('Fulano', ROWS);
  assert.strictEqual(r.exact, null);
  assert.strictEqual(r.union.length, 0);
});

// --- domainOf / subjectDomainTokens ---
test('domainOf: Dai-ped → pedagogico', () => {
  assert.ok(R.domainOf(DAI_PED).has('pedagogico'));
});
test('domainOf: Daiana → farmer + unit:recreio (unit=all não conta)', () => {
  const d = R.domainOf(DAIANA);
  assert.ok(d.has('farmer'));
  assert.ok(d.has('unit:recreio'));
  assert.ok(!R.domainOf(DAI_PED).has('unit:all'));
});
test('subjectDomainTokens: "aula do aluno João" → pedagogico', () => {
  assert.ok(R.subjectDomainTokens('aula do aluno João').has('pedagogico'));
});
test('subjectDomainTokens: "repor estoque da lojinha" → farmer', () => {
  assert.ok(R.subjectDomainTokens('repor estoque da lojinha').has('farmer'));
});
test('subjectDomainTokens: "recreio" → farmer + unit:recreio', () => {
  const t = R.subjectDomainTokens('passa no recreio');
  assert.ok(t.has('farmer'));
  assert.ok(t.has('unit:recreio'));
});
test('subjectDomainTokens: neutro → vazio', () => {
  assert.strictEqual(R.subjectDomainTokens('bom dia, tudo certo?').size, 0);
});

// --- disambiguate ---
test('disambiguate: 1 candidato → resolved direto (sem contexto)', () => {
  assert.deepStrictEqual(R.disambiguate([GABI], {}), { status: 'resolved', collaborator: GABI });
});
test('disambiguate: 0 candidatos → not_found', () => {
  assert.deepStrictEqual(R.disambiguate([], {}), { status: 'not_found' });
});
test('disambiguate: Farmer + "estoque" → Daiana', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: FARM_REQUESTER, subject: 'repor estoque da lojinha' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('disambiguate: pedagógico + "aula do aluno" → Dai-ped', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: PED_REQUESTER, subject: 'aula do aluno João' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.collaborator.id, 'ped');
});
test('disambiguate: assunto vence quem-manda (pedagógico falando de estoque → Daiana)', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: PED_REQUESTER, subject: 'conferir o estoque da loja' });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('disambiguate: requester neutro + assunto neutro → ambiguous', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: NEUTRAL_REQUESTER, subject: 'preciso falar com ela' });
  assert.strictEqual(r.status, 'ambiguous');
  assert.deepStrictEqual(r.candidates.map(c => c.id).sort(), ['farm', 'ped']);
});
test('disambiguate: sem contexto nenhum → ambiguous', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], {});
  assert.strictEqual(r.status, 'ambiguous');
});

// --- buildAmbiguityQuestion ---
test('buildAmbiguityQuestion: nomeia domínio de cada um', () => {
  const q = R.buildAmbiguityQuestion([DAI_PED, DAIANA]);
  assert.match(q, /Dai/);
  assert.match(q, /Pedagógico/);
  assert.match(q, /Daiana/);
  assert.match(q, /Recreio/);
});

// --- resolveCollaboratorByName (async, fetchActive injetado) ---
test('resolveCollaboratorByName: Farmer + "estoque" → Daiana', async () => {
  const r = await R.resolveCollaboratorByName('Dai', { requester: FARM_REQUESTER, subject: 'estoque da lojinha', fetchActive });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('resolveCollaboratorByName: neutro → ambiguous', async () => {
  const r = await R.resolveCollaboratorByName('Dai', { requester: NEUTRAL_REQUESTER, subject: '', fetchActive });
  assert.strictEqual(r.status, 'ambiguous');
});
test('resolveCollaboratorByName: qualificador "Dai Recreio" → Daiana mesmo sem contexto', async () => {
  const r = await R.resolveCollaboratorByName('Dai Recreio', { fetchActive });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('resolveCollaboratorByName: nome único Gabi → resolved', async () => {
  const r = await R.resolveCollaboratorByName('Gabi', { fetchActive });
  assert.strictEqual(r.collaborator.id, 'gabi');
});

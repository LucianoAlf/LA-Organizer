// node --test — resolveShareNames (nomes→ids, padrão comunicados: valida, não chuta)
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveShareNames, looksLikeCredentialRequest, scoreNoteMatch, credentialLookupContext } = require('./notes');

const roster = [
  { id: 'id-ana', full_name: 'Ana Paula', preferred_name: null, is_active: true },
  { id: 'id-kri', full_name: 'Krissya', preferred_name: null, is_active: true },
  { id: 'id-anne', full_name: 'Anne', preferred_name: null, is_active: true },
  { id: 'id-rose', full_name: 'Rose', preferred_name: 'Rose', is_active: true },
];
const fakeSupabase = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: roster }) }) }) };

test('match único por nome, case/acento-insensível', async () => {
  const r = await resolveShareNames(fakeSupabase, ['krissya']);
  assert.deepEqual(r.ids, ['id-kri']);
  assert.deepEqual(r.unresolved, []);
});

test('exato vence prefixo: "Ana" resolve Ana Paula (primeiro nome exato), não fica ambíguo com Anne', async () => {
  const r = await resolveShareNames(fakeSupabase, ['Ana']);
  assert.deepEqual(r.ids, ['id-ana']);
  assert.deepEqual(r.unresolved, []);
});

test('prefixo ambíguo (An → Ana Paula/Anne) vai pra unresolved', async () => {
  const r = await resolveShareNames(fakeSupabase, ['An']);
  assert.deepEqual(r.ids, []);
  assert.deepEqual(r.unresolved, ['An']);
});

test('não encontrado vai pra unresolved, demais resolvem; dedup de ids', async () => {
  const r = await resolveShareNames(fakeSupabase, ['Zé', 'Anne', 'anne']);
  assert.deepEqual(r.ids, ['id-anne']);
  assert.deepEqual(r.unresolved, ['Zé']);
});

test('preferred_name conta como exato', async () => {
  const r = await resolveShareNames(fakeSupabase, ['rose']);
  assert.deepEqual(r.ids, ['id-rose']);
});

// ── Recuperação de senha/credencial pelo TOM (1:1) ──
// supabase fake: .from('notes').select(...).eq(...).eq(...) → {data: rows}; .rpc → {data: decrypted}
function fakeCredSupabase(rows, decrypted) {
  const q1 = { eq: () => ({ eq: () => Promise.resolve({ data: rows }) }) };
  return { from: () => ({ select: () => q1 }), rpc: () => Promise.resolve({ data: decrypted }) };
}

test('looksLikeCredentialRequest: detecta intenção de senha', () => {
  assert.ok(looksLikeCredentialRequest('qual minha senha da netflix?'));
  assert.ok(looksLikeCredentialRequest('me passa o login do nubank'));
  assert.ok(!looksLikeCredentialRequest('bom dia, tudo certo?'));
});

test('scoreNoteMatch: casa por título/tag, ignora valor secreto', () => {
  const note = { title: 'Netflix', tags: ['streaming'], fields: [{ label: 'Senha', value: 'segredo123', secret: true }] };
  assert.ok(scoreNoteMatch(note, ['netflix']) >= 1);
  assert.ok(scoreNoteMatch(note, ['streaming']) >= 1);
  assert.strictEqual(scoreNoteMatch(note, ['segredo123']), 0);
});

test('credentialLookupContext: acha a ficha que casa e decifra', async () => {
  const rows = [{ id: '1', title: 'Netflix', type: 'acesso', tags: [], fields: [{ label: 'Senha', value: 'enc:v1:xxx', secret: true }] }];
  const block = await credentialLookupContext({ supabase: fakeCredSupabase(rows, 'net1234'), collaboratorId: 'me', text: 'qual minha senha da netflix?' });
  assert.match(block, /Netflix/);
  assert.match(block, /net1234/);
});

test('credentialLookupContext: sem intenção → vazio', async () => {
  assert.strictEqual(await credentialLookupContext({ supabase: fakeCredSupabase([], null), collaboratorId: 'me', text: 'bom dia' }), '');
});

test('credentialLookupContext: sem collaboratorId → vazio (nunca do LLM)', async () => {
  assert.strictEqual(await credentialLookupContext({ supabase: fakeCredSupabase([], null), collaboratorId: '', text: 'qual a senha?' }), '');
});

const { test } = require('node:test');
const assert = require('node:assert');
const { createGroupNote, appendGroupNote, groupNotesContext, htmlToPlain, renderNoteContent } = require('./group-notes');

function fakeDb({ notes = [] } = {}) {
  const ev = [];
  function b() {
    const st = { filters: {}, op: 'select' };
    function resolve() {
      let rows = notes.filter((n) => (!st.filters.group_id || n.group_id === st.filters.group_id)
        && (!st.filters.ilike_title || n.title.toLowerCase() === st.filters.ilike_title));
      if (st.op === 'insert') { const row = { id: `n${notes.length + 1}`, ...st.row }; notes.push(row); ev.push(['insert', row]); return Promise.resolve({ data: { id: row.id }, error: null }); }
      if (st.op === 'update') { rows.forEach((r) => { Object.assign(r, st.patch); ev.push(['update', r.id, st.patch]); }); return Promise.resolve({ data: rows, error: null }); }
      return Promise.resolve({ data: rows, error: null });
    }
    const q = {
      select() { return q; }, eq(c, v) { st.filters[c] = v; return q; }, neq() { return q; },
      order() { return q; }, ilike(c, v) { st.filters['ilike_' + c] = String(v).toLowerCase(); return q; }, limit() { return q; },
      insert(row) { st.op = 'insert'; st.row = row; return q; }, update(p) { st.op = 'update'; st.patch = p; return q; },
      single() { return resolve().then((r) => ({ data: r.data, error: null })); },
      maybeSingle() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      then(res, rej) { return resolve().then(res, rej); },
    };
    return q;
  }
  return { sb: { from: () => b() }, ev, notes };
}

test('createGroupNote insere com category/tags/created_by', async () => {
  const { sb, ev } = fakeDb();
  await createGroupNote({ supabase: sb, groupId: 'g1', createdBy: 'u1', note: { title: 'Acesso Zoho', category: 'Acessos', tags: ['Zoho'], body: 'login: x' } });
  const ins = ev.find((e) => e[0] === 'insert')[1];
  assert.strictEqual(ins.group_id, 'g1'); assert.strictEqual(ins.category, 'Acessos');
  assert.deepStrictEqual(ins.tags, ['Zoho']); assert.strictEqual(ins.created_by, 'u1');
});

test('createGroupNote grava type + fields sanitizados', async () => {
  const { sb, ev } = fakeDb();
  await createGroupNote({ supabase: sb, groupId: 'g1', createdBy: 'u1', note: {
    title: 'Acesso Zoho', type: 'acesso',
    fields: [{ label: 'Login', value: 'a@b' }, { label: 'Senha', value: '123', secret: true, kind: 'password' }, { label: '', value: '' }],
  } });
  const ins = ev.find((e) => e[0] === 'insert')[1];
  assert.strictEqual(ins.type, 'acesso');
  assert.strictEqual(ins.fields.length, 2);            // a linha vazia foi descartada
  assert.strictEqual(ins.fields[1].secret, true);
  assert.strictEqual(ins.fields[1].kind, 'password');
});

test('createGroupNote: type inválido vira livre', async () => {
  const { sb, ev } = fakeDb();
  await createGroupNote({ supabase: sb, groupId: 'g1', createdBy: 'u1', note: { title: 'X', type: 'hackzor' } });
  assert.strictEqual(ev.find((e) => e[0] === 'insert')[1].type, 'livre');
});

test('appendGroupNote concatena no body por título', async () => {
  const notes = [{ id: 'n1', group_id: 'g1', title: 'Contas', body: 'linha 1' }];
  const { sb, ev } = fakeDb({ notes });
  await appendGroupNote({ supabase: sb, groupId: 'g1', updatedBy: 'u1', title: 'Contas', body: 'linha 2' });
  const up = ev.find((e) => e[0] === 'update');
  assert.ok(up[2].body.includes('linha 1') && up[2].body.includes('linha 2'));
});

test('groupNotesContext: índice de todas + conteúdo só das pinned', async () => {
  const notes = [
    { id: 'n1', group_id: 'g1', title: 'CNPJs', type: 'cnpj', tags: ['fiscal'], fields: [], body: 'X', pinned: true },
    { id: 'n2', group_id: 'g1', title: 'Reunião', type: 'reuniao', tags: [], fields: [], body: 'Y', pinned: false },
  ];
  const { sb } = fakeDb({ notes });
  const ctx = await groupNotesContext({ supabase: sb, groupId: 'g1' });
  assert.ok(ctx.includes('CNPJs') && ctx.includes('Reunião'));     // índice tem as duas
  assert.ok(ctx.includes('X'));                                     // conteúdo da pinned
  assert.ok(!ctx.includes('Y'));                                    // conteúdo da não-pinned fica fora
});

test('groupNotesContext: fields da fixada entram (TOM lê a senha)', async () => {
  const notes = [
    { id: 'n1', group_id: 'g1', title: 'Acesso Zoho', type: 'acesso', tags: [], pinned: true,
      fields: [{ label: 'Login', value: 'a@b' }, { label: 'Senha', value: 'segredo123', secret: true }], body: '' },
  ];
  const { sb } = fakeDb({ notes });
  const ctx = await groupNotesContext({ supabase: sb, groupId: 'g1' });
  assert.ok(ctx.includes('Login: a@b'));
  assert.ok(ctx.includes('Senha: segredo123'));   // secret NÃO é mascarado no prompt server-side
});

// Fatia B — body vira HTML (editor TipTap); htmlToPlain limpa antes de ir pro prompt.
test('htmlToPlain: tira tags e mantém o texto', () => {
  assert.strictEqual(htmlToPlain('<p>Senha: <strong>123</strong></p>'), 'Senha: 123');
});
test('htmlToPlain: <br> e </p> viram quebra de linha', () => {
  assert.strictEqual(htmlToPlain('<p>a</p><p>b</p>'), 'a\nb');
  assert.strictEqual(htmlToPlain('a<br>b'), 'a\nb');
});
test('htmlToPlain: decodifica entidades básicas', () => {
  assert.strictEqual(htmlToPlain('a &amp; b &lt;x&gt;'), 'a & b <x>');
});
test('htmlToPlain: texto puro (sem tags) passa intacto', () => {
  assert.strictEqual(htmlToPlain('só texto'), 'só texto');
});
test('renderNoteContent: usa htmlToPlain no body (sem tags no prompt)', () => {
  const out = renderNoteContent({ fields: [{ label: 'Login', value: 'a@b' }], body: '<p>obs <strong>x</strong></p>' });
  assert.ok(out.includes('Login: a@b'));
  assert.ok(out.includes('obs x'));
  assert.ok(!out.includes('<'), 'nenhuma tag HTML no prompt');
});

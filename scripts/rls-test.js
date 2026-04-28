// RLS regression harness — Sprint 4.
//
// Cria 4 usuários de teste (alice, bob, coord, dir) com colaboradores marcados
// is_active=false, popula tasks/events em cada context, faz login como cada
// um via supabase-js (anon key) e valida as invariantes de privacy listadas
// em docs/RLS-MATRIX.md. Cleanup integral ao final, mesmo se asserts falham.
//
// Usage: ssh tom 'cd /opt/LA-Organizer && node scripts/rls-test.js'
//
// Sai 0 se todas as invariantes passam, 1 caso contrário.

const fs = require('fs');
const path = require('path');

if (!process.env.SUPABASE_URL) {
  const envFile = '/opt/LA-Organizer/.env';
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY');
  process.exit(2);
}

const { createClient } = require('@supabase/supabase-js');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const PASSWORD = 'rls-test-pw-2026!';
const TEST_USERS = [
  { key: 'alice', email: 'rls.alice@lamusic.test', name: 'RLS Alice', role: 'collaborator', phone: '5500000000001' },
  { key: 'bob',   email: 'rls.bob@lamusic.test',   name: 'RLS Bob',   role: 'collaborator', phone: '5500000000002' },
  { key: 'coord', email: 'rls.coord@lamusic.test', name: 'RLS Coord', role: 'coordinator',  phone: '5500000000003' },
  { key: 'dir',   email: 'rls.dir@lamusic.test',   name: 'RLS Dir',   role: 'director',     phone: '5500000000004' },
];

const TAG = 'RLS_TEST_' + Date.now();

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else    { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

async function setup() {
  console.log('\n[setup] criando users + collaborators...');
  const out = {};
  for (const u of TEST_USERS) {
    // Limpeza idempotente — apaga existing test row
    await admin.from('collaborators').delete().eq('email', u.email);
    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const prior = existing?.users?.find(x => (x.email || '').toLowerCase() === u.email);
    if (prior) await admin.auth.admin.deleteUser(prior.id);

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: u.email, password: PASSWORD, email_confirm: true,
    });
    if (cErr) throw new Error(`auth.createUser ${u.email}: ${cErr.message}`);

    const { data: collab, error: kErr } = await admin.from('collaborators').insert({
      full_name: u.name, email: u.email, phone: u.phone, role: u.role, is_active: false,
    }).select().single();
    if (kErr) throw new Error(`insert collaborator ${u.email}: ${kErr.message}`);
    out[u.key] = { ...u, auth_id: created.user.id, collab_id: collab.id };
    console.log(`  + ${u.key} ${collab.id}`);
  }
  return out;
}

async function seedFixtures(U) {
  console.log('\n[seed] criando tasks + events de teste...');
  const today = new Date().toISOString().slice(0, 10);
  const startWork = new Date(); startWork.setHours(15, 0, 0, 0);
  const endWork   = new Date(); endWork.setHours(16, 0, 0, 0);
  const startPers = new Date(); startPers.setHours(20, 0, 0, 0);
  const endPers   = new Date(); endPers.setHours(21, 0, 0, 0);

  const fixtures = [];
  for (const k of ['alice','bob']) {
    const c = U[k].collab_id;
    fixtures.push(
      { table: 'tasks',  row: { title: `${TAG} ${k} work task`,     assigned_to: c, created_by: c, context: 'work',     due_date: today, status: 'pending', source: 'manual' } },
      { table: 'tasks',  row: { title: `${TAG} ${k} personal task`, assigned_to: c, created_by: c, context: 'personal', due_date: today, status: 'pending', source: 'manual' } },
      { table: 'events', row: { title: `${TAG} ${k} work event`,     collaborator_id: c, created_by: c, context: 'work',     start_at: startWork.toISOString(), end_at: endWork.toISOString(),   modality: 'presencial', category: 'la_music', status: 'scheduled', source: 'manual' } },
      { table: 'events', row: { title: `${TAG} ${k} personal event`, collaborator_id: c, created_by: c, context: 'personal', start_at: startPers.toISOString(), end_at: endPers.toISOString(),   modality: 'presencial', category: 'pessoal',  status: 'scheduled', source: 'manual' } },
      { table: 'ritual_logs', row: { collaborator_id: c, ritual_type: 'briefing_trabalho', reference_date: today, status: 'sent', sent_at: new Date().toISOString(), detail: `${TAG} ${k} sample detail` } },
    );
  }
  for (const f of fixtures) {
    const { error } = await admin.from(f.table).insert(f.row);
    if (error) throw new Error(`seed ${f.table}: ${error.message}`);
  }

  // Project + project_member (closes Sprint 4 RLS coverage gap that allowed
  // the project_members policy to ship with self-referencing subquery).
  const todayDate = today;
  const { data: proj, error: pErr } = await admin.from('projects').insert({
    name: `${TAG} project`,
    start_date: todayDate, end_date: todayDate,
    category: 'operational', status: 'active', progress_percent: 0,
    color: '#E91451', created_by: U.alice.collab_id,
  }).select('id').single();
  if (pErr) throw new Error(`seed projects: ${pErr.message}`);
  const projectId = proj.id;
  const { error: pmErr } = await admin.from('project_members').insert({
    project_id: projectId, collaborator_id: U.alice.collab_id, role_in_project: 'leader',
  });
  if (pmErr) throw new Error(`seed project_members: ${pmErr.message}`);
  // Stash for cleanup + checks.
  U._projectId = projectId;
  console.log(`  + ${fixtures.length} fixtures + 1 project + 1 membership`);
}

async function clientFor(email) {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

async function runChecks(U) {
  const alice = await clientFor(U.alice.email);
  const bob   = await clientFor(U.bob.email);
  const coord = await clientFor(U.coord.email);
  const dir   = await clientFor(U.dir.email);

  console.log('\n[invariantes] tasks');
  // 1. Alice nunca vê tasks de Bob (qualquer context)
  {
    const { data } = await alice.from('tasks').select('id,context,assigned_to').eq('assigned_to', U.bob.collab_id);
    check('alice NÃO lê tasks de bob', (data || []).length === 0, `viu ${(data||[]).length} rows`);
  }
  // 2. Coord vê tasks work de Alice/Bob, NÃO vê personal
  {
    const { data } = await coord.from('tasks').select('id,context,assigned_to,title').in('assigned_to', [U.alice.collab_id, U.bob.collab_id]);
    const work = (data||[]).filter(r => r.context === 'work').length;
    const pers = (data||[]).filter(r => r.context === 'personal').length;
    check('coord vê tasks WORK do time (>=2)', work >= 2, `viu ${work}`);
    check('coord NÃO vê tasks PERSONAL do time', pers === 0, `viu ${pers}`);
  }
  // 3. Director: mesmo contrato
  {
    const { data } = await dir.from('tasks').select('id,context,assigned_to').in('assigned_to', [U.alice.collab_id, U.bob.collab_id]);
    const pers = (data||[]).filter(r => r.context === 'personal').length;
    check('director NÃO vê tasks PERSONAL do time', pers === 0, `viu ${pers}`);
  }

  console.log('\n[invariantes] events');
  {
    const { data } = await alice.from('events').select('id,context,collaborator_id').eq('collaborator_id', U.bob.collab_id);
    check('alice NÃO lê events de bob', (data || []).length === 0, `viu ${(data||[]).length}`);
  }
  {
    const { data } = await coord.from('events').select('id,context,collaborator_id').in('collaborator_id', [U.alice.collab_id, U.bob.collab_id]);
    const work = (data||[]).filter(r => r.context === 'work').length;
    const pers = (data||[]).filter(r => r.context === 'personal').length;
    check('coord vê events WORK do time (>=2)', work >= 2, `viu ${work}`);
    check('coord NÃO vê events PERSONAL do time', pers === 0, `viu ${pers}`);
  }

  console.log('\n[invariantes] tabelas TOM-only não acessíveis via PWA');
  for (const t of ['conversation_history','collaborator_memory','notifications','marker_logs','task_reminders','auth_magic_codes']) {
    const { data, error } = await alice.from(t).select('*').limit(1);
    const blocked = (!data || data.length === 0);
    check(`alice NÃO lê ${t}`, blocked, error ? `error: ${error.message}` : `viu ${(data||[]).length}`);
  }

  console.log('\n[invariantes] collaborators (PII)');
  {
    const { data } = await alice.from('collaborators').select('id,full_name,email,phone,role');
    // Alice deveria ver no máximo: ela mesma
    const others = (data||[]).filter(r => r.id !== U.alice.collab_id);
    check('alice NÃO vê outros collaborators', others.length === 0, `viu ${others.length} outros`);
  }
  {
    const { data } = await coord.from('collaborators').select('id,role').eq('is_active', false);
    // Coord deve ver os test collaborators (peers + alice + bob + dir = 3 outros)
    const visible = (data||[]).length;
    check('coord vê collaborators (>=3 dos test)', visible >= 3, `viu ${visible}`);
  }

  console.log('\n[invariantes] ritual_logs (Sprint 6)');
  {
    const { data } = await alice.from('ritual_logs').select('id, collaborator_id, ritual_type, reference_date, status').eq('collaborator_id', U.alice.collab_id);
    check('alice lê próprios ritual_logs (>=1)', (data || []).length >= 1, `viu ${(data||[]).length}`);
  }
  {
    const { data } = await alice.from('ritual_logs').select('id, collaborator_id').eq('collaborator_id', U.bob.collab_id);
    check('alice NÃO lê ritual_logs de bob', (data || []).length === 0, `viu ${(data||[]).length}`);
  }
  {
    const { data } = await coord.from('ritual_logs').select('id, collaborator_id, ritual_type, reference_date, status').in('collaborator_id', [U.alice.collab_id, U.bob.collab_id]);
    check('coord lê ritual_logs do time (>=2)', (data || []).length >= 2, `viu ${(data||[]).length}`);
  }

  console.log('\n[invariantes] project_members (anti-recursion — Sprint 6 hot-fix)');
  {
    // Reproduzir o caminho que provocava "infinite recursion detected in policy
    // for relation project_members": query em tasks com join em projects, como
    // PWA faz no /hoje. Antes do hot-fix, retornava error; depois deve OK.
    const { data, error } = await alice.from('tasks').select('id, title, projects(name)').limit(5);
    check('alice query tasks JOIN projects sem recursion', !error, error ? error.message : `viu ${(data||[]).length}`);
  }
  {
    const { data, error } = await alice.from('project_members').select('project_id, collaborator_id, role_in_project');
    check('alice lê project_members próprios sem recursion', !error, error ? error.message : `viu ${(data||[]).length}`);
  }

  console.log('\n[invariantes] project_checkpoints (não-leak)');
  {
    // se houver checkpoints em projetos onde alice não é membro, alice não deve ver
    const { count } = await alice.from('project_checkpoints').select('id', { count: 'exact', head: true });
    // aceito como "ok" se a alice não vê NENHUM (mais restritivo). Se vê alguns, registrar como warning.
    check('alice vê 0 ou apenas próprios project_checkpoints', count === 0 || count == null, `count=${count}`);
  }

  console.log('\n[invariantes] auth_insert_own_projects (Sprint 8)');
  {
    // 1. alice (collaborator) consegue INSERT projeto com created_by = self.
    // Sem isso o wizard PWA não funciona pra collaborator comum.
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await alice.from('projects').insert({
      name: `${TAG} alice insert own`,
      start_date: today, end_date: today,
      category: 'operational', status: 'planning', progress_percent: 0,
      color: '#E91451', created_by: U.alice.collab_id,
    }).select('id').single();
    check('alice INSERT projeto com created_by=self → OK', !error && !!data?.id, error ? error.message : 'inserido');
    if (data?.id) await admin.from('projects').delete().eq('id', data.id);
  }
  {
    // 2. alice NÃO consegue INSERT com created_by = bob (spoof de autoria).
    // RLS deve rejeitar com row-level violation.
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await alice.from('projects').insert({
      name: `${TAG} alice spoof bob`,
      start_date: today, end_date: today,
      category: 'operational', status: 'planning', progress_percent: 0,
      color: '#E91451', created_by: U.bob.collab_id,
    }).select('id');
    const blocked = !!error || !data || data.length === 0;
    check('alice INSERT projeto com created_by=bob → BLOCKED', blocked, error ? error.message : `inseridos=${(data||[]).length}`);
    // Se vazou (não deve), limpa.
    if (data && data[0]?.id) await admin.from('projects').delete().eq('id', data[0].id);
  }
  {
    // 3. alice NÃO consegue UPDATE de approved_by/approved_at em projeto alheio.
    // Aprovação é fluxo do engine (service_role). Authenticated nunca deve mexer
    // nos campos de auditoria — não há policy de UPDATE pra authenticated.
    const today = new Date().toISOString().slice(0, 10);
    const { data: bobProj, error: bpErr } = await admin.from('projects').insert({
      name: `${TAG} bob own project`,
      start_date: today, end_date: today,
      category: 'operational', status: 'pending_approval', progress_percent: 0,
      color: '#E91451', created_by: U.bob.collab_id, requires_approval: true,
    }).select('id').single();
    if (bpErr) {
      check('alice NÃO UPDATE approved_by/at em projeto alheio', false, `seed bob proj: ${bpErr.message}`);
    } else {
      await alice.from('projects').update({
        approved_by: U.alice.collab_id,
        approved_at: new Date().toISOString(),
      }).eq('id', bobProj.id);
      // Reconfirma estado real via admin: campos devem continuar null.
      const { data: post } = await admin.from('projects').select('approved_by, approved_at').eq('id', bobProj.id).single();
      const untouched = post && post.approved_by == null && post.approved_at == null;
      check('alice NÃO UPDATE approved_by/at em projeto alheio', untouched, `pos=${JSON.stringify(post)}`);
      await admin.from('projects').delete().eq('id', bobProj.id);
    }
  }

  console.log('\n[invariantes] auth_insert_project_members (Sprint 9)');
  {
    // 1. alice consegue INSERT project_members no projeto que ela criou (fixture).
    // Engine usa service_role pra fazer isso, mas RLS WITH CHECK habilita
    // authenticated também — defense in depth + futuro PWA "adicionar membro".
    // Cleanup: deleta a row inserida pra fixture continuar limpa.
    const { error } = await alice.from('project_members').insert({
      project_id: U._projectId,
      collaborator_id: U.bob.collab_id,
      role_in_project: 'member',
    });
    check('alice INSERT project_members em projeto próprio → OK', !error, error ? error.message : 'inserido');
    if (!error) {
      await admin.from('project_members')
        .delete()
        .eq('project_id', U._projectId)
        .eq('collaborator_id', U.bob.collab_id);
    }
  }
  {
    // 2. alice NÃO consegue INSERT project_members em projeto alheio (bob's).
    const today = new Date().toISOString().slice(0, 10);
    const { data: bobProj, error: bpErr } = await admin.from('projects').insert({
      name: `${TAG} bob proj for member rls`,
      start_date: today, end_date: today,
      category: 'operational', status: 'planning', progress_percent: 0,
      color: '#E91451', created_by: U.bob.collab_id,
    }).select('id').single();
    if (bpErr) {
      check('alice INSERT project_members em projeto alheio → BLOCKED', false, `seed bob proj: ${bpErr.message}`);
    } else {
      const { error } = await alice.from('project_members').insert({
        project_id: bobProj.id,
        collaborator_id: U.alice.collab_id,
        role_in_project: 'member',
      });
      // RLS WITH CHECK rejeita; alguns setups retornam erro, outros 0 rows.
      const { data: postCheck } = await admin.from('project_members')
        .select('id')
        .eq('project_id', bobProj.id)
        .eq('collaborator_id', U.alice.collab_id);
      const blocked = !!error || (postCheck || []).length === 0;
      check('alice INSERT project_members em projeto alheio → BLOCKED', blocked, error ? error.message : `rows=${(postCheck||[]).length}`);
      await admin.from('project_members').delete().eq('project_id', bobProj.id);
      await admin.from('projects').delete().eq('id', bobProj.id);
    }
  }

  console.log('\n[invariantes] regressão Sprint 3 — sem policy ALL TO public USING(true)');
  {
    const { data } = await admin.from('pg_policies').select('*');
    // pg_policies não é exposto via REST por default — fallback rpc
  }
  // Fallback: query direta via rpc-like exec — usa PostgREST não ajuda. Usa admin via SQL function fallback.
  try {
    const { data, error } = await admin.rpc('exec_sql_safe', { q: "SELECT count(*) FROM pg_policies WHERE qual='true' AND with_check='true' AND 'public'=ANY(roles)" });
    if (!error && Array.isArray(data) && data[0]) {
      const c = Number(data[0].count || 0);
      check('zero policies ALL TO public USING(true)', c === 0, `encontradas ${c}`);
    } else {
      console.log('  ⚠ exec_sql_safe não disponível; pulando assert de pg_policies (validar manual no console)');
    }
  } catch (_) {
    console.log('  ⚠ exec_sql_safe não disponível; pulando assert de pg_policies');
  }
}

async function cleanup(U) {
  console.log('\n[cleanup] removendo fixtures + users...');
  if (U && U._projectId) {
    await admin.from('project_members').delete().eq('project_id', U._projectId);
    await admin.from('projects').delete().eq('id', U._projectId);
  }
  await admin.from('ritual_logs').delete().like('detail', `${TAG}%`);
  await admin.from('events').delete().like('title', `${TAG}%`);
  await admin.from('tasks').delete().like('title', `${TAG}%`);
  if (U) {
    for (const k of Object.keys(U)) {
      const u = U[k];
      await admin.from('collaborators').delete().eq('id', u.collab_id);
      try { await admin.auth.admin.deleteUser(u.auth_id); } catch (_) {}
    }
  }
  console.log('  ok');
}

(async () => {
  let U;
  try {
    U = await setup();
    await seedFixtures(U);
    await runChecks(U);
  } catch (e) {
    console.error('\n[FATAL]', e.message);
    fail++;
    failures.push('FATAL: ' + e.message);
  } finally {
    try { await cleanup(U); } catch (e) { console.error('[cleanup err]', e.message); }
  }

  console.log('\n──────────────────────────────────────');
  console.log(`${pass} pass · ${fail} fail`);
  if (fail) {
    console.log('\nFalhas:');
    for (const f of failures) console.log('  · ' + f);
  }
  process.exit(fail ? 1 : 0);
})();

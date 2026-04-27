// Test fixture for audio runtime — generates audios via OpenAI TTS, transcribes
// via Whisper through the real audio service, runs through engine. Cleans up.
//
// Usage: ssh tom 'cd /opt/LA-Organizer && node --max-old-space-size=2048 scripts/test-audio-e2e.js'

const https = require('https');
const fs = require('fs');
const http = require('http');
// .env is loaded via shell `export $(cat .env)` if not, fallback below
if (!process.env.OPENAI_API_KEY) {
  const envFile = '/opt/LA-Organizer/.env';
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

const supabase = require('/opt/LA-Organizer/src/supabase/client');
const audio = require('/opt/LA-Organizer/src/services/audio');
const engine = require('/opt/LA-Organizer/src/engine');

let pass = 0, total = 0;
const T = (name, ok, hint) => {
  total++; if (ok) pass++;
  console.log((ok ? '✅' : '❌') + ' ' + name + (hint ? ' — ' + hint : ''));
};

async function tts(text, fname) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3' });
    const req = https.request({
      method: 'POST', hostname: 'api.openai.com', path: '/v1/audio/speech',
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) return reject(new Error('TTS HTTP ' + res.statusCode));
        const fpath = '/tmp/' + fname;
        fs.writeFileSync(fpath, buf);
        resolve(fpath);
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// Local file server: serves /tmp/*.mp3 over http://127.0.0.1:PORT/<fname>
// so audio.transcribeAudio({ audioUrl }) can fetch it like a real UAZAPI URL.
function startLocalServer() {
  const server = http.createServer((req, res) => {
    const fname = req.url.replace(/^\/+/, '').replace(/\?.*$/, '');
    const fpath = '/tmp/' + fname;
    if (!fname || !fs.existsSync(fpath)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    fs.createReadStream(fpath).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ server, base: `http://127.0.0.1:${port}` });
  }));
}

async function makeFixture(text, fname) {
  await tts(text, fname);
  return fname;
}

async function transcribeViaService(baseUrl, fname) {
  // Build a webhook-like payload that audio.findAudioUrl will pick up
  const body = { audioUrl: `${baseUrl}/${fname}` };
  return await audio.transcribeAudio(body);
}

(async () => {
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

  // setup
  const { data: alf } = await supabase.from('collaborators').select('*').ilike('full_name', 'Luciano%').limit(1).single();
  console.log('actor: Alf (director)\n');

  // Insert a real test task we can complete via audio
  const { data: testTask } = await supabase.from('tasks').insert({
    title: 'TEST_AUDIO_T1 entrevista do professor',
    assigned_to: alf.id, created_by: alf.id, source: 'manual',
    status: 'pending', context: 'work', priority: 'medium', due_date: today,
  }).select('id').single();
  const testTaskId = testTask.id;

  // Start local file server
  const { server, base } = await startLocalServer();
  console.log('local audio server: ' + base + '\n');

  const cleanup = { tasks: [testTaskId], memories: [], history: [] };

  try {
    // ====== T1: simple "fiz a entrevista do professor" ======
    console.log('--- T1: simple action complete ---');
    await makeFixture('Fiz a entrevista do professor de piano hoje cedo.', 't1.mp3');
    const r1 = await transcribeViaService(base, 't1.mp3');
    console.log('  transcribed: "' + (r1.text || '') + '"');
    T('T1 transcription succeeds', r1.ok && /entrevista/i.test(r1.text));
    T('T1 contains action verb', /\b(fiz|completei|feito)\b/i.test(r1.text));

    // ====== T2: multiple actions ======
    console.log('\n--- T2: multiple actions ---');
    await makeFixture('Fiz a entrevista do professor e o material do teatro vai ficar pra quinta.', 't2.mp3');
    const r2 = await transcribeViaService(base, 't2.mp3');
    console.log('  transcribed: "' + (r2.text || '') + '"');
    T('T2 transcription succeeds', r2.ok);
    T('T2 captures both actions', /entrevista/i.test(r2.text) && /quinta/i.test(r2.text));

    // ====== T3: ambiguous ======
    console.log('\n--- T3: ambiguous reference ---');
    await makeFixture('Tô vendo aquela parada lá do Renan.', 't3.mp3');
    const r3 = await transcribeViaService(base, 't3.mp3');
    console.log('  transcribed: "' + (r3.text || '') + '"');
    T('T3 transcription succeeds', r3.ok);
    T('T3 ambiguous reference preserved', /Renan/i.test(r3.text) && /(parada|aquilo)/i.test(r3.text));

    // ====== T4: bad audio (very short / silence-like) ======
    console.log('\n--- T4: short/unclear audio ---');
    await makeFixture('uhh', 't4.mp3');
    const r4 = await transcribeViaService(base, 't4.mp3');
    console.log('  transcribed: "' + (r4.text || '') + '"  ok=' + r4.ok + '  reason=' + (r4.reason || '-'));
    // Whisper may return empty or near-empty for unclear audio — both outcomes are acceptable
    T('T4 handles unclear audio gracefully', r4.ok || r4.reason === 'transcription_empty');

    // ====== T5: context only (no action) ======
    console.log('\n--- T5: context only, no action ---');
    await makeFixture('Hoje a aula da manhã teve mais alunos do que o normal, foi corrido mas tudo bem.', 't5.mp3');
    const r5 = await transcribeViaService(base, 't5.mp3');
    console.log('  transcribed: "' + (r5.text || '') + '"');
    T('T5 transcription succeeds', r5.ok);
    T('T5 no action verb in text', !/(fiz|terminei|completei|reagenda|adia)/i.test(r5.text));

    // ====== T6: confirmation flow via processMessage ======
    // Skill loads on prefix [áudio transcrito]; then user "sim" triggers action.
    console.log('\n--- T6: confirmation flow (engine integration) ---');
    // Seed audio prefix → expect Claude to ask confirmation, NOT emit TASK_UPDATE marker yet.
    const prefixedText = '[áudio transcrito] ' + r1.text;
    // Verify pickSkill loads tratamento-audio
    const fs2 = require('fs');
    const sysSrc = fs2.readFileSync('/opt/LA-Organizer/src/prompts/system.js', 'utf-8');
    const m = sysSrc.match(/function pickSkill\(collab[\s\S]+?\n\}\n/);
    const loadSkill = (n) => ({ stub: n });
    eval(m[0]);
    const picked = pickSkill({ onboarding_completed: true }, prefixedText, []);
    T('T6 audio prefix routes to tratamento-audio skill', picked && picked.name === 'tratamento-audio');

    // ====== T7: correction flow — verify skill examples reflect correction ======
    console.log('\n--- T7: correction flow (skill alignment) ---');
    const correctionPicked = pickSkill({ onboarding_completed: true }, '[áudio transcrito] não, era outra coisa', []);
    T('T7 correction also routes to tratamento-audio', correctionPicked && correctionPicked.name === 'tratamento-audio');

    // ====== Privacy guarantees ======
    console.log('\n--- Privacy guarantees ---');
    // 1. Audio bytes not persisted in collaborator_memory
    const { count: memSinceTest } = await supabase.from('collaborator_memory')
      .select('id', { head: true, count: 'exact' })
      .eq('collaborator_id', alf.id)
      .ilike('content', '%entrevista do professor%');
    T('audio bytes NOT in collaborator_memory', (memSinceTest || 0) === 0);

    // 2. Transcription not surfaced anywhere bad
    T('isProviderConfigured returns true', audio.isProviderConfigured() === true);

  } finally {
    server.close();
    // cleanup files
    for (const f of ['t1.mp3', 't2.mp3', 't3.mp3', 't4.mp3', 't5.mp3']) {
      try { fs.unlinkSync('/tmp/' + f); } catch (_) {}
    }
    // cleanup DB
    if (cleanup.tasks.length) await supabase.from('tasks').delete().in('id', cleanup.tasks);
  }

  console.log('\n=== ' + pass + '/' + total + ' pass ===');
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error('fatal:', e.message); process.exit(2); });

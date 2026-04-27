// Full-loop test: TTS -> Whisper -> engine pickSkill -> Claude (turn 1 confirm) ->
// user 'sim' -> Claude (turn 2 emits TASK_UPDATE marker).
// Run on VPS:
//   cd /opt/LA-Organizer && export $(cat .env | grep -v ^# | xargs) && node scripts/test-audio-flow.js

const fs = require('fs');
const https = require('https');
const http = require('http');

if (!process.env.OPENAI_API_KEY) {
  for (const line of fs.readFileSync('/opt/LA-Organizer/.env', 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const supabase = require('/opt/LA-Organizer/src/supabase/client');
const audio = require('/opt/LA-Organizer/src/services/audio');
const ai = require('/opt/LA-Organizer/src/ai/provider');
const { buildSystemPrompt } = require('/opt/LA-Organizer/src/prompts/system');

function tts(text, fname) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3' });
    const req = https.request({
      method: 'POST', hostname: 'api.openai.com', path: '/v1/audio/speech',
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('TTS HTTP ' + res.statusCode));
        fs.writeFileSync('/tmp/' + fname, Buffer.concat(chunks));
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

(async () => {
  const { data: alf } = await supabase.from('collaborators')
    .select('*, user_preferences(*), collaborator_profiles(*)')
    .ilike('full_name', 'Luciano%').limit(1).single();
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

  const { data: testTask } = await supabase.from('tasks').insert({
    title: 'TEST_AUDIO_FLOW entrevista do professor de piano',
    assigned_to: alf.id, created_by: alf.id, source: 'manual',
    status: 'pending', context: 'work', priority: 'medium', due_date: today,
  }).select('id').single();
  console.log('test task: ' + String(testTask.id).slice(0, 8));

  const server = http.createServer((req, res) => {
    const fname = req.url.replace(/^\/+/, '');
    const fpath = '/tmp/' + fname;
    if (!fs.existsSync(fpath)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    fs.createReadStream(fpath).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  let pass = 0, total = 0;
  const T = (n, ok, h) => { total++; if (ok) pass++; console.log((ok ? '✅' : '❌') + ' ' + n + (h ? ' — ' + h : '')); };

  try {
    // ---- T6: full audio -> confirmation -> action ----
    console.log('\n=== T6: audio simple -> confirmation flow ===');
    await tts('Fiz a entrevista do professor de piano.', 'flow.mp3');
    const r = await audio.transcribeAudio({ audioUrl: base + '/flow.mp3' });
    console.log('Whisper: "' + r.text + '"');
    T('T6.0 Whisper transcribed', r.ok && r.text.length > 5);

    const text = '[áudio transcrito] ' + r.text;
    const { systemPrompt } = await buildSystemPrompt(alf, { lastUserMessage: text });
    const audioSkillLoaded = /tratamento.{0,2}audio|interpret(ar|a).+confirm/i.test(systemPrompt);
    T('T6.1 skill tratamento-audio loaded in prompt', audioSkillLoaded);

    console.log('\n--- Turn 1: audio in ---');
    const t1 = await ai.chat(systemPrompt, [{ role: 'user', content: text }]);
    console.log(t1.text.slice(0, 400));
    const askedConfirm = /(certo\??|tá certo|confirma|isso\??$|isso mesmo|tá assim)/i.test(t1.text);
    const noMarker = !/<<TASK_UPDATE>>/.test(t1.text);
    T('T6.2 turn1 asks confirmation', askedConfirm);
    T('T6.3 turn1 emits NO marker (action gated)', noMarker);

    console.log('\n--- Turn 2: user "sim" ---');
    const t2 = await ai.chat(systemPrompt, [
      { role: 'user', content: text },
      { role: 'assistant', content: t1.text },
      { role: 'user', content: 'sim, isso mesmo' },
    ]);
    console.log(t2.text.slice(0, 400));
    const hasMarker = /<<TASK_UPDATE>>[\s\S]+?<<END>>/.test(t2.text);
    T('T6.4 turn2 emits TASK_UPDATE marker after confirmation', hasMarker);

    // ---- T7: correction flow ----
    console.log('\n=== T7: correction adjusts before action ===');
    const correctionConv = [
      { role: 'user', content: '[áudio transcrito] fiz a entrevista do professor de piano hoje cedo' },
      { role: 'assistant', content: 'Entendi: *Entrevista do professor* — feito ✅. Certo?' },
      { role: 'user', content: 'não, foi a entrevista de violão, não de piano' },
    ];
    const { systemPrompt: sp7 } = await buildSystemPrompt(alf, { lastUserMessage: correctionConv[2].content });
    const t7 = await ai.chat(sp7, correctionConv);
    console.log(t7.text.slice(0, 400));
    const acknowledgesCorrection = /(violão|violao|ah\\b|então|certo|entendi.*então|atualizei)/i.test(t7.text);
    const stillNoMarker = !/<<TASK_UPDATE>>/.test(t7.text) || /confirma|certo\?/i.test(t7.text);
    T('T7.1 acknowledges correction', acknowledgesCorrection);
    T('T7.2 re-confirms before acting', stillNoMarker);

  } finally {
    await supabase.from('tasks').delete().eq('id', testTask.id);
    try { fs.unlinkSync('/tmp/flow.mp3'); } catch (_) {}
    server.close();
  }

  console.log('\n=== ' + pass + '/' + total + ' pass ===');
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error('fatal:', e.message); process.exit(2); });

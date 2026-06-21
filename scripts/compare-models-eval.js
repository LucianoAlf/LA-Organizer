// compare-models-eval.js — Lote AMPLIADO Sonnet 4.6 vs GPT-5.5, caminho 1:1 (DM).
// Roda SÓ na VPS (codex CLI só existe lá), HOME isolado em /tmp → NÃO toca o CANON:
//   node --env-file=.env scripts/compare-models-eval.js <casos1.json> [casos2.json ...]
// Mede por caso: markers emitidos por modelo, leak de infra (PÓS-sanitizer = o que o
// usuário veria), latência. Texto completo → stdout; bloco ===SUMMARY=== compacto no fim.
process.env.TOM_CLAUDE_HOME = '/tmp/tomeval/.claude-tom';
process.env.CLAUDE_HOME = '/tmp/tomeval/.claude-tom/.claude';
process.env.TOM_CLAUDE_PARALLEL = '0';
const fs = require('fs');
const BASE = process.cwd();
const isoHome = '/tmp/tomeval/.claude-tom/.claude';
fs.mkdirSync(isoHome, { recursive: true });
fs.copyFileSync(BASE + '/.claude-tom/.claude/.credentials.json', isoHome + '/.credentials.json');
try { fs.chmodSync(isoHome + '/.credentials.json', 0o600); } catch (_) {}
const supabase = require(BASE + '/src/supabase/client');
const { buildSystemPrompt, formatMessages } = require(BASE + '/src/prompts/system');
const claude = require(BASE + '/src/ai/claude');
const openai = require(BASE + '/src/ai/openai');

const MARK = (s) => { const m = String(s || '').match(/<<[A-Z_]+>>/g) || []; return m.length ? m.join(' ') : '—'; };
const LEAKRE = /ssh\s+tom|\/opt\/LA-Organizer|service_role|\/mnt\/[a-z]\/|setup-vps-key|\bpm2\b|cat\s+\.env|grep\s+SUPABASE|CLAUDE\.md|\.claude\/projects|```/gi;
const LEAK = (s) => (String(s || '').match(LEAKRE) || []).length;

const casos = process.argv.slice(2).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const rows = [];
let n = 0, sMs = 0, gMs = 0, sLeak = 0, gLeak = 0;
(async () => {
  for (const caso of casos) {
    const { data: collab } = await supabase.from('collaborators').select('*').eq('id', caso.cid).single();
    if (!collab) { console.log('\n██ ' + caso.label + ' — collab não achado (' + caso.cid + ')'); continue; }
    const { systemPrompt, ctx } = await buildSystemPrompt(collab, { lastUserMessage: caso.text });
    const msgs = formatMessages(ctx.recentMessages, caso.text);
    let sonnet, gpt;
    const t0 = Date.now();
    try { sonnet = { ...(await claude.chat(systemPrompt, msgs)), ms: Date.now() - t0 }; }
    catch (e) { sonnet = { text: '(erro Claude) ' + (e.message || e), ms: Date.now() - t0 }; }
    const t1 = Date.now();
    try { gpt = { ...(await openai.chat(systemPrompt, msgs)), ms: Date.now() - t1 }; }
    catch (e) { gpt = { text: '(erro Codex) ' + (e.message || e), ms: Date.now() - t1 }; }
    const L = '\n' + '─'.repeat(72) + '\n';
    console.log('\n\n██████ ' + caso.label + ' (' + collab.full_name + ') ██████');
    if (caso.trap) console.log('ESPERADO: ' + caso.trap);
    console.log('MSG: ' + JSON.stringify(caso.text) + ' | hist=' + (ctx.recentMessages || []).length);
    console.log(L + 'SONNET 4.6 (' + sonnet.ms + 'ms) mk=[' + MARK(sonnet.text) + '] leak=' + LEAK(sonnet.text) + L + sonnet.text);
    console.log(L + 'GPT-5.5 (' + gpt.ms + 'ms) mk=[' + MARK(gpt.text) + '] leak=' + LEAK(gpt.text) + L + gpt.text);
    rows.push({ label: caso.label, trap: caso.trap || '', s_mk: MARK(sonnet.text), s_leak: LEAK(sonnet.text), s_ms: sonnet.ms, g_mk: MARK(gpt.text), g_leak: LEAK(gpt.text), g_ms: gpt.ms });
    n++; sMs += sonnet.ms; gMs += gpt.ms; sLeak += LEAK(sonnet.text); gLeak += LEAK(gpt.text);
  }
  console.log('\n\n===SUMMARY===');
  for (const r of rows) {
    console.log(r.label + (r.trap ? '  {' + r.trap + '}' : ''));
    console.log('   SONNET ' + r.s_ms + 'ms leak=' + r.s_leak + ' mk=[' + r.s_mk + ']');
    console.log('   GPT    ' + r.g_ms + 'ms leak=' + r.g_leak + ' mk=[' + r.g_mk + ']');
  }
  console.log('\n=== AGREGADO (n=' + n + ') ===');
  console.log('Latencia media: SONNET ' + Math.round(sMs / n) + 'ms | GPT ' + Math.round(gMs / n) + 'ms');
  console.log('Leak total (pos-sanitizer): SONNET ' + sLeak + ' | GPT ' + gLeak);
  try { require('child_process').execSync('rm -rf /tmp/tomeval'); } catch (_) {}
  process.exit(0);
})();

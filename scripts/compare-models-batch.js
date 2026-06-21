// Comparativo Sonnet 4.6 vs GPT-5.5 com paridade. Roda SÓ na VPS:
//   node --env-file=.env scripts/compare-models-batch.js scripts/compare-models-casos.json
// Claude usa HOME isolado (cópia do CANON) → zero risco de corromper o .claude.json do engine.
// Codex via openai.chat() real → exercita o openai.js novo (histórico + sanitize + cwd).
process.env.TOM_CLAUDE_HOME = '/tmp/tomcmp/.claude-tom';
process.env.CLAUDE_HOME = '/tmp/tomcmp/.claude-tom/.claude';
process.env.TOM_CLAUDE_PARALLEL = '0';
const fs = require('fs');
const BASE = process.cwd();
const isoHome = '/tmp/tomcmp/.claude-tom/.claude';
fs.mkdirSync(isoHome, { recursive: true });
fs.copyFileSync(BASE + '/.claude-tom/.claude/.credentials.json', isoHome + '/.credentials.json');
try { fs.chmodSync(isoHome + '/.credentials.json', 0o600); } catch (_) {}
const supabase = require(BASE + '/src/supabase/client');
const { buildSystemPrompt, formatMessages } = require(BASE + '/src/prompts/system');
const claude = require(BASE + '/src/ai/claude');
const openai = require(BASE + '/src/ai/openai');

const casos = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
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
    console.log('MSG: ' + JSON.stringify(caso.text) + ' | hist=' + (ctx.recentMessages || []).length);
    console.log(L + 'SONNET 4.6 (' + sonnet.ms + 'ms)' + L + sonnet.text);
    console.log(L + 'GPT-5.5 c/ paridade (' + gpt.ms + 'ms)' + L + gpt.text);
  }
  try { require('child_process').execSync('rm -rf /tmp/tomcmp'); } catch (_) {}
  process.exit(0);
})();

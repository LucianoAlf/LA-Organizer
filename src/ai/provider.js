const claude = require('./claude');
const openai = require('./openai');

// Returns { text, provider, fallbackFrom?, primaryError? }.
// On total failure throws Error with .kind='all_failed' and .errors=[claudeErr, codexErr].
async function chat(systemPrompt, messages, maxTokens = 2048) {
  let claudeErr = null;
  try {
    const r = await claude.chat(systemPrompt, messages, maxTokens);
    console.log('[AI] Claude respondeu');
    return r;
  } catch (err) {
    claudeErr = err;
    const kind = err.kind || 'unknown';
    console.warn(`[AI] Claude falhou kind=${kind}: ${err.message.slice(0, 200)} — tentando Codex...`);
  }
  try {
    const r = await openai.chat(systemPrompt, messages, maxTokens);
    console.log(`[AI] Codex respondeu via fallback (claude_kind=${claudeErr?.kind || 'unknown'})`);
    return { ...r, fallbackFrom: 'claude', primaryError: { kind: claudeErr?.kind, message: claudeErr?.message?.slice(0, 200) } };
  } catch (err) {
    const e = new Error(`all_providers_failed: claude=${claudeErr?.kind || 'unknown'} codex=${err.kind || 'unknown'}`);
    e.kind = 'all_failed';
    e.errors = [
      { provider: 'claude', kind: claudeErr?.kind, message: claudeErr?.message?.slice(0, 200) },
      { provider: 'openai', kind: err.kind, message: err.message?.slice(0, 200) },
    ];
    throw e;
  }
}
module.exports = { chat };

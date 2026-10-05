const claude = require('./claude');
const openai = require('./openai');

// DREAM-FALLBACK-INVISIVEL (05/10): quantas vezes ESTE processo caiu do Claude pro Codex. O fallback
// só existia como linha de console; o sensor DREAM_MEMORY de 05/10 dizia "erros=0" numa noite com 3
// timeouts do Claude respondidos pelo Codex. Contador do processo (o dispatcher é um processo por
// tique de cron), lido como delta antes/depois do laço — não é métrica global.
let _fallbacks = 0;
function contarFallbacks() { return _fallbacks; }

// Returns { text, provider, fallbackFrom?, primaryError? }.
// On total failure throws Error with .kind='all_failed' and .errors=[claudeErr, codexErr].
async function chat(systemPrompt, messages, maxTokens = 2048) {
  let claudeErr = null;
  try {
    const r = await claude.chat(systemPrompt, messages, maxTokens);
    console.log(`[AI] Claude ok dur=${r.meta?.duration_ms ?? '?'}ms api=${r.meta?.duration_api_ms ?? '?'}ms fila=${r.meta?.queue_wait_ms ?? '?'}ms out=${r.meta?.output_tokens ?? '?'}tok`);
    return r;
  } catch (err) {
    claudeErr = err;
    const kind = err.kind || 'unknown';
    console.warn(`[AI] Claude falhou kind=${kind}: ${err.message.slice(0, 200)} — tentando Codex...`);
  }
  try {
    const r = await openai.chat(systemPrompt, messages, maxTokens);
    _fallbacks++;
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
module.exports = { chat, contarFallbacks };

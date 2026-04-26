const claude = require('./claude');
const openai = require('./openai');
async function chat(systemPrompt, messages, maxTokens = 2048) {
  try {
    const r = await claude.chat(systemPrompt, messages, maxTokens);
    console.log('[AI] Claude respondeu');
    return r;
  } catch (err) {
    console.warn('[AI] Claude falhou:', err.message, '— tentando Codex...');
  }
  try {
    const r = await openai.chat(systemPrompt, messages, maxTokens);
    console.log('[AI] Codex respondeu via fallback');
    return r;
  } catch (err) {
    throw new Error('Todos os provedores falharam: ' + err.message);
  }
}
module.exports = { chat };

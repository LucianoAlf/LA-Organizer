// src/ai/claude.js — Spawn do CLI `claude` em modo headless (-p), passando
// o system prompt rico via --append-system-prompt.
const { spawn } = require('child_process');

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const CLAUDE_HOME = process.env.CLAUDE_HOME || '/root/.claude';
const CLAUDE_USER_HOME = process.env.HOME || '/root';
const CLAUDE_PATH = process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 60000;

function buildEnv() {
  const env = {
    HOME: CLAUDE_USER_HOME,
    PATH: CLAUDE_PATH,
    CLAUDE_HOME,
    LANG: process.env.LANG || 'C.UTF-8',
  };
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

/**
 * @param {string} systemPrompt - Conteúdo SOUL+AGENTS+contexto. Pode ter dezenas de KB.
 * @param {Array<{role:string,content:string}>} messages - Histórico + mensagem atual.
 * @returns {Promise<{text:string, provider:string}>}
 */
async function chat(systemPrompt, messages /*, maxTokens */) {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';

  // Histórico recente como contexto na mensagem do usuário (para Claude ver o turno anterior).
  const history = messages
    .slice(0, -1)
    .map(m => (m.role === 'user' ? 'Usuário: ' : 'TOM: ') + m.content)
    .join('\n');
  const userPrompt = history
    ? `Conversa recente:\n${history}\n\nMensagem atual do usuário:\n${lastUser}`
    : lastUser;

  return new Promise((resolve, reject) => {
    // --append-system-prompt mantém o system prompt separado do user prompt,
    // permitindo que o Claude trate identidade/contexto como instrução de sistema.
    const args = [
      '-p', userPrompt,
      '--append-system-prompt', systemPrompt,
    ];

    const child = spawn(CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildEnv(),
      cwd: '/opt/LA-Organizer',
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`Claude timeout após ${CLAUDE_TIMEOUT_MS}ms. stderr: ${stderr.slice(0, 300)}`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      reject(new Error('Claude spawn falhou: ' + err.message));
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      const text = stdout.trim();
      if (code !== 0) {
        return reject(new Error(`Claude saiu com código ${code}. stderr: ${stderr.trim().slice(0, 500) || '(vazio)'}`));
      }
      if (!text) {
        return reject(new Error(`Claude retornou vazio. stderr: ${stderr.trim().slice(0, 500) || '(vazio)'}`));
      }
      resolve({ text, provider: 'claude' });
    });
  });
}

module.exports = { chat };

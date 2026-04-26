const { spawn } = require('child_process');

// Resolve PM2-stripped env once. PM2 spawns under root, but we still
// pin HOME and PATH explicitly so the child claude CLI can find
// /root/.claude/.credentials.json (OAuth) regardless of how PM2 was started.
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const CLAUDE_HOME = process.env.CLAUDE_HOME || '/root/.claude';
const CLAUDE_USER_HOME = process.env.HOME || '/root';
const CLAUDE_PATH = process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 30000;

function buildEnv() {
  const env = {
    HOME: CLAUDE_USER_HOME,
    PATH: CLAUDE_PATH,
    CLAUDE_HOME,
    LANG: process.env.LANG || 'C.UTF-8',
  };
  // Forward auth env if explicitly set (preferred for headless deploys);
  // otherwise the CLI falls back to OAuth at $HOME/.claude/.credentials.json.
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

async function chat(systemPrompt, messages /*, maxTokens */) {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
  const fullPrompt = systemPrompt + '\n\nHuman: ' + lastUser + '\nAssistant:';

  return new Promise((resolve, reject) => {
    // stdio: 'ignore' for stdin is the critical bit — without it the CLI waits
    // ~3s for stdin and then prints a warning + exits with empty stdout, which
    // bubbled up as "Vazio" under PM2.
    const child = spawn(CLAUDE_BIN, ['-p', fullPrompt], {
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

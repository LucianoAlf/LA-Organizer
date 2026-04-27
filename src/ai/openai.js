const { spawn } = require('child_process');
const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS) || 120000;

async function chat(systemPrompt, messages /*, maxTokens */) {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
  const prompt = 'System: ' + systemPrompt + '\n\nUser: ' + lastUser;
  return new Promise((resolve, reject) => {
    const reject_ = (kind, msg) => {
      const e = new Error(msg);
      e.kind = kind;
      e.provider = 'openai';
      reject(e);
    };
    let settled = false;
    const proc = spawn('codex', ['exec', '--model', 'gpt-5.4', prompt], { env: process.env });
    let out = '', err = '';
    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject_('timeout', `Codex timeout após ${CODEX_TIMEOUT_MS}ms. stderr: ${err.slice(0, 300)}`);
    }, CODEX_TIMEOUT_MS);
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code !== 0) return reject_('exit', `Codex saiu com código ${code}. stderr: ${err.trim().slice(0, 300) || '(vazio)'}`);
      const text = out.trim();
      if (!text) return reject_('empty', 'Codex retornou vazio.');
      resolve({ text, provider: 'openai' });
    });
    proc.on('error', e => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      reject_('spawn', 'Codex spawn falhou: ' + e.message);
    });
  });
}
module.exports = { chat };

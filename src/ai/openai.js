const { spawn } = require('child_process');
const os = require('os');
const { buildUserPrompt } = require('./prompt');
const { sanitizeOutput } = require('./sanitize');
// LATÊNCIA (15/06): Codex é a REDE de segurança (só roda quando o Claude falha/hang).
// 120s→60s pra manter o TETO total em ~120s (Claude 60s + Codex 60s) e não deixar
// o usuário "escrevendo a vida toda". Override via CODEX_TIMEOUT_MS.
const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS) || 60000;

async function chat(systemPrompt, messages /*, maxTokens */) {
  const userPrompt = buildUserPrompt(messages);
  const prompt = 'System: ' + systemPrompt + '\n\nUser: ' + userPrompt;
  return new Promise((resolve, reject) => {
    const reject_ = (kind, msg) => {
      const e = new Error(msg);
      e.kind = kind;
      e.provider = 'openai';
      reject(e);
    };
    let settled = false;
    // Sprint 26 — modelo gpt-5.4 era inválido (Codex ficava em "Reading from stdin").
    // Trocado pra gpt-5.5 com reasoning effort=medium (balanço custo/latência).
    // Sprint 27 — Codex CLI atualizado 0.120 → 0.131 (suporte gpt-5.5).
    // CLI novo exige --skip-git-repo-check ou trusted directory; passamos a flag.
    // Sprint 27 — Prompt do TOM tem ~90KB. Passar como argv estoura ARG_MAX
    // do Linux (em alguns kernels 128KB inclui env vars e quebra mesmo abaixo
    // disso). Resultado: Codex não recebe argumento e fica eternamente em
    // "Reading additional input from stdin..." até timeout 120s. Solução:
    // mandar prompt via stdin (passando '-' como prompt arg).
    const proc = spawn('codex', [
      'exec',
      '--model', 'gpt-5.5',
      '-c', 'model_reasoning_effort=medium',
      '--skip-git-repo-check',
      '-',
    ], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], cwd: os.tmpdir() });
    proc.stdin.write(prompt);
    proc.stdin.end();
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
      // Sanitiza ANTES do empty-check: se o Codex respondeu só cerca de código,
      // o sanitizer esvazia → vira reject('empty') em vez de mandar vazio (espelha claude.js).
      const text = sanitizeOutput(out);
      // delta sobre out.trim() (não out) pra o \n final do codex não contar como
      // "stripped" → o sensor só dispara em remoção real (anti cry-wolf).
      const sanitizedDelta = out.trim().length - text.length;
      if (sanitizedDelta > 0) console.warn(`[Codex] sanitizer stripped ${sanitizedDelta} chars`);
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

const { spawn } = require('child_process');
async function chat(systemPrompt, messages, maxTokens = 2048) {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
  const prompt = 'System: ' + systemPrompt + '\n\nUser: ' + lastUser;
  return new Promise((resolve, reject) => {
    const proc = spawn('codex', ['exec', '--model', 'gpt-5.4', prompt], { env: process.env, timeout: 120000 });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('Codex falhou: ' + err.substring(0, 200)));
      const text = out.trim();
      if (!text) return reject(new Error('Vazio'));
      resolve({ text, provider: 'openai' });
    });
    proc.on('error', e => reject(e));
  });
}
module.exports = { chat };

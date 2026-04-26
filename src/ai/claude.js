const { spawn } = require('child_process');
async function chat(systemPrompt, messages, maxTokens = 2048) {
  const parts = ['<s>\n' + systemPrompt + '\n</s>'];
  for (const msg of messages) {
    if (msg.role === 'user') parts.push('\nHuman: ' + msg.content);
    else if (msg.role === 'assistant') parts.push('\nAssistant: ' + msg.content);
  }
  const prompt = parts.join('\n');
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--model', 'claude-sonnet-4-6-20250514', '--max-tokens', String(maxTokens), '--output-format', 'text'], { env: { ...process.env }, timeout: 60000 });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('Claude CLI falhou: ' + err));
      const text = out.trim();
      if (!text) return reject(new Error('Claude retornou vazio'));
      resolve({ text, usage: { input: 0, output: 0 }, provider: 'claude' });
    });
    proc.on('error', e => reject(new Error('Claude nao encontrado: ' + e.message)));
    proc.stdin.write(prompt); proc.stdin.end();
  });
}
module.exports = { chat };

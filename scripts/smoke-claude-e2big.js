// scripts/smoke-claude-e2big.js
// Prova da Fatia H: chama claude.chat() com system prompt >250KB que ANTES estourava
// ARG_MAX (spawn E2BIG). Agora vai por --append-system-prompt-file → deve resolver.
// Também testa concorrência (mutex intacto) e que os arquivos temp são apagados.
// Rodar no VPS: cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-claude-e2big.js
const fs = require('fs');
const os = require('os');
const { chat } = require('../src/ai/claude');

const big = 'Você é um teste de carga. Responda EXATAMENTE a palavra: PONG.\n' + 'X'.repeat(270000);
const tmpCount = () => fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('tom-sysprompt-')).length;

async function main() {
  const results = [];
  console.log(`system prompt = ${big.length} chars · tmp antes = ${tmpCount()}`);
  try {
    // 1) E2BIG single — o caso que quebrava
    const r = await chat(big, [{ role: 'user', content: 'diga' }], 50);
    results.push(['E2BIG 270KB resolve', /pong/i.test(r.text || ''), `${r.provider}: ${JSON.stringify((r.text || '').slice(0, 40))}`]);

    // 2) concorrência — mutex serializa, ambos devem resolver
    const [a, b] = await Promise.all([
      chat(big, [{ role: 'user', content: 'diga' }], 50),
      chat(big, [{ role: 'user', content: 'diga' }], 50),
    ]);
    results.push(['concorrência 2x resolve', /pong/i.test(a.text || '') && /pong/i.test(b.text || ''), '']);

    // 3) sem tmp vazado
    results.push(['sem tmp vazado', tmpCount() === 0, `tmp depois = ${tmpCount()}`]);
  } catch (e) {
    results.push([`execução sem exceção (kind=${e.kind})`, false, e.message.slice(0, 160)]);
  }
  console.log('\n=== RESULTADOS ===');
  let ok = true;
  for (const [n, p, d] of results) { console.log(`${p ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!p) ok = false; }
  console.log(ok ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });

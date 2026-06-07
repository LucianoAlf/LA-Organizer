// scripts/smoke-conversation-audit.js
// Prova de PRECISÃO: roda o analisador sobre a conversa REAL do Matheus (07/06) e
// confirma que detecta confabulation + wrong_refusal. NÃO grava nada (só analisa).
// Rodar no VPS: cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-conversation-audit.js
const { createClient } = require('@supabase/supabase-js');
const { chat } = require('../src/ai/provider');
const { auditConversation } = require('../src/services/conversation-audit');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

async function main() {
  const { data: m } = await sb.from('collaborators').select('id, full_name').ilike('full_name', '%matheus%').limit(5);
  if (!m || m.length === 0) { console.log('Matheus não encontrado'); process.exit(2); }
  for (const c of m) {
    const findings = await auditConversation(sb, chat, c, 72); // janela 72h pra pegar 07/06
    console.log(`\n=== ${c.full_name} (${findings.length} achados) ===`);
    for (const f of findings) {
      console.log(`[${f.category}/${f.severity}] ${f.summary}`);
      console.log(`   prova: ${String(f.evidence).slice(0, 140)}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });

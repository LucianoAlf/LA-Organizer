// scripts/preview-report-mirror.js — VPS: node --env-file=.env scripts/preview-report-mirror.js
// Pega o último card de resumo (kind='report') e mostra como ele ficaria espelhado no WhatsApp.
const { createClient } = require('@supabase/supabase-js');
const config = require('../src/config');
const { buildWhatsappText } = require('../src/services/group-chat-bridge-out');
const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
(async () => {
  const { data } = await supabase.from('group_chat_messages')
    .select('content').eq('kind', 'report').order('created_at', { ascending: false }).limit(1);
  const html = data?.[0]?.content || '';
  console.log('===== TEXTO QUE IRIA PRO WHATSAPP =====');
  console.log(buildWhatsappText({ role: 'tom', kind: 'report', content: html }, ''));
  console.log('===== FIM =====');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

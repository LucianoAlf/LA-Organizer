// scripts/link-wa-group.js — roda na VPS: node --env-file=.env scripts/link-wa-group.js
// Resolve o JID direto pelo código de convite; lista todos como conferência.
const { getGroupJidByInvite, listGroups } = require('../src/services/uazapi-groups');
const INVITE = 'KDjz7skJhjzAwzzI1eXB1b'; // a parte depois de chat.whatsapp.com/
(async () => {
  try {
    const jid = await getGroupJidByInvite(INVITE);
    console.log('>>> JID do Financeiro (pelo convite):', jid);
  } catch (e) { console.error('inviteInfo falhou:', e.response?.status, e.message); }
  console.log('--- todos os grupos (conferência) ---');
  try { for (const g of await listGroups()) console.log(`  ${g.jid}  ::  ${g.name}`); }
  catch (e) { console.error('listGroups falhou:', e.response?.status, e.message); }
})().catch((e) => { console.error('ERRO:', e.response?.status, e.message); process.exit(1); });

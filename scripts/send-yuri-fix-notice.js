#!/usr/bin/env node
// Aviso ao Yuri: reparei os 4 itens que você fechou mas ficaram parados.
// Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/send-yuri-fix-notice.js

process.chdir('/opt/LA-Organizer');
const whatsapp = require('../src/services/whatsapp');

const PHONE = '5521976861513';
const MSG = `Oi Yuri 👽

Você tinha razão. Fui no histórico, achei sua resposta "Feito" pra cada um e vi que confirmei aqui no chat mas *não atualizei no sistema*. Foi falha minha.

Acabei de fechar agora:

✅ *Testar lettering do Cadu*
✅ *Workshow - Moreira Jr.*
✅ *Garage Kids*
✅ *Musicolândia - Rec | Barra*

Sobre *Video CADU*: na última vez você disse "falta finalizar trilha sonora, amanhã". Já saiu ou ainda tá pendente? Se já fechou, manda "feito Video CADU" que eu fecho agora.

Tô subindo um ajuste pra essa falha não acontecer de novo. Valeu por avisar 🙏`;

(async () => {
  try {
    await whatsapp.sendMessage(PHONE, MSG);
    console.log('[FixNotice] enviado pro Yuri');
  } catch (err) {
    console.error('[FixNotice] erro:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();

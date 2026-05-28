#!/usr/bin/env node
// Avisa o Rodrigo do fix do inventário e pede pra refazer o cadastro.
process.chdir('/opt/LA-Organizer');
const whatsapp = require('../src/services/whatsapp');

const PHONE = '5521997548859';  // Rodrigo Professor PG EMLA
const MSG = `Rodrigo, falando contigo de novo 👽

Aquele "Item adicionado" que te respondi mais cedo nas fotos da Sala 13 — caiu como *tarefa* pra mim, não foi pro *inventário das escolas* como eu falei. Foi falha minha, identifiquei o gap e já corrigi.

Acabei de ajustar — agora reconheço a sequência inteira (Strato, Telecaster, semi-acústica, violão Folk, etc.) e cadastro de verdade no inventário com sala, condição e tudo.

*Pode refazer o levantamento da Sala 13?* É rápido — manda as mesmas 6 fotos com as legendas e eu cadastro uma por uma no inventário da unidade certa.

Pra começar, me confirma: foi *Campo Grande / Sala 13*? Aí já fica travado pras próximas.

Valeu pela paciência 🙏`;

(async () => {
  try {
    await whatsapp.sendMessage(PHONE, MSG);
    console.log('[InvFix] enviado pro Rodrigo');
  } catch (err) {
    console.error('[InvFix] erro:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();

#!/usr/bin/env node
// Explica ao Yuri o "não consegui registrar agora" + status final do ajuste.
process.chdir('/opt/LA-Organizer');
const whatsapp = require('../src/services/whatsapp');

const PHONE = '5521976861513';
const MSG = `Yuri, sobre aquele "_não consegui registrar agora_" 👇

Era falha minha. Mais cedo eu listei 4 itens como "em aberto sem data" que na verdade não existiam mais no sistema (já tavam fechados há semanas ou nunca tinham sido criados). Quando você respondeu o status de cada, tentei registrar — mas como os nomes não batiam com tarefa real nenhuma, deu erro silencioso.

Acabei de subir o ajuste:
✅ Só listo o que tá *de fato* cadastrado
✅ Se não tiver nada sem prazo, digo "nenhuma" — não invento mais

O "ignore kk" tá valendo. Olhei aqui e a *Gravação Jeyson Violão (04/06)* ficou registrada certinho — o resto não precisa de nada.

Valeu por bater o olho e perguntar 🙏`;

(async () => {
  try {
    await whatsapp.sendMessage(PHONE, MSG);
    console.log('[FollowupExplain] enviado pro Yuri');
  } catch (err) {
    console.error('[FollowupExplain] erro:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();

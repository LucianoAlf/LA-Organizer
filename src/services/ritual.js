// src/services/ritual.js — DESATIVADO em Phase 1.
// Os rituais agora são disparados pelo cron do sistema (crontab), via
// src/rituals/dispatcher.js, para permitir execução fora do processo do PM2
// e sobreviver a reinícios. Mantemos um startCrons() no-op para não quebrar
// quem importa.
function startCrons() {
  console.log('⏰ In-process cron desativado — usando dispatcher externo (crontab)');
}
module.exports = { startCrons };

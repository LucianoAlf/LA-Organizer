// scripts/smoke-leader-routing.js
// SMOKE dryRun do digest POR LÍDER (GovLeader 06/06). NÃO envia nada: chama
// perLeaderUnclosedTasksReport(..., {dryRun:true}) e imprime, pra CADA líder, quantas
// tarefas atrasadas cairiam pra ele + a prévia da mensagem. Prova que o roteamento
// (unidade→gerente, pedagógico→coordenadores, fan-out) está certo ANTES de ligar o cron.
//
// Rodar no VPS:  cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-leader-routing.js

const dispatcher = require('../src/rituals/dispatcher');

async function main() {
  const plan = await dispatcher.perLeaderUnclosedTasksReport(new Date(), { dryRun: true });
  if (!plan || plan.length === 0) {
    console.log('Nenhuma tarefa atrasada roteável agora (ou 0 líderes com itens).');
    process.exit(0);
  }
  plan.sort((a, b) => b.count - a.count);
  console.log(`\n=== PLANO DE ENVIO POR LÍDER (dryRun — nada enviado) ===`);
  console.log(`${plan.length} líder(es) receberiam digest:\n`);
  for (const p of plan) {
    console.log(`────────────────────────────────────────`);
    console.log(`👤 ${p.leaderName}  (...${String(p.phone).slice(-4)})  — ${p.count} tarefa(s)`);
    console.log(p.msg);
    console.log('');
  }
  console.log(`────────────────────────────────────────`);
  console.log(`RESUMO: ` + plan.map((p) => `${p.leaderName}=${p.count}`).join(', '));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });

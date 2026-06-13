// QA dry-run — motor de formatação semântica (Fatia D). Roda NO VPS:
//   cd /opt/LA-Organizer && node --env-file=.env scripts/_qa-format-dryrun.js
// Valida o systemPrompt novo via claude.chatRaw (Sonnet/OAuth). Não toca banco.
const { systemPromptFor } = require('../src/services/format-note');
const claude = require('../src/ai/claude');

const dump = `contas a pagar hoje 13/06
pg seguro hondinha 131,98 boleto 34191.09800 18865.330932
pg internet claro 82,99 debito automatico
pg uniforme colaboradores 2780 parcela 1 de 2
ligar pro contador ate sexta
mandar nota fiscal pro joao njoviano.santos@gmail.com
senha portal nfe gov2024
saldo recreio 1500 barra 800`;

(async () => {
  const cases = [
    ['format + emoji ON', systemPromptFor('format', { emoji: true })],
    ['format + emoji OFF', systemPromptFor('format', { emoji: false })],
    ['format + instrucao "so contas e tarefas"', systemPromptFor('format', { emoji: true, instruction: 'mostra so as contas a pagar e as tarefas, ignora o resto' })],
  ];
  for (const [label, sys] of cases) {
    try {
      const r = await claude.chatRaw(sys, dump);
      console.log('\n===== ' + label + ' =====\n' + r.text + '\n');
    } catch (e) {
      console.log('\n===== ' + label + ' ERRO: ' + e.message);
    }
  }
  process.exit(0);
})();

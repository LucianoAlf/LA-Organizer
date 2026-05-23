// Avisa colaboradoras afetadas pelo bug do QuickCreateSheet (tarefas pessoais
// salvas como work). Roda no VPS pra ter UTF-8 correto.
const recipients = [
  { name: 'Krissya',  number: '5521966875271' },
  { name: 'Quintela', number: '5521971751320' },
  { name: 'Rafinha',  number: '5521973008639' },
];

function buildText(name) {
  return [
    `Oi, ${name}! 👋 Aqui é o TOM.`,
    '',
    'Achamos um bug no app que estava silenciosamente salvando tarefas como *Trabalho* mesmo quando você selecionava *Pessoal*. Já foi corrigido.',
    '',
    'Se você lembrar de alguma tarefa que criou esses dias que era pra ser pessoal e tá aparecendo na aba de trabalho, é só me dizer aqui que eu movo pra você. Desculpa a chateação 🙏',
  ].join('\n');
}

(async () => {
  for (const r of recipients) {
    const res = await fetch('https://lamusic.uazapi.com/send/text', {
      method: 'POST',
      headers: { token: 'cfbb6715-3814-4b77-8270-8bbd07abf42e', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ number: r.number, text: buildText(r.name), readchat: true }),
    });
    const j = await res.json();
    console.log(`${r.name}: status=${j.status} id=${j.id || '-'}`);
    await new Promise(r => setTimeout(r, 1500));
  }
})();

// Script avulso — envia mensagem de onboarding pro Matheus Felipe via UAZAPI.
// Roda no VPS para garantir UTF-8 correto.
const text = [
  '👽 Oi, Matheus! Aqui é o TOM — assistente operacional da LA Music.',
  '',
  'Vi que o Quintela compartilhou o vídeo contigo. Bora botar pra rodar! 🚀',
  '',
  'Pra instalar o app no celular:',
  '1. Acessa 👉 https://la-organizer.vercel.app',
  '2. Toca nos *3 pontinhos* (⋮) do Chrome',
  '3. Escolhe *"Adicionar à tela inicial"*',
  '',
  'Depois é só abrir o ícone que vai parecer app de verdade. Qualquer dúvida me chama aqui — tô à disposição. 😉',
].join('\n');

(async () => {
  const res = await fetch('https://lamusic.uazapi.com/send/text', {
    method: 'POST',
    headers: { token: 'cfbb6715-3814-4b77-8270-8bbd07abf42e', 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ number: '5521978755351', text, readchat: true }),
  });
  const j = await res.json();
  console.log('status:', j.status);
  console.log('id:', j.id);
  console.log('preview:', String(j.text || '').slice(0, 120));
})();

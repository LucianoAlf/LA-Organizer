// Monta o user prompt do TOM: histórico recente formatado + mensagem atual.
// Lógica IDÊNTICA à que vivia inline no claude.js (paridade Claude/Codex).
function buildUserPrompt(messages) {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
  const history = messages
    .slice(0, -1)
    .map(m => (m.role === 'user' ? 'Usuário: ' : 'TOM: ') + m.content)
    .join('\n');
  return history
    ? `Conversa recente:\n${history}\n\nMensagem atual do usuário:\n${lastUser}`
    : lastUser;
}

module.exports = { buildUserPrompt };

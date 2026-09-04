// Formatacao de credenciais para o WhatsApp. Modulo PURO (sem I/O).
// O banco guarda observacoes em markdown (renderizado bonito no PWA), mas o
// WhatsApp nao renderiza `#`, `**`, tabelas nem callouts — apareceria cru.
// Aqui converte para a formatacao do WhatsApp; o banco fica intacto.

const MAX_ITENS = 30;    // itens numa listagem publica
const MAX_CAMPOS = 6;    // campos mostrados por credencial antes de resumir

function mdParaWhatsapp(md) {
  if (!md || typeof md !== 'string') return '';
  return md
    .replace(/^>\s*\[!critico\]\s*/gim, '⚠️ ')
    .replace(/^>\s*\[!atencao\]\s*/gim, '⚠️ ')
    .replace(/^>\s*\[!nota\]\s*/gim, '📌 ')
    .replace(/^#{1,6}\s*(.+)$/gm, '*$1*')   // headings → bold
    .replace(/\*\*(.+?)\*\*/g, '*$1*')      // bold md → bold wa
    .replace(/^>\s?/gm, '')                 // resto das citacoes
    .replace(/^\s*[-*]\s+/gm, '- ')         // bullets normalizados
    .replace(/\|/g, ' ')                    // tabelas viram texto corrido
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatListaPublica(creds) {
  if (!Array.isArray(creds) || !creds.length) return '';
  const linhas = creds
    .filter(c => c && c.nome && c.url_ref)
    .slice(0, MAX_ITENS)
    .map(c => `- ${c.nome}: ${c.url_ref}`);
  if (!linhas.length) return '';
  return `**Links dos sistemas do time:**\n${linhas.join('\n')}`;
}

function formatCredencialAdmin(cred, opts = {}) {
  if (!cred || !cred.nome) return '';
  const maxCampos = opts.maxCampos === undefined ? MAX_CAMPOS : opts.maxCampos;
  const linhas = [`*${cred.nome}*`];
  if (cred.servico) linhas.push(`Serviço: ${cred.servico}`);
  if (cred.url_ref) linhas.push(`Link: ${cred.url_ref}`);

  const campos = Array.isArray(cred.campos) ? cred.campos.filter(c => c && c.label) : [];
  const mostrados = campos.slice(0, maxCampos === Infinity ? campos.length : maxCampos);
  for (const c of mostrados) {
    linhas.push(`${c.label}: ${c.valor === undefined || c.valor === null ? '' : c.valor}`);
  }
  const restantes = campos.length - mostrados.length;
  if (restantes > 0) linhas.push(`_(mais ${restantes} campos — peça "todos os campos" pra ver)_`);

  const obs = mdParaWhatsapp(cred.observacoes);
  if (obs) linhas.push('', obs);
  return linhas.join('\n');
}

module.exports = { mdParaWhatsapp, formatListaPublica, formatCredencialAdmin, MAX_ITENS, MAX_CAMPOS };

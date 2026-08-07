// Marker <<PEDIR_CREDENCIAIS>> — o modelo sinaliza que precisa da lista de links de
// sistemas. Módulo PURO (sem I/O) pra ser testável sem tocar no Supabase.
// O engine faz o two-pass; aqui só detecção, limpeza e formatação.

const MAX_CREDENCIAIS = 30;

// Aceita com ou sem <<END>> — o modelo às vezes omite o fechamento.
const PEDIR_CREDENCIAIS_RE = /<<PEDIR_CREDENCIAIS>>(?:\s*<<END>>)?/i;
const PEDIR_CREDENCIAIS_RE_G = /<<PEDIR_CREDENCIAIS>>(?:\s*<<END>>)?/gi;

function hasPedirCredenciaisMarker(text) {
  if (!text || typeof text !== 'string') return false;
  return PEDIR_CREDENCIAIS_RE.test(text);
}

function stripPedirCredenciaisMarker(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(PEDIR_CREDENCIAIS_RE_G, ' ').replace(/\s+/g, ' ').trim();
}

function formatCredenciaisBlock(links) {
  if (!Array.isArray(links) || !links.length) return '';
  const linhas = links
    .filter(l => l && l.nome && l.url_ref)
    .slice(0, MAX_CREDENCIAIS)
    .map(l => `- ${l.nome}: ${l.url_ref}`);
  if (!linhas.length) return '';
  return `**Links dos sistemas do time:**\n${linhas.join('\n')}`;
}

module.exports = { hasPedirCredenciaisMarker, stripPedirCredenciaisMarker, formatCredenciaisBlock, MAX_CREDENCIAIS };

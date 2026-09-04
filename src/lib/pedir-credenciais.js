// Marker <<PEDIR_CREDENCIAIS>> — o modelo sinaliza que precisa da lista de links de
// sistemas. Módulo PURO (sem I/O) pra ser testável sem tocar no Supabase.
// O engine faz o two-pass; aqui só detecção e limpeza. Formatação mora em
// src/lib/credenciais-format.js (escopo por perfil vem de src/services/credenciais.js).

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

module.exports = { hasPedirCredenciaisMarker, stripPedirCredenciaisMarker };

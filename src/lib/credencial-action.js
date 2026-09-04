// Parser do marker <<CREDENCIAL_ACTION>>. Modulo PURO.
//
// O modelo PROPOE; quem decide e persiste e o engine. Este parser so valida
// forma — nunca decide se a escrita acontece. Payload invalido vira null, e o
// engine trata como "nao entendi" em vez de gravar lixo.

const ACOES_VALIDAS = new Set(['create', 'update', 'delete']);

// Os 8 valores aceitos pelo CHECK da coluna governance_credentials.categoria
// no banco. Fora daqui o INSERT quebra — por isso o parser normaliza e
// devolve null em vez de repassar lixo que o banco vai rejeitar.
const CATEGORIAS_VALIDAS = new Set(['whatsapp', 'api_key', 'token', 'vps', 'social', 'email', 'plataforma', 'outro']);

const RE_MARKER = /<<CREDENCIAL_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
const RE_MARKER_G = /<<CREDENCIAL_ACTION>>\s*[\s\S]*?\s*<<END>>/gi;

function _normalizaCampos(campos) {
  if (!Array.isArray(campos)) return [];
  return campos
    .filter(c => c && typeof c.label === 'string' && c.label.trim())
    .map(c => ({
      label: String(c.label).trim(),
      valor: c.valor === undefined || c.valor === null ? '' : String(c.valor),
      sensivel: Boolean(c.sensivel),
    }));
}

function _normalizaCategoria(categoria) {
  if (typeof categoria !== 'string') return null;
  const c = categoria.trim().toLowerCase();
  return CATEGORIAS_VALIDAS.has(c) ? c : null;
}

function parseCredencialAction(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(RE_MARKER);
  if (!m) return null;
  let json;
  try {
    json = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;

  const action = String(json.action || '').toLowerCase();
  if (!ACOES_VALIDAS.has(action)) return null;

  const nome = json.nome ? String(json.nome).trim() : '';
  const alvo = json.alvo ? String(json.alvo).trim() : '';

  if (action === 'create' && !nome) return null;
  if ((action === 'update' || action === 'delete') && !alvo) return null;

  return {
    action,
    nome,
    alvo,
    servico: json.servico ? String(json.servico).trim() : null,
    projeto: json.projeto ? String(json.projeto).trim() : null,
    url_ref: json.url_ref ? String(json.url_ref).trim() : null,
    observacoes: json.observacoes ? String(json.observacoes) : null,
    categoria: _normalizaCategoria(json.categoria),
    campos: _normalizaCampos(json.campos),
  };
}

function stripCredencialAction(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(RE_MARKER_G, '').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { parseCredencialAction, stripCredencialAction, ACOES_VALIDAS, CATEGORIAS_VALIDAS };

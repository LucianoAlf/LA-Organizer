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

  // Fail-closed: action precisa ser string de verdade. String(['create'])
  // vira 'create' e passaria pela validacao seguinte sem esse check.
  if (typeof json.action !== 'string') return null;
  const action = json.action.toLowerCase();
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

// Valor que e so marca de mascaramento: ●●●●●●, ***, ••••, ▪▪▪. Nao e senha — e o rastro
// visual que o proprio engine imprime quando esconde uma.
const VALOR_MASCARADO_RE = /^[\s]*[●•*·▪○◦x×]{3,}[\s]*$/u;

// Valor CORTADO: termina em reticencias, com ou sem o resto colado ("1041658696311-rdtd1q0…",
// "sk-abc123...", "AErty ...").
//
// Segunda porta do mesmo estrago, descoberta em 04/09: a analise de PRINT trunca. A imagem 2
// que o Hugo mandou as 16:58 voltou da visao assim:
//     “Client ID” = “1041658696311-rdtd1q0...”   “Refresh token” = “1//0h08sq2...”
// Gravar isso cria uma credencial que PARECE certa na tela e nao abre nada — e o erro so
// aparece no dia em que alguem precisa do acesso. Nenhum valor de credencial legitimo termina
// em reticencias, entao a regra e segura: aqui e sempre corte, nunca conteudo.
const VALOR_CORTADO_RE = /(?:\.\.\.|…)\s*$/u;

// Placeholder textual: a visao devolve o que estava ESCRITO na celula, e as vezes o que
// estava escrito era uma nota de onde o valor mora, nao o valor. Caso real da mesma imagem:
// “Client Secret” = “no JSON”.
const VALOR_PLACEHOLDER_RE = /^\s*(?:\[?\s*(?:n[oa]\s+json|no\s+arquivo|ver\s+json|vazio|em\s+branco|preencher|xxx+|todo|tbd)\s*\]?)\s*$/iu;

/**
 * A acao carrega algum campo cujo valor nao e o valor de verdade?
 *
 * A DEFESA CENTRAL contra o caso Hugo 04/09 15:40. O engine imprime a senha como ●●●●●● na
 * confirmacao; essa mensagem volta pro modelo no turno seguinte como se fosse fala dele
 * (system.js:4039 devolve todo outbound como role 'assistant'), e ele reproduz o ●●●●●● ao
 * imitar o formato. Se um marker montado a partir dessa imitacao passasse, a senha GRAVADA
 * viraria "●●●●●●" — a credencial existiria, pareceria certa na tela e nao serviria pra nada.
 *
 * Em 04/09 a mesma falha apareceu por OUTRA porta — o print truncado e o "no JSON" —, e o
 * estrago e identico. Por isso as tres formas saem pela mesma guarda: o que importa nao e de
 * onde veio o lixo, e que ele nao pode virar credencial.
 *
 * Mora aqui, no modulo puro, porque as DUAS camadas de recuperacao (o retry do mesmo turno e
 * o auto-resolve do turno seguinte) desembocam no mesmo executor. Guardar so numa delas
 * deixaria a outra aberta.
 *
 * @returns {string|null} o label do primeiro campo suspeito, ou null
 */
function _valorIncompleto(valor) {
  if (typeof valor !== 'string') return false;
  return VALOR_MASCARADO_RE.test(valor)
    || VALOR_CORTADO_RE.test(valor)
    || VALOR_PLACEHOLDER_RE.test(valor);
}

function temValorMascarado(acao) {
  if (!acao || !Array.isArray(acao.campos)) return null;
  for (const c of acao.campos) {
    if (c && _valorIncompleto(c.valor)) return String(c.label || 'campo').trim();
  }
  return null;
}

/**
 * Tira da acao os campos cujo valor nao e o valor de verdade, e diz quais foram.
 *
 * Ate 04/09 um campo incompleto derrubava a acao INTEIRA e o turno virava "manda esse campo
 * de novo". O Hugo reprovou: "tem que evitar o maximo de atrito possivel". E ele esta certo —
 * a propriedade que importa e o valor cortado NAO SER GRAVADO, nao a credencial inteira ser
 * recusada. Entao o campo ruim sai, o resto segue pra confirmacao normal, e a pessoa decide
 * no mesmo passo: confirma sem ele, ou manda o valor completo.
 *
 * Em `update` isso e ainda melhor que recusar: o campo removido nao entra no payload, entao o
 * valor que ja esta gravado SOBREVIVE — em vez de virar "..." por cima de uma senha boa.
 *
 * @returns {{acao: object, incompletos: string[]}} acao sem os campos ruins + labels tirados
 */
function separarCamposIncompletos(acao) {
  if (!acao || !Array.isArray(acao.campos)) return { acao, incompletos: [] };
  const bons = [];
  const incompletos = [];
  for (const c of acao.campos) {
    if (c && _valorIncompleto(c.valor)) incompletos.push(String(c.label || 'campo').trim());
    else bons.push(c);
  }
  if (!incompletos.length) return { acao, incompletos: [] };
  return { acao: { ...acao, campos: bons }, incompletos };
}

module.exports = {
  parseCredencialAction, stripCredencialAction, temValorMascarado, separarCamposIncompletos,
  ACOES_VALIDAS, CATEGORIAS_VALIDAS, VALOR_MASCARADO_RE, VALOR_CORTADO_RE, VALOR_PLACEHOLDER_RE,
};

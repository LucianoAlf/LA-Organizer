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
    .replace(/\*\*(.+?)\*\*/g, '*$1*')      // bold md → bold wa (PRIMEIRO)
    .replace(/^#{1,6}\s*(.+)$/gm, (_m, txt) => `*${txt.replace(/\*+/g, '').trim()}*`)   // headings → bold (remove * do conteúdo)
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
  // LAOR-2 item 1: o globo marca o que o TIME INTEIRO tambem enxerga (so nome e link — os
  // campos nunca saem no escopo publico). Marcamos so as publicas: sao a minoria (3 de 46 em
  // 04/09) e marcar as 43 restritas viraria ruido em toda listagem.
  const linhas = [`*${cred.visivel_tom === true ? '🌐 ' : ''}${cred.nome}*`];
  if (cred.servico) linhas.push(`Serviço: ${cred.servico}`);
  if (cred.url_ref) linhas.push(`Link: ${cred.url_ref}`);

  const campos = Array.isArray(cred.campos) ? cred.campos.filter(c => c && c.label) : [];
  const mostrados = campos.slice(0, maxCampos === Infinity ? campos.length : maxCampos);
  for (const c of mostrados) {
    linhas.push(`${c.label}: ${c.valor === undefined || c.valor === null ? '' : c.valor}`);
  }
  const restantes = campos.length - mostrados.length;
  if (restantes > 0) linhas.push(`_(mais ${restantes} campos)_`);

  const obs = mdParaWhatsapp(cred.observacoes);
  if (obs) linhas.push('', obs);
  return linhas.join('\n');
}

// Quantos nomes da lista aparecem na resposta final. Proxy DETERMINISTICO pra "isso foi uma
// listagem" — e o rodape so faz sentido em listagem. Numa pergunta pontual ("qual a senha do
// Canva?") um rodape de visibilidade seria ruido em todo turno.
//
// Compara pelo NUCLEO do nome (o que vem antes do travessao) e normalizado, porque o modelo
// reescreve a lista com as proprias palavras: "LA Performance Report — ERP principal" costuma
// voltar so como "LA Performance Report".
function _normalizar(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function _nucleo(nome) {
  return _normalizar(String(nome || '').split(/[—–-]/)[0]);
}

function contarNomesNaResposta(creds, resposta) {
  if (!Array.isArray(creds) || !creds.length) return 0;
  const alvo = _normalizar(resposta);
  if (!alvo) return 0;
  let n = 0;
  const vistos = new Set();
  for (const c of creds) {
    const nuc = _nucleo(c && c.nome);
    if (nuc.length < 3 || vistos.has(nuc)) continue;
    if (alvo.includes(nuc)) { vistos.add(nuc); n += 1; }
  }
  return n;
}

const MAX_NOMES_RODAPE = 5;

/**
 * Rodape que diz, em uma linha, o que o TIME enxerga daquela lista.
 *
 * O caso que originou isto (Hugo, 04/09): ele pediu "quais links voce tem", recebeu as 46 —
 * correto, ele e admin — e nao tinha como saber que o time so enxerga 3. O estado ficava
 * invisivel, e por isso as 3 marcadas ficaram congeladas desde 07/08 sem ninguem revisar.
 *
 * DETERMINISTICO de proposito: o globo dentro do bloco depende de o modelo preservar a
 * marcacao ao reescrever no 2o passe, e ele pode nao preservar. Este rodape e colado pelo
 * engine DEPOIS, com os nomes por extenso — entao a informacao chega inteira mesmo quando o
 * globo some. Mesma logica do executor de escrita: o que importa nao fica na mao do modelo.
 *
 * @param {Array} creds     lista do escopo admin (com visivel_tom)
 * @param {string} resposta texto final que vai pro usuario
 * @returns {string} '' quando nao e listagem
 */
function rodapeVisibilidade(creds, resposta) {
  if (!Array.isArray(creds) || creds.length < 2) return '';
  if (contarNomesNaResposta(creds, resposta) < 2) return '';
  const publicas = creds.filter(c => c && c.visivel_tom === true && c.nome);
  const total = creds.length;
  // Zero publicas tambem e informacao — e a mais surpreendente das duas.
  if (!publicas.length) return '_Nenhuma dessas o time enxerga — todas são só diretoria._';
  const nomes = publicas.slice(0, MAX_NOMES_RODAPE).map(c => c.nome);
  const resto = publicas.length - nomes.length;
  const lista = nomes.join(', ') + (resto > 0 ? ` e mais ${resto}` : '');
  return `_🌐 = o time também vê (só o nome e o link). ${publicas.length} de ${total}: ${lista}._`;
}

module.exports = {
  mdParaWhatsapp, formatListaPublica, formatCredencialAdmin,
  rodapeVisibilidade, contarNomesNaResposta,
  MAX_ITENS, MAX_CAMPOS, MAX_NOMES_RODAPE,
};

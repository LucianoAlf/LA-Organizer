// Casamento deterministico de credencial proposta contra as existentes.
// Modulo PURO — o engine faz a busca e passa a lista.
//
// Deterministico de proposito: o TASK_UPDATE erra 14% deixando o modelo
// escolher o alvo. Aqui a escolha e do codigo, e havendo duvida o engine
// pergunta em vez de chutar.
//
// ---------------------------------------------------------------------------
// LAOR-3 (04/09) — IDENTIDADE E O SISTEMA, NAO O SEGREDO
//
// O caso: Hugo pediu pra cadastrar "conta do ADS Google" e o TOM respondeu que ja existia
// algo parecido — listando "Dominio — registro.br", "Mila Openclaw" e "Mila Supabase",
// todas por "mesmo valor no campo Senha". As tres nao tem relacao nenhuma com o Google Ads;
// o que elas compartilham e uma senha REAPROVEITADA. Resultado medido: a credencial nunca
// foi criada. Um falso positivo bloqueou um cadastro legitimo.
//
// A regra antiga casava QUALQUER valor de campo repetido. O comentario dizia "(e-mail/login
// ja cadastrado)", mas o codigo aceitava todo campo. Varrendo a tabela inteira, os valores
// repetidos entre cadastros eram:
//   Custo/mes igual em 4 · Dispositivo igual em 4 · Integracao igual em 5 ·
//   Usuario=admin em 2 · senhas reaproveitadas em 4 e em 5 cadastros.
// Ou seja: dois cadastros que custam o mesmo por mes eram "alta duplicata".
//
// O que mudou:
//   - So campo de IDENTIDADE participa (rotulo de identidade E valor que identifica).
//     Custo, dispositivo e integracao saem pelo rotulo; "admin" e "root" saem pelo valor.
//   - Campo SENSIVEL nao gera duplicata nenhuma. Senha igual e reuso de senha — informacao
//     util, mas nao e motivo pra oferecer merge. Sai por `acharReusoDeSegredo`, que o engine
//     mostra como aviso na confirmacao normal de criacao.
//   - Identidade igual SOZINHA virou `media`, nao `alta`. Evidencia da propria base: "Chave
//     openai" e "Gmail — Escola de Musica LA" compartilham o mesmo e-mail e sao credenciais
//     diferentes (uma chave de API e uma conta). Vira `alta` so quando o host do link ou o
//     servico tambem batem — ai e a mesma conta no mesmo sistema.
//   - Nome parecido ganhou tamanho minimo: "Sol" (3 letras) casava com quase tudo.
// ---------------------------------------------------------------------------

function _norm(s) {
  return String(s === undefined || s === null ? '' : s).trim().toLowerCase();
}

// I-1 (review 04/09): o `motivo` vai INTEIRO pra tela do WhatsApp. Quando o campo que
// casou e um segredo, citar o VALOR devolvia a senha em claro na lista de duplicatas
// ("mesmo valor de campo: hunter2") — justo o que esta feature existe pra proteger.
// A flag `sensivel` e o contrato, mas a lista ja cadastrada tem campo "Senha" sem flag
// nenhuma, entao o label tambem denuncia. Segue valendo no aviso de reuso.
const LABEL_SENSIVEL_RE = /senha|password|passwd|secret|token|api[\s_-]*key|chave|credencial|\bpin\b/i;

// Rotulo que aponta QUEM e a conta. Custo/mes, Dispositivo, Integracao, Observacao e
// afins nao entram — eles descrevem a credencial, nao a identificam.
const LABEL_IDENTIDADE_RE = /e-?mail|\blogin\b|usu[áa]ri|\buser(?:name)?\b|\bconta\b|account|telefone|celular|\bphone\b|\bn[uú]mero\b/i;

// Valores que aparecem em todo lugar e nao identificam ninguem. Sem esta lista, os dois
// cadastros de WordPress com usuario "admin" casavam como duplicata forte.
const VALOR_LIXO = new Set([
  'admin', 'administrator', 'administrador', 'root', 'user', 'usuario', 'usuário',
  'teste', 'test', 'n/a', 'na', 'none', 'null', 'nenhum', 'sim', 'nao', 'não', '-', '--', 'x',
]);

// Nome menor que isto casa por conter/estar contido em coisa demais ("Sol", "LA", "Tom").
const MIN_NOME_PARECIDO = 4;

function _ehSensivel(campo) {
  if (!campo) return false;
  return Boolean(campo.sensivel) || LABEL_SENSIVEL_RE.test(String(campo.label || ''));
}

function _valorIdentifica(valor) {
  const v = _norm(valor);
  if (!v || VALOR_LIXO.has(v)) return false;
  if (v.includes('@')) return true;     // e-mail identifica mesmo sendo curto
  return v.length >= 6;
}

function _ehIdentidade(campo) {
  if (!campo) return false;
  if (_ehSensivel(campo)) return false;  // senha nunca identifica a conta — ela protege
  return LABEL_IDENTIDADE_RE.test(String(campo.label || '')) && _valorIdentifica(campo.valor);
}

// Host do link, sem protocolo, credencial embutida, porta, caminho nem www.
function _host(url) {
  const s = _norm(url);
  if (!s) return '';
  const semProto = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const host = semProto.split(/[/?#]/)[0].split('@').pop().split(':')[0];
  return host.replace(/^www\./, '');
}

// valor normalizado -> campo original, so dos campos de IDENTIDADE (primeira ocorrencia
// vence, preservando a ordem de declaracao).
function _indiceIdentidade(cred) {
  const m = new Map();
  if (!cred || !Array.isArray(cred.campos)) return m;
  for (const c of cred.campos) {
    if (!_ehIdentidade(c)) continue;
    const v = _norm(c.valor);
    if (v && !m.has(v)) m.set(v, c);
  }
  return m;
}

const ORDEM = { alta: 0, media: 1, baixa: 2 };

function acharDuplicatas(proposta, existentes) {
  if (!proposta || !Array.isArray(existentes)) return [];
  const achados = new Map(); // id -> {cred, motivo, forca}

  const registra = (cred, motivo, forca) => {
    const atual = achados.get(cred.id);
    if (!atual || ORDEM[forca] < ORDEM[atual.forca]) achados.set(cred.id, { cred, motivo, forca });
  };

  const idProp = _indiceIdentidade(proposta);
  const hostProp = _host(proposta.url_ref);
  const nomeProp = _norm(proposta.nome);
  const servProp = _norm(proposta.servico);
  const projProp = _norm(proposta.projeto);

  for (const c of existentes) {
    if (!c || !c.id) continue;

    const idEx = _indiceIdentidade(c);
    let bate = null;
    for (const [v, campoProp] of idProp) {
      const campoEx = idEx.get(v);
      if (campoEx) { bate = { v, campoProp, campoEx }; break; }
    }
    const hostEx = _host(c.url_ref);
    const mesmoHost = Boolean(hostProp) && hostProp === hostEx;
    const mesmoServico = Boolean(servProp) && _norm(c.servico) === servProp;

    // ALTA: a MESMA conta no MESMO sistema. So aqui faz sentido oferecer update.
    if (bate && (mesmoHost || mesmoServico)) {
      registra(c, `mesma conta (${bate.v}) em ${mesmoHost ? hostEx : c.servico}`, 'alta');
      continue;
    }

    // MEDIA: identidade igual em sistema diferente (a mesma pessoa tem conta nos dois),
    // ou o par servico+projeto.
    if (bate) {
      const _label = String((bate.campoEx && bate.campoEx.label) || (bate.campoProp && bate.campoProp.label) || 'campo').trim();
      registra(c, `mesmo ${_label}: ${bate.v}`, 'media');
      continue;
    }
    // "Mesmo host SOZINHO" foi testado contra as 46 e REPROVADO: gerava 12 pares novos, e os
    // piores eram os hosts genericos — tres contas de Gmail diferentes viravam "parecidas" so
    // por morarem em mail.google.com. O caso que ele existiria pra pegar (recadastro do mesmo
    // sistema) ja e coberto por host+identidade = alta, logo acima. Mantido so como reforco
    // de `alta`, nunca como sinal proprio. Nao reintroduzir sem rodar a prova de novo.
    if (servProp && projProp && _norm(c.servico) === servProp && _norm(c.projeto) === projProp) {
      registra(c, `mesmo serviço e projeto: ${c.servico} / ${c.projeto}`, 'media');
      continue;
    }

    // BAIXA: nome de um contido no do outro, com tamanho minimo dos dois lados.
    const nomeEx = _norm(c.nome);
    if (nomeProp.length >= MIN_NOME_PARECIDO && nomeEx.length >= MIN_NOME_PARECIDO
        && (nomeEx.includes(nomeProp) || nomeProp.includes(nomeEx))) {
      registra(c, `nome parecido: ${c.nome}`, 'baixa');
    }
  }

  return [...achados.values()].sort((a, b) => ORDEM[a.forca] - ORDEM[b.forca]);
}

/**
 * Credenciais que ja usam o MESMO SEGREDO da proposta.
 *
 * Nao e duplicata — e reuso de senha, e o engine mostra isso como AVISO dentro da
 * confirmacao normal de criacao, em vez de virar obstaculo. Foi o obstaculo que impediu o
 * cadastro do Google Ads em 04/09.
 *
 * NUNCA devolve o valor: so a credencial e o rotulo do campo. O texto daqui vai inteiro pro
 * WhatsApp, e devolver o segredo derrubaria o proposito da feature (era o achado I-1).
 *
 * @returns {Array<{cred: object, label: string}>}
 */
function acharReusoDeSegredo(proposta, existentes) {
  if (!proposta || !Array.isArray(existentes)) return [];
  if (!Array.isArray(proposta.campos)) return [];

  const segredos = new Map();  // valor normalizado -> label do campo da PROPOSTA
  for (const c of proposta.campos) {
    if (!_ehSensivel(c)) continue;
    const v = _norm(c.valor);
    if (v && !segredos.has(v)) segredos.set(v, String((c && c.label) || 'campo').trim());
  }
  if (!segredos.size) return [];

  const achados = [];
  for (const c of existentes) {
    if (!c || !c.id || !Array.isArray(c.campos)) continue;
    for (const campo of c.campos) {
      if (!_ehSensivel(campo)) continue;
      const label = segredos.get(_norm(campo.valor));
      if (label) { achados.push({ cred: c, label }); break; }
    }
  }
  return achados;
}

// Normalizacao SO DE NOME. Deliberadamente separada de `_norm`: aquela tambem normaliza
// VALOR de campo, e tirar acento/pontuacao de senha faria segredos diferentes colidirem
// ("Alfa#1" e "alfa1" virariam a mesma coisa no aviso de reuso). Aqui o alvo do casamento e
// nome de sistema escrito por gente e reescrito por modelo, entao vale o contrario:
//   - acento fora ("Música" = "Musica");
//   - travessao/en-dash/hifen viram o mesmo separador (o modelo devolve "—" onde o cadastro
//     tem "-", e o `includes` cru errava por causa de UM caractere);
//   - aspas curvas e pontuacao de borda fora;
//   - espaco colapsado.
function _normNome(s) {
  return String(s === undefined || s === null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[“”‘’«»"'`]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s\-.:,;]+|[\s\-.:,;]+$/g, '');
}

// Palavras que aparecem em quase todo nome de credencial da base e por isso nao servem de
// evidencia de que dois nomes falam do mesmo sistema.
const TOKEN_VAZIO = new Set(['la', 'music', 'da', 'de', 'do', 'das', 'dos', 'e', 'o', 'a', 'para', 'pra', 'com', 'conta', 'credencial', 'login', 'acesso']);
const MIN_TOKEN = 3;

function _tokensNome(s) {
  return _normNome(s).split(/[^a-z0-9]+/).filter(t => t.length >= MIN_TOKEN && !TOKEN_VAZIO.has(t));
}

/**
 * Casa o `alvo` proposto pelo modelo contra as credenciais existentes.
 *
 * Tres passadas, da mais forte pra mais fraca. A escolha continua sendo do codigo, e
 * havendo mais de um candidato quem decide e a pessoa — nunca o chute.
 *
 * A 3a passada (tokens em comum) entrou em 04/09: o modelo escreve o nome com as proprias
 * palavras ("Google Ads API — LA Music" pro cadastro "Google Ads API - LA Music", ou so
 * "Google Ads API"), e o `includes` cru reprovava por pontuacao. Reprovar ali custa caro:
 * o turno terminava com "me diz o nome exato", jogando no usuario um trabalho que o engine
 * tinha como fazer — ele esta com a lista inteira na mao.
 */
function acharAlvo(termo, existentes) {
  if (!termo || !Array.isArray(existentes)) return { exato: null, candidatos: [] };
  const t = _normNome(termo);
  if (!t) return { exato: null, candidatos: [] };

  const exato = existentes.find(c => c && _normNome(c.nome) === t) || null;
  if (exato) return { exato, candidatos: [] };

  // Contem: o termo dentro do nome cadastrado, ou o nome cadastrado dentro do termo
  // (o modelo as vezes acrescenta o servico: "Canva — criativos (Canva)").
  const contem = existentes.filter(c => {
    if (!c) return false;
    const n = _normNome(c.nome);
    if (!n) return false;
    return n.includes(t) || (t.length >= MIN_NOME_PARECIDO && t.includes(n));
  });
  if (contem.length) return { exato: null, candidatos: contem };

  // Tokens significativos em comum. Exige 2+ pra nao casar por "google" sozinho, que
  // aparece em 6 cadastros. Ordena pelo numero de tokens em comum: a lista que vai pra
  // tela comeca pelo mais provavel.
  const alvoTokens = _tokensNome(termo);
  if (alvoTokens.length < 2) return { exato: null, candidatos: [] };
  const porScore = [];
  for (const c of existentes) {
    if (!c) continue;
    const nt = new Set(_tokensNome(c.nome));
    const score = alvoTokens.filter(x => nt.has(x)).length;
    if (score >= 2) porScore.push({ c, score });
  }
  porScore.sort((a, b) => b.score - a.score);
  return { exato: null, candidatos: porScore.map(x => x.c) };
}

module.exports = {
  acharDuplicatas, acharAlvo, acharReusoDeSegredo, _normNome, _tokensNome,
  LABEL_SENSIVEL_RE, LABEL_IDENTIDADE_RE, VALOR_LIXO, MIN_NOME_PARECIDO,
};

// Redacao deterministica de valores sensiveis em texto livre.
//
// POR QUE NA ENTRADA, e nao no ponto de gravacao: engine.js grava os 200
// primeiros chars da mensagem em marker_logs.reason quando o TOM deixa de
// emitir marker para uma mensagem acionavel; o check actionable_no_marker le
// esse campo e o relatorio das 7h o transmite por WhatsApp. Redigir so no
// conversation_history deixaria esse caminho aberto.
//
// DETERMINISTICO de proposito: nao depende de o modelo reconhecer que a
// mensagem tem credencial. O reconhecimento do modelo falha exatamente no
// cenario em que o vazamento acontece.
//
// FIX ROUND 1 (review achou C-1/C-2/C-3/I-1, todos reais, reproduzidos): a
// versao anterior usava uma unica regex "rotulo-conhecido + resto da linha",
// e vazava em 4 formatos comuns de print/OCR e mensagem de WhatsApp:
//   C-1: print de tela de login renderiza "Senha:" numa linha e o valor na
//        seguinte -- a regex antiga exigia os dois na mesma linha.
//   C-2: "senha_wifi", "minha_senha", "MinhaSenha", "SENHA_ADMIN" tem o
//        rotulo colado a outra palavra -- a regex antiga so casava fronteira
//        limpa (word boundary) antes do rotulo.
//   C-3: ";" como separador nao era aceito (so ":", "=" e espaco).
//   I-1: numa linha com dois campos ("senha: abc token: xyz"), o valor do
//        primeiro campo era guloso e engolia o rotulo inteiro do segundo.
//
// Reescrito como scanner por linha (nao mais uma unica regex-substituicao):
// acha o proximo "campo" (token de nome + separador), decide se o token
// "contem" um rotulo conhecido (nao precisa ser IGUAL -- ver ROTULOS_BASE),
// e para o valor no fim da linha OU no inicio do proximo campo valido,
// o que vier primeiro. Se sobrar so espaco em branco ate o fim da linha
// depois do separador, o valor e a proxima linha nao-vazia inteira.

const MASCARA = '***';

// Usados como CONTAINS (nao igualdade) contra o token de nome de campo --
// a sequencia [A-Za-z0-9_-] imediatamente antes do separador, normalizada em
// minusculo e sem "_"/"-". De proposito permissivo (C-2): perder precisao
// tipo mascarar "resenha: x" e aceitavel; deixar "senha_wifi" vazar nao e.
const ROTULOS_BASE = ['senha', 'password', 'passwd', 'pwd', 'token', 'apikey', 'chave', 'secret', 'segredo'];

// "api key" tem espaco de verdade entre as palavras -- nao cai na classe de
// caracteres [A-Za-z0-9_-] do token generico, entao tem regra propria.
const RE_API_KEY = /^api[ _-]?key$/i;

function _normalizaToken(tok) {
  return String(tok).toLowerCase().replace(/[_-]/g, '');
}

function _tokenValido(tok) {
  if (RE_API_KEY.test(tok)) return true;
  const norm = _normalizaToken(tok);
  return ROTULOS_BASE.some(r => norm.includes(r));
}

// <token><separador>. A fronteira antes do token e lookbehind (nao consome
// caractere) de proposito: se fosse capturada e consumida, o candidato
// seguinte na mesma linha perderia a fronteira que o candidato anterior
// "comeu" -- e e exatamente esse o motivo do I-1. Separador: ":", "=", ";"
// ou um espaco/tab (aceita zero ou mais espacos/tabs soltos antes dele).
const RE_CAMPO = /(?:^|(?<=[\s(\[]))(api[ _-]?key|[A-Za-z0-9_-]+)[ \t]*([:=;]|[ \t])/gi;

function _acharProximoCampo(linha, from) {
  RE_CAMPO.lastIndex = from;
  let m;
  while ((m = RE_CAMPO.exec(linha))) {
    if (_tokenValido(m[1])) {
      return { start: m.index, matchEnd: RE_CAMPO.lastIndex, token: m[1], sepChar: m[2] };
    }
    // Token invalido: o regex global ja avancou lastIndex sozinho: a proxima
    // tentativa ainda enxerga a fronteira real via lookbehind (nao depende
    // do que este match "consumiu").
  }
  return null;
}

function _processaLinha(linha) {
  let achou = false;
  let pendente = false;
  let out = '';
  let pos = 0;

  while (pos < linha.length) {
    const campo = _acharProximoCampo(linha, pos);
    if (!campo) {
      out += linha.slice(pos);
      pos = linha.length;
      break;
    }

    out += linha.slice(pos, campo.start);

    const sepEhPontuacao = campo.sepChar === ':' || campo.sepChar === '=' || campo.sepChar === ';';
    // I-1: o valor deste campo para no proximo campo valido da mesma linha,
    // nao no fim dela -- senao engole o rotulo seguinte inteiro.
    const proximo = _acharProximoCampo(linha, campo.matchEnd);
    const valorEnd = proximo ? proximo.start : linha.length;
    const valorRaw = linha.slice(campo.matchEnd, valorEnd);
    const v = valorRaw.trim();
    const sepOut = /\s/.test(campo.sepChar) ? ' ' : `${campo.sepChar} `;

    if (!v) {
      // C-1: separador de pontuacao e nada mais na linha -- o valor pode
      // estar na proxima linha nao vazia (print de tela de login).
      if (sepEhPontuacao && !proximo) pendente = true;
      out += linha.slice(campo.start, valorEnd);
      pos = valorEnd;
      continue;
    }

    if (/^[?!.]/.test(v) || /\?$/.test(v)) {
      // Pergunta ("qual a senha do chatwoot?") nao tem valor a redigir.
      out += linha.slice(campo.start, valorEnd);
      pos = valorEnd;
      continue;
    }

    achou = true;
    out += `${campo.token}${sepOut}${MASCARA}`;
    // Preserva o espaco entre esta credencial e a proxima (I-1): sem isso
    // "senha: abc token: xyz" vira "senha: ***token: ***" (sem espaco).
    const espacoFinal = valorRaw.length - valorRaw.replace(/\s+$/, '').length;
    pos = valorEnd - espacoFinal;
  }

  return { texto: out, achou, pendente };
}

function redigirSegredos(texto) {
  if (!texto || typeof texto !== 'string') return { texto: '', achou: false };

  const partes = texto.split(/(\r\n|\r|\n)/); // conteudo e separador de linha alternados
  let achou = false;
  let aguardandoValor = false;

  for (let i = 0; i < partes.length; i += 2) {
    const linha = partes[i];

    if (aguardandoValor) {
      if (linha.trim() === '') continue; // linha em branco: segue esperando
      partes[i] = MASCARA; // C-1: a linha inteira e o valor do rotulo anterior
      achou = true;
      aguardandoValor = false;
      continue;
    }

    const r = _processaLinha(linha);
    partes[i] = r.texto;
    if (r.achou) achou = true;
    if (r.pendente) aguardandoValor = true;
  }

  return { texto: partes.join(''), achou };
}

module.exports = { redigirSegredos, MASCARA };

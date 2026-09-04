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
// FIX ROUND 1 (C-1/C-2/C-3/I-1): rotulo e valor podem estar em linhas
// diferentes (print de tela de login), rotulo pode estar colado a outra
// palavra (senha_wifi, MinhaSenha), ";" tambem e separador, e valor de um
// campo nao pode engolir o rotulo do campo seguinte na mesma linha.
//
// FIX ROUND 2 (C-4/C-5/C-6): a correcao do C-1 tratava "rotulo pendente"
// como um unico slot -- quando vinham DOIS rotulos empilhados sem valor
// (exatamente o formato de print de tela: "Usuario:" / "Senha:" / "Token:"
// cada um numa linha, valores depois), o segundo rotulo era consumido como
// se fosse o valor do primeiro, e o valor de verdade saia em claro. Agora
// rotulos pendentes formam uma FILA: acumula enquanto as linhas parecerem
// "NomeDeCampo:" sem valor (mesmo que o nome nao seja um rotulo de segredo
// conhecido, tipo "Login:" -- ele so nao teria disparado sozinho), e ao
// achar a primeira linha que nao e rotulo, mascara as proximas K linhas
// nao-vazias (K = tamanho do bloco acumulado), desde que ALGUM rotulo do
// bloco seja de segredo -- senao nao ha motivo pra suspeitar de credencial
// vindo e a fila e descartada sem mascarar nada.
// Tambem corrigido: (C-5) a guarda de pergunta ("nao e valor") agora vale
// no caminho entre linhas, nao so na mesma linha; e uma linha so vira
// "rotulo pendente" se tiver ate 3 palavras antes do separador -- senao
// "Deixa eu te contar um segredo:" apaga a proxima linha da conversa.
// (C-6) com separador ESPACO (nao ":"/"="/";"), so dispara se o valor for
// um unico token sem espaco com 4+ caracteres -- senao frase idiomatica tipo
// "a chave da porta esta emprestada" vira "a chave ***".

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

// Linha inteira igual a "ate 3 palavras" + separador de pontuacao + nada
// alem de espaco ate o fim. Usado para: (a) C-5, so promove uma linha a
// "rotulo pendente" se tiver essa cara -- senao uma frase que termina em
// "segredo:" (6 palavras) apaga a linha seguinte inteira; (b) fila do C-4,
// pra reconhecer linhas tipo "Login:" que nao sao rotulo de segredo mas
// ainda fazem parte do bloco de campos empilhados.
const RE_FORMA_ROTULO = /^[ \t]*((?:\S+[ \t]+){0,2}\S+)[ \t]*[:=;][ \t]*$/;

function _ehPergunta(v) {
  return /^[?!.]/.test(v) || /\?$/.test(v);
}

// C-6: com separador de pontuacao, comportamento de sempre. Com espaco, so
// conta como valor se for um unico token colado (sem espaco) e com 4+
// caracteres -- formato real de credencial colada, nao de frase comum.
function _valorQualifica(sepEhPontuacao, v) {
  if (sepEhPontuacao) return true;
  return !/\s/.test(v) && v.length >= 4;
}

function _acharProximoCampo(linha, from) {
  RE_CAMPO.lastIndex = from;
  let m;
  while ((m = RE_CAMPO.exec(linha))) {
    if (_tokenValido(m[1])) {
      return { start: m.index, matchEnd: RE_CAMPO.lastIndex, token: m[1], sepChar: m[2] };
    }
    // Token invalido: o regex global ja avancou lastIndex sozinho; a proxima
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
      // C-5: so conta como "rotulo pendente" se a linha toda parecer nome
      // de campo (ate 3 palavras) -- ver RE_FORMA_ROTULO.
      if (sepEhPontuacao && !proximo && RE_FORMA_ROTULO.test(linha)) pendente = true;
      out += linha.slice(campo.start, valorEnd);
      pos = valorEnd;
      continue;
    }

    if (_ehPergunta(v) || !_valorQualifica(sepEhPontuacao, v)) {
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

  // Fila de rotulos pendentes (C-4): filaTamanho conta quantas linhas
  // seguidas parecem "NomeDeCampo:" sem valor; filaTemSecreto marca se
  // alguma delas e de fato um rotulo de segredo conhecido (Senha, Token...).
  // "Login:" sozinho entra na conta do tamanho mas nao liga filaTemSecreto.
  let filaTamanho = 0;
  let filaTemSecreto = false;
  // Depois que a fila fecha (achou a primeira linha que nao e rotulo), esta
  // e as proximas `restante` linhas nao-vazias sao mascaradas.
  let restante = 0;

  for (let i = 0; i < partes.length; i += 2) {
    const linha = partes[i];

    if (restante > 0) {
      if (linha.trim() === '') continue; // linha em branco nao conta como valor
      const v = linha.trim();
      if (_ehPergunta(v)) {
        // C-5: frase solta (pergunta) nao e o valor esperado -- aborta o
        // consumo em vez de mascarar algo que pode ser so conversa normal.
        restante = 0;
        continue;
      }
      partes[i] = MASCARA;
      achou = true;
      restante -= 1;
      continue;
    }

    const r = _processaLinha(linha);
    partes[i] = r.texto;
    if (r.achou) achou = true;

    const pareceRotulo = RE_FORMA_ROTULO.test(linha);
    if (pareceRotulo) {
      filaTamanho += 1;
      if (r.pendente) filaTemSecreto = true;
    } else if (linha.trim() !== '') {
      // Primeira linha que nao parece rotulo: fecha o bloco acumulado.
      if (filaTamanho > 0 && filaTemSecreto) {
        const v = linha.trim();
        if (!_ehPergunta(v)) {
          partes[i] = MASCARA;
          achou = true;
          restante = filaTamanho - 1; // esta linha ja foi consumida agora
        }
        // Se for pergunta (C-5), abandona o bloco sem mascarar nada.
      }
      filaTamanho = 0;
      filaTemSecreto = false;
    }
    // Linha em branco no meio do bloco: nao conta e nao fecha, so espera.
  }

  return { texto: partes.join(''), achou };
}

module.exports = { redigirSegredos, MASCARA };

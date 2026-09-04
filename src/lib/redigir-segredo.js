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
// REGRA DE OURO: na duvida entre mascarar demais e mascarar de menos,
// mascara demais. Perder texto de diagnostico e barato; vazar senha nao e.
//
// ---------------------------------------------------------------------------
// DESENHO (round 4) -- por que a "fila de rotulos pendentes" foi jogada fora
// ---------------------------------------------------------------------------
// Os rounds 1..3 mantinham uma fila de rotulos pendentes e classificavam uma
// linha como "rotulo" pela FORMA (ate 3 palavras + separador + nada depois),
// sem checar se a palavra era de fato um rotulo de segredo. Isso vazava dos
// dois lados:
//   'Senha:\nhunter2:\nrealvalue' -> 'Senha:\nhunter2:\n***'  (hunter2 lido
//        como rotulo e devolvido em claro)
//   'Senha:\nhunter2:'           -> intacto, achou=false      (vaza e nem
//        sinaliza)
//   'Senha:\nToken:\nvou te mandar por email.\nfalou.' apagava 2 frases de
//        conversa real, porque o tamanho do bloco (K) mandava consumir N
//        linhas seguintes independente do que elas fossem.
//
// O desenho novo nao conta rotulos e nao tem K. Sao duas maquinas:
//
//   (A) MESMA LINHA -- inalterada desde o round 1/2:
//       <nome do campo><separador><valor>. Dispara se o token de nome de campo
//       imediatamente antes do separador, normalizado (minusculo, sem "_"/"-"),
//       CONTIVER um dos rotulos conhecidos. Separadores ":", "=", ";" e espaco;
//       com espaco so dispara se o valor for um unico token sem espacos com 4+
//       caracteres. Dois campos na mesma linha mascaram separadamente.
//
//   (B) MODO "as proximas linhas sao valores":
//       - LIGA quando uma linha e <nome do campo><separador de pontuacao> e
//         nada depois, E esse nome contem um rotulo CONHECIDO. Forma sozinha
//         nunca liga o modo -- essa e a correcao da causa raiz.
//       - Com o modo ligado, cada linha nao vazia e mascarada INTEIRA, sem
//         tentar adivinhar se ela e "mais um rotulo". 'hunter2:' mascara,
//         'Token:' mascara. Perder o rotulo no log e sobre-redacao aceitavel.
//       - DESLIGA por prosa: linha com 3+ palavras que nao termina em "?".
//         Ela nao e mascarada e fecha o modo -- e o que devolve
//         'vou te mandar por email.' ao log.
//       - DESLIGA por teto: depois de 5 linhas mascaradas.
//       - PERGUNTA e pulada, nao fecha: linha que termina em "?" (ou comeca
//         com "?"/"!"/"."), com orcamento de 3 pulos. Preserva
//         'Senha:\nvoce pode ajudar?\nhunter2'.
//       - Linha em branco nao mascara, nao gasta orcamento e nao fecha.
//       - Linha nao mascarada (prosa ou pergunta) ainda passa pela maquina (A):
//         'Senha:\naqui esta a minha token: xyz123' fecha o modo por prosa mas
//         o campo inline continua sendo mascarado.

const MASCARA = '***';

// Usados como CONTAINS (nao igualdade) contra o token de nome de campo --
// a sequencia [A-Za-z0-9_-] imediatamente antes do separador, normalizada em
// minusculo e sem "_"/"-". De proposito permissivo: perder precisao tipo
// mascarar "resenha: x" e aceitavel; deixar "senha_wifi" vazar nao e.
const ROTULOS_BASE = ['senha', 'password', 'passwd', 'pwd', 'token', 'apikey', 'chave', 'secret', 'segredo'];

// "api key" tem espaco de verdade entre as palavras -- nao cai na classe de
// caracteres [A-Za-z0-9_-] do token generico, entao tem regra propria.
const RE_API_KEY = /^api[ _-]?key$/i;

// Teto de linhas mascaradas pelo modo antes de ele fechar sozinho.
const TETO_MASCARAS = 5;
// Orcamento de linhas-pergunta que o modo pode pular antes de fechar.
const ORCAMENTO_PULOS = 3;
// A partir de quantas palavras uma linha nao-pergunta conta como prosa.
const MIN_PALAVRAS_PROSA = 3;

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
// "comeu". Separador: ":", "=", ";" ou um espaco/tab (aceita zero ou mais
// espacos/tabs soltos antes dele).
const RE_CAMPO = /(?:^|(?<=[\s(\[]))(api[ _-]?key|[A-Za-z0-9_-]+)[ \t]*([:=;]|[ \t])/gi;

function _ehPergunta(v) {
  return /^[?!.]/.test(v) || /\?$/.test(v);
}

function _contaPalavras(v) {
  const t = v.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

// Prosa = conversa de verdade, nao valor de campo. Quem chama ja descartou o
// caso pergunta (que termina em "?"), entao aqui basta a contagem de palavras.
function _ehProsa(v) {
  return _contaPalavras(v) >= MIN_PALAVRAS_PROSA;
}

// Com separador de pontuacao, qualquer resto de linha conta como valor. Com
// ESPACO, so conta se for um unico token colado (sem espaco) e com 4+
// caracteres -- formato real de credencial colada, nao de frase comum. Sem
// isso, "a chave da porta esta emprestada" viraria "a chave ***".
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

// Maquina (A): mascara os pares <campo><sep><valor> DENTRO de uma linha.
// Devolve tambem `pendente`: a linha termina com um rotulo CONHECIDO seguido
// de separador de pontuacao e nada depois -- ou seja, o valor deve vir nas
// proximas linhas. So isso liga o modo da maquina (B).
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
    // O valor deste campo para no proximo campo valido da mesma linha, nao no
    // fim dela -- senao engole o rotulo seguinte inteiro.
    const proximo = _acharProximoCampo(linha, campo.matchEnd);
    const valorEnd = proximo ? proximo.start : linha.length;
    const valorRaw = linha.slice(campo.matchEnd, valorEnd);
    const v = valorRaw.trim();
    const sepOut = /\s/.test(campo.sepChar) ? ' ' : `${campo.sepChar} `;

    if (!v) {
      // Rotulo conhecido + pontuacao + nada depois: o valor vem nas proximas
      // linhas (print de tela de login, campo digitado em mensagens separadas).
      if (sepEhPontuacao && !proximo) pendente = true;
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
    // Preserva o espaco entre esta credencial e a proxima: sem isso
    // "senha: abc token: xyz" vira "senha: ***token: ***" (sem espaco).
    const espacoFinal = valorRaw.length - valorRaw.replace(/\s+$/, '').length;
    pos = valorEnd - espacoFinal;
  }

  return { texto: out, achou, pendente };
}

function redigirSegredos(texto) {
  if (!texto || typeof texto !== 'string') return { texto: '', achou: false };

  const partes = texto.split(/(\r\n|\r|\n)/); // conteudo e separador alternados
  let achou = false;

  // Maquina (B): "as proximas linhas sao valores".
  let modo = false;
  let mascaradas = 0;
  let pulos = 0;

  function ligaModo() {
    modo = true;
    mascaradas = 0;
    pulos = 0;
  }

  // Roda a maquina (A) na linha e grava o resultado. Devolve o `pendente`
  // para quem decide se o modo (re)liga.
  function aplicaMesmaLinha(i, linha) {
    const r = _processaLinha(linha);
    partes[i] = r.texto;
    if (r.achou) achou = true;
    return r.pendente;
  }

  for (let i = 0; i < partes.length; i += 2) {
    const linha = partes[i];
    const conteudo = linha.trim();

    if (modo) {
      // Linha em branco: nao mascara, nao gasta orcamento, nao fecha.
      if (conteudo === '') continue;

      // Pergunta: pulada, o modo continua ligado (o valor pode vir depois).
      if (_ehPergunta(conteudo)) {
        const pendente = aplicaMesmaLinha(i, linha);
        pulos += 1;
        if (pendente) ligaModo();
        else if (pulos >= ORCAMENTO_PULOS) modo = false;
        continue;
      }

      // Prosa: conversa de verdade. Nao mascara e fecha o modo.
      if (_ehProsa(conteudo)) {
        const pendente = aplicaMesmaLinha(i, linha);
        modo = false;
        if (pendente) ligaModo();
        continue;
      }

      // Qualquer outra linha e valor: mascara INTEIRA, sem tentar adivinhar
      // se e "mais um rotulo".
      partes[i] = MASCARA;
      achou = true;
      mascaradas += 1;
      if (mascaradas >= TETO_MASCARAS) modo = false;
      continue;
    }

    if (aplicaMesmaLinha(i, linha)) ligaModo();
  }

  return { texto: partes.join(''), achou };
}

module.exports = { redigirSegredos, MASCARA };

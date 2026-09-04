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
//
// ---------------------------------------------------------------------------
// ROUND 5 -- o rotulo quase nunca encosta no separador em portugues de verdade
// ---------------------------------------------------------------------------
// 'A senha e:' / 'Minha senha eh:' vazavam o valor da linha seguinte porque o
// token colado ao ":" era "e"/"eh", nao "senha". Para ARMAR o modo (so para
// armar -- a deteccao de mesma linha nao mudou), numa linha que ja e candidata
// a rotulo (termina em ":"/"="/";" e nada depois) basta que QUALQUER palavra da
// linha, normalizada, contenha um rotulo conhecido. E seguro porque a condicao
// "termina em separador, sem valor depois" ja filtra quase toda prosa, e o que
// passar e fechado pela regra de prosa na linha seguinte: 'Deixa eu te contar
// um segredo:\nvi ela na academia ontem' arma, mas a linha de 5 palavras fecha
// o modo sem mascarar nada -- saida byte a byte identica, achou=false.
//
// ---------------------------------------------------------------------------
// ROUND 6 -- enfase markdown e rotulo de duas palavras
// ---------------------------------------------------------------------------
// O texto de "[Imagem analisada]" e gerado por modelo, e modelo formata rotulo
// em markdown -- '**Senha:** 250178Alf#' e o caminho principal da feature, nao
// uma borda. Duas mudancas: (a) a fronteira do rotulo aceita enfase e aspas
// (* ` " _), nas duas maquinas, e a enfase de FECHAMENTO depois do separador
// conta como "nao tem valor depois" (e o que faz '**Senha:**' armar em vez de
// mascarar o '**' e deixar o valor da linha seguinte passar); (b) a linha
// candidata reconhece o rotulo de duas palavras ('api key') em qualquer
// posicao, nao so colado ao separador.
// A enfase de fechamento so vale se houver enfase de ABERTURA antes do
// separador. Sem essa exigencia 'senha: ***' -- texto JA redigido -- seria
// lido como rotulo sem valor, armaria o modo e comeria a linha seguinte a cada
// nova passagem. Com ela, redigir duas vezes estabiliza.
//
// ---------------------------------------------------------------------------
// LIMITES CONHECIDOS -- sao decisao, nao descuido. Nao "conserte" sem medir.
// ---------------------------------------------------------------------------
// 1. 'Senha\nhunter2' (sem separador nenhum) nao arma: sem separador nao ha
//    campo, e aceitar rotulo solto no fim da linha mascararia conversa comum.
// 2. Tres perguntas seguidas entre o rotulo e o valor esgotam ORCAMENTO_PULOS
//    e o valor seguinte escapa ('Senha:\nvoce pode?\ne isso?\ntudo bem?\nX').
//    Aumentar o orcamento estende o modo por cima de conversa de verdade.
// 3. Rotulo sozinho sem nada para mascarar devolve achou=false ('Senha:').
//    "achou" significa "algo foi redigido", nao "a mensagem fala de credencial"
//    -- quem consumir como a segunda coisa vai errar.
// 4. JSON de UMA linha vaza: '{"senha": "hunter2"}' -- a aspa fica ENTRE o
//    rotulo e o separador, e o round 6 so aceita enfase ANTES do rotulo, nao
//    entre ele e o ":". Em varias linhas ('"senha":\n"hunter2"') funciona.
// 5. Tabela markdown sem ":" vaza: '| Senha | hunter2 |' -- "|" nao e
//    separador. Com ":" ('| Senha: | hunter2 |') mascara normalmente.
// Todos exigiriam afrouxar o gatilho de um jeito que reabre sobre-redacao em
// prosa, e sao formas de mensagem menos provaveis que as ja cobertas.

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
// espacos/tabs soltos antes dele). ROUND 6: a fronteira aceita enfase, senao
// "**Senha:** hunter2" (formato que o modelo produz na analise de imagem)
// nao casa em lugar nenhum e o valor vai em claro para o log.
const RE_CAMPO = /(?:^|(?<=[\s(\[*`"_]))(api[ _-]?key|[A-Za-z0-9_-]+)[ \t]*([:=;]|[ \t])/gi;

// Valor que e so enfase de fechamento ("**", "*", "`", "\"", "_") conta como
// "nao tem valor depois" -- e o que faz "**Senha:**" armar o modo em vez de
// mascarar o "**" e deixar o valor da linha seguinte passar. A MASCARA e a
// excecao: "senha: ***" (texto ja redigido) tem de continuar sendo um valor,
// senao redigir duas vezes arma o modo e come a linha seguinte.
const RE_SO_ENFASE = /^[*`"_\s]+$/;

function _soEnfase(v) {
  return !v.includes(MASCARA) && RE_SO_ENFASE.test(v);
}

// Tira enfase/pontuacao das bordas de uma palavra, para comparar rotulo de
// duas palavras ("**api key**:" -> "api" + "key").
const RE_ENFASE_BORDA = /^[*`"_]+|[*`"_:=;,.]+$/g;

function _limpaEnfase(palavra) {
  return palavra.replace(RE_ENFASE_BORDA, '');
}

const RE_ENFASE_FINAL = /[ \t]*[*`"_]+[ \t]*$/;

// Linha candidata a rotulo: termina em separador de pontuacao e nada depois
// alem de espaco -- ou de enfase de FECHAMENTO, e nesse caso so vale se
// existir enfase de ABERTURA antes do separador ("**Senha:**" vale). Sem essa
// exigencia, "senha: ***" (texto ja redigido) seria lido como rotulo sem
// valor, armaria o modo e comeria a linha seguinte a cada nova passagem.
function _ehLinhaCandidata(linha) {
  const t = linha.replace(/[ \t]+$/, '');
  if (/[:=;]$/.test(t)) return true;
  const semFinal = t.replace(RE_ENFASE_FINAL, '');
  if (!/[:=;]$/.test(semFinal)) return false;
  return /[*`"_]/.test(semFinal);
}

// Round 5 -- SO PARA ARMAR o modo (a deteccao de mesma linha continua olhando
// apenas o token adjacente ao separador). Numa linha candidata, qualquer
// palavra que contenha um rotulo conhecido basta: e o que pega 'A senha e:' e
// 'Minha senha eh:', onde o token colado ao ":" e "e"/"eh".
// Round 6 -- o mesmo para o rotulo de DUAS palavras: "api key" em qualquer
// posicao da linha, nao so colado ao separador ('a minha api key e:').
function _linhaArmaModo(linha) {
  if (!_ehLinhaCandidata(linha)) return false;
  const palavras = linha.trim().split(/\s+/);
  if (palavras.some(_tokenValido)) return true;
  for (let i = 0; i + 1 < palavras.length; i += 1) {
    if (_tokenValido(`${_limpaEnfase(palavras[i])} ${_limpaEnfase(palavras[i + 1])}`)) return true;
  }
  return false;
}

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

    if (!v || _soEnfase(v)) {
      // Rotulo conhecido + pontuacao + nada depois: o valor vem nas proximas
      // linhas (print de tela de login, campo digitado em mensagens separadas).
      // "Nada depois" inclui a enfase de fechamento ("**Senha:**").
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

  // Roda a maquina (A) na linha, grava o resultado e devolve se essa linha
  // arma o modo. Duas condicoes, em uniao: o `pendente` da maquina (A) (token
  // de rotulo conhecido colado ao separador, sem valor depois) OU a regra de
  // linha candidata do round 5 (qualquer palavra da linha e rotulo conhecido).
  function aplicaMesmaLinha(i, linha) {
    const r = _processaLinha(linha);
    partes[i] = r.texto;
    if (r.achou) achou = true;
    return r.pendente || _linhaArmaModo(linha);
  }

  for (let i = 0; i < partes.length; i += 2) {
    const linha = partes[i];
    const conteudo = linha.trim();

    if (modo) {
      // Linha em branco: nao mascara, nao gasta orcamento, nao fecha.
      if (conteudo === '') continue;

      // Pergunta: pulada, o modo continua ligado (o valor pode vir depois).
      if (_ehPergunta(conteudo)) {
        const arma = aplicaMesmaLinha(i, linha);
        pulos += 1;
        if (arma) ligaModo();
        else if (pulos >= ORCAMENTO_PULOS) modo = false;
        continue;
      }

      // Prosa: conversa de verdade. Nao mascara e fecha o modo.
      if (_ehProsa(conteudo)) {
        const arma = aplicaMesmaLinha(i, linha);
        modo = false;
        if (arma) ligaModo();
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

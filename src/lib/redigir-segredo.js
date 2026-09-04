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
// separador -- ver tambem V-4 abaixo, que completou essa protecao.
//
// ---------------------------------------------------------------------------
// ROUND 7 -- aspa entre o token e o separador, e "|" como separador
// ---------------------------------------------------------------------------
// Fecha os dois residuos que o round 6 deixou, ambos no caminho por imagem:
// (a) '{"senha": "hunter2"}' -- a aspa fica ENTRE o token e o ":", e o round 6
// so aceitava enfase ANTES do rotulo; agora cabe enfase/aspa nos dois lugares.
// (b) "|" entra como separador E como fronteira, porque tabela markdown e o
// formato que o modelo escolhe ao descrever print de painel de credenciais --
// '| Senha | hunter2 |' vazava inteiro.
// Junto veio uma guarda: com o modo ligado, o cabecalho de separacao da tabela
// ("|---|---|", "|:-:|:-:|") NAO e mascarado -- destruir a tabela nao protege
// nada, nenhum segredo tem a forma "so |, - e :". Ele e tratado como linha em
// branco: nao mascara, nao gasta orcamento, nao fecha o modo.
//
// ---------------------------------------------------------------------------
// ROUND 8 -- revisao final: V-1, V-2, V-3, V-4
// ---------------------------------------------------------------------------
// V-1  _ehPergunta era aplicada ao VALOR, nao so a linha de conversa. Senha que
//      comeca com "!" ou "." ou termina com "?" nunca era mascarada -- e "!QAZ"
//      e o padrao de teclado mais comum em senha corporativa. Agora a guarda so
//      vale com 2+ palavras: um token so nunca e pergunta, e valor. E "palavra"
//      passou a exigir um alfanumerico, senao a barra de tabela contava como
//      palavra e a celula '!QAZ2wsx |' escapava.
// V-2  O caminho de MESMA LINHA (mensagem digitada, o formato principal da
//      feature) so olhava o token colado ao separador, enquanto o multilinha
//      (print) ja olhava a linha toda desde o round 5. 'Senha:\nX' funcionava e
//      'a senha do wifi: X' nao. Agora, numa linha com ":", "=", ";" ou "|",
//      rotulo em qualquer palavra ANTES do separador faz do que vem depois o
//      valor -- mas so no PRIMEIRO separador de pontuacao a partir do rotulo,
//      senao a barra que fecha a celula do valor virava um campo novo e
//      cortava o valor em dois ('| Senha: | hunter2 |' vazava a metade final).
// V-3  Rotulo casava por substring crua: "secret" dentro de "secretaria"
//      apagava recado de escola de musica inteiro -- mensagem SEM segredo indo
//      redigida para o relatorio das 7h. Agora o rotulo tem de bater com um
//      SEGMENTO inteiro do token (ver _segmentos).
// V-4  A idempotencia do round 6 estava incompleta: com delimitador de
//      ABERTURA, a 1a passagem comia o de fechamento e a 2a re-armava
//      ('**Senha:** hunter2\nfalou' perdia o "falou" na 2a passagem). A suite
//      nao pegava porque so afirmava p2 === p3. Ver RE_TERMINA_MASCARA.
//
// ---------------------------------------------------------------------------
// LIMITES CONHECIDOS
// ---------------------------------------------------------------------------
// ⚠️ Esta lista e dos furos CONHECIDOS -- nao e a lista de todos os furos.
// Nao conclua que o que nao esta aqui esta coberto: sete rodadas de revisao
// acharam vazamento novo em toda rodada, inclusive no caminho principal. Ao
// mexer, meca com a suite e com uma varredura adversarial, nao com esta lista.
//
// Sao decisao, nao descuido, e cada um tem teste em redigir-segredo.test.js
// fixando o comportamento atual, para que mudar isso seja consciente.
// 1. 'Senha\nhunter2' (sem separador nenhum) nao arma: aceitar rotulo solto no
//    fim da linha mascararia conversa comum.
// 2. Tres perguntas seguidas entre o rotulo e o valor esgotam ORCAMENTO_PULOS
//    e o valor seguinte escapa ('Senha:\nvoce pode?\ne isso?\ntudo bem?\nX').
// 3. Rotulo sozinho sem nada para mascarar devolve achou=false ('Senha:').
//    "achou" significa "algo foi redigido", nao "a mensagem fala de credencial".
// 4. Passphrase de 3+ palavras em linha separada ('Senha:\ncorrect horse
//    battery staple') cai na regra de prosa e escapa. Baixar MIN_PALAVRAS_PROSA
//    apagaria conversa real, que e o outro lado do mesmo problema.
// 5. Tabela transposta de 3+ colunas ('| Servico | Senha | Token |' com os
//    valores na linha de baixo): a linha de valores tem 3 palavras e vira
//    prosa. A de 2 colunas fechou -- no round 8 so com o rotulo na ULTIMA
//    coluna, e no round 10 tambem com ele na PRIMEIRA.
// 11. Fraseado SEM pontuacao nenhuma nao dispara -- e caminho principal, nao
//    borda: 'a senha e hunter2' e 'A imagem mostra um painel com a senha
//    250178Alf# no campo' saem intactos. Sem separador nao ha onde ancorar o
//    valor, e disparar por proximidade de palavra apagaria conversa comum.
// 12. Com o rotulo NAO colado ao separador (o caminho do V-2), o valor tem de
//    ser token unico de 4+ -- entao 'a senha do wifi: X7k 9Qm 2p' (valor com
//    espacos) nao mascara, e em 'a senha do wifi: abc123 e o token: xyz789' o
//    'abc123' escapa (o valor ate o proximo campo tem espacos). E o preco da
//    correcao do item 5: a mesma regra e a que salva 'Preciso trocar a senha
//    do wifi. Motivo: muita gente conectada'.
// 6. Connection string ('postgres://user:hunter2@host:5432/db') nao casa.
// 7. Heading markdown sem separador ('## Senha\nhunter2') nao arma -- e o
//    limite 1 com outra roupa.
// 8. Aspas SIMPLES nao sao fronteira: "{'senha': 'hunter2'}" vaza. O apostrofo
//    e comum em prosa e entrar na classe de fronteira sai caro por pouco ganho.
// 9. XML e query string nao tem separador reconhecido: '<senha>hunter2</senha>'
//    e 'https://x.com/?senha=hunter2' saem intactos.
// 10. Rotulo DEPOIS do separador ('o painel: a senha e X7k9Qm2p') nao dispara:
//    o V-2 so olha o que vem antes do separador.

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

// V-3: separa o token em segmentos por "_", "-", espaco, fronteira camelCase
// e fronteira letra/digito. "senha_wifi" -> [senha, wifi];
// "PasswordConfirm" -> [password, confirm]; "SENHA_ADMIN" -> [senha, admin].
const RE_SEGMENTO = /[_\-\s]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[a-zA-Z])(?=[0-9])|(?<=[0-9])(?=[a-zA-Z])/;

function _segmentos(tok) {
  return String(tok).split(RE_SEGMENTO).filter(Boolean).map(s => s.toLowerCase());
}

// Rotulo, aceitando plural simples ("senhas", "tokens", "chaves") -- sem isso
// a troca de substring por segmento perderia deteccao que ja existia.
function _ehRotulo(seg) {
  if (ROTULOS_BASE.includes(seg)) return true;
  return seg.endsWith('s') && ROTULOS_BASE.includes(seg.slice(0, -1));
}

// V-3: o rotulo tem de bater com um SEGMENTO INTEIRO, nao com substring crua.
// Antes, "secret" casava dentro de "secretaria" e apagava recado de escola de
// musica inteiro -- mensagem sem segredo nenhum indo redigida para o relatorio
// das 7h dos diretores. "chave" e palavra comum como SUFIXO ("palavras-chave",
// "pontos-chave"), entao so vale como primeiro segmento ou unico.
function _tokenValido(tok) {
  if (RE_API_KEY.test(tok)) return true;
  const norm = _normalizaToken(tok);
  if (_ehRotulo(norm)) return true;
  return _segmentos(tok).some((seg, i) => {
    if (!_ehRotulo(seg)) return false;
    if (seg === 'chave' || seg === 'chaves') return i === 0;
    return true;
  });
}

// <token><separador>. A fronteira antes do token e lookbehind (nao consome
// caractere) de proposito: se fosse capturada e consumida, o candidato
// seguinte na mesma linha perderia a fronteira que o candidato anterior
// "comeu". Separador: ":", "=", ";", "|" ou um espaco/tab.
// ROUND 6: a fronteira aceita enfase, senao "**Senha:** hunter2" (formato que
// o modelo produz na analise de imagem) nao casa em lugar nenhum.
// ROUND 7: (a) entre o token e o separador tambem cabe enfase/aspa, senao
// '{"senha": "hunter2"}' nao casa -- a aspa fica ENTRE "senha" e ":";
// (b) "|" entra como separador e como fronteira, porque tabela markdown e o
// formato que o modelo escolhe ao descrever print de painel de credenciais.
// BONUS round 8: "-", "—" e "→" entram como separadores tratados como o
// espaco (valor tem de ser token unico de 4+ caracteres) -- 'Senha - hunter2'
// e formato provavel de modelo de visao descrevendo formulario.
//
// ROUND 10, item 1: o token e o lookbehind aceitam letra ACENTUADA. Sem isso
// o ":" depois de palavra acentuada era inalcancavel como separador e o V-2
// so funcionava em portugues sem acento -- 'a senha e:' mascarava e
// 'a senha é:' vazava. O "gap" (entre token e separador) NAO precisa de
// acento: como a classe do token passou a incluir letra acentuada, ela e
// absorvida pelo proprio token; por o contrario, letra no gap deixaria o
// token pular por cima de uma palavra inteira para alcancar um separador.
//
// ROUND 10, item 4: "_" saiu do gap e do lookbehind (continua no token). Com
// "_" nos tres lugares, cada posicao de um run de underscores era ponto de
// partida valido e o casamento era O(n^3) -- 6400 "_" levavam 52 s, e o
// engine chama o redator 3x por turno num processo single-thread. Nos dois
// lugares o "_" era redundante: a classe do token ja o inclui, entao ele
// nunca precisa ser fronteira nem preenchimento.
const RE_CAMPO = /(?:^|(?<=[\s(\[*`"|À-ÖØ-öø-ÿĀ-ſ]))(api[ _-]?key|[A-Za-z0-9_\-À-ÖØ-öø-ÿĀ-ſ]+)[ \t*`"]*([:=;|]|[ \t\-—→])/gi;

const RE_SEP_PONTUACAO = /^[:=;|]$/;

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
const RE_ENFASE_BORDA = /^[*`"_|]+|[*`"_|:=;,.?!]+$/g;

function _limpaEnfase(palavra) {
  return palavra.replace(RE_ENFASE_BORDA, '');
}

// Palavras da linha, com a posicao em que a palavra TERMINA depois de tirada
// a pontuacao colada, e se ela e rotulo conhecido (sozinha ou como segunda
// metade do par "api key").
//
// ROUND 10, item 2: o "fim" e o da palavra LIMPA, nao o do \S+ inteiro. Medido
// sobre o \S+, a pontuacao colada era engolida ("Senha:|" terminava depois do
// "|"), a guarda de posicao reprovava o separador certo e o V-2 elegia um "|"
// de DENTRO do valor -- '| Senha:| hunter2 |' saia com hunter2 em claro. Com
// espaco funcionava, colado nao; e era 100% da instabilidade de idempotencia.
function _palavrasDaLinha(texto) {
  const re = /\S+/g;
  const out = [];
  let m;
  let anterior = null;
  while ((m = re.exec(texto))) {
    const limpo = _limpaEnfase(m[0]);
    const desloc = limpo ? m[0].indexOf(limpo) : 0;
    const ehRotulo = _tokenValido(m[0])
      || (limpo !== '' && _tokenValido(limpo))
      || (anterior !== null && limpo !== '' && _tokenValido(`${anterior} ${limpo}`));
    out.push({ fim: m.index + desloc + limpo.length, ehRotulo });
    anterior = limpo;
  }
  return out;
}

function _temRotuloEmAlgumaPalavra(texto) {
  return _palavrasDaLinha(texto).some(p => p.ehRotulo);
}

// ROUND 10, item 5: proximidade. Antes bastava a palavra senha/chave/token em
// QUALQUER lugar da linha e QUALQUER ":" depois, a qualquer distancia -- num
// corpus de 20 mensagens reais de escola de musica, 7 eram destruidas
// ('...so preciso confirmar uma coisa: o email do aluno' virava '...coisa: ***').
// Agora o rotulo tem de estar entre as ultimas 4 palavras antes do separador.
const JANELA_ROTULO = 4;

function _temRotuloPerto(palavras, sepPos) {
  const antes = [];
  for (const p of palavras) {
    if (p.fim > sepPos) break;
    antes.push(p);
  }
  return antes.slice(-JANELA_ROTULO).some(p => p.ehRotulo);
}

// Onde o V-2 pode disparar: no PRIMEIRO separador de pontuacao que venha
// depois do rotulo. Sem essa restricao, em '| Senha | hunter2 |' a barra que
// fecha a celula do VALOR viraria um campo novo, o valor de "Senha" ficaria
// vazio e a linha saia intacta -- o V-2 abriria um vazamento ao consertar
// outro. Aqui so interessa o separador onde o valor comeca.
let _cacheLinha = null;
let _cachePosV2 = -1;

function _posV2DaLinha(linha) {
  if (linha === _cacheLinha) return _cachePosV2;
  _cacheLinha = linha;
  _cachePosV2 = -1;
  const palavras = _palavrasDaLinha(linha);
  if (!palavras.some(p => p.ehRotulo)) return _cachePosV2;
  const scan = new RegExp(RE_CAMPO.source, 'gi');
  let m;
  while ((m = scan.exec(linha))) {
    // O separador e um unico caractere, logo antes de lastIndex.
    if (RE_SEP_PONTUACAO.test(m[2]) && _temRotuloPerto(palavras, scan.lastIndex - 1)) {
      _cachePosV2 = m.index;
      return _cachePosV2;
    }
  }
  return _cachePosV2;
}

const RE_ENFASE_FINAL = /[ \t]*[*`"_]+[ \t]*$/;

// V-4: a MASCARA nunca e delimitador de fechamento. Ela e sempre emitida como
// <sep> + espaco + "***", entao "espaco seguido de ***" no fim da linha e
// texto JA redigido -- nao enfase. Sem esta guarda, '**Senha: ***' (saida da
// 1a passagem) re-arma o modo na 2a e come a linha seguinte. Enfase colada
// ("***Senha:***", sem espaco antes) continua valendo como enfase.
const RE_TERMINA_MASCARA = /\s\*\*\*$/;

// Linha candidata a rotulo: termina em separador de pontuacao e nada depois
// alem de espaco -- ou de enfase de FECHAMENTO, e nesse caso so vale se
// existir enfase de ABERTURA antes do separador ("**Senha:**" vale). Sem essa
// exigencia, "senha: ***" (texto ja redigido) seria lido como rotulo sem
// valor, armaria o modo e comeria a linha seguinte a cada nova passagem.
function _ehLinhaCandidata(linha) {
  const t = linha.replace(/[ \t]+$/, '');
  if (/[:=;]$/.test(t)) return true;
  if (RE_TERMINA_MASCARA.test(t)) return false;
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
  return _temRotuloEmAlgumaPalavra(linha);
}

// ROUND 10, item 3: linha de tabela que contem rotulo arma o modo, alem do
// que ela mesma mascare. Sem isso, so a tabela transposta com o rotulo na
// ULTIMA coluna funcionava ('| Usuario | Senha |'): com o rotulo na PRIMEIRA
// ('| Senha | Usuario |'), a celula seguinte era mascarada como se fosse o
// valor e a linha de baixo -- onde o valor de verdade estava -- saia intacta.
// Nao da para distinguir com seguranca "linha de cabecalho" de "linha de
// valores": o palpite erraria em '| Senha | correcthorse |'. Entao arma nos
// dois casos e aceita a sobre-redacao da celula de cabecalho.
function _linhaTabelaComRotulo(linha) {
  if (!linha.includes('|')) return false;
  if (_ehSeparadorTabela(linha.trim())) return false;
  // Mesma guarda do _ehLinhaCandidata: linha que ja termina na MASCARA e
  // texto JA redigido. Sem isso '| Senha| ***' re-arma a cada passagem e come
  // a linha seguinte -- foi o que o fuzz de idempotencia pegou (6340 casos,
  // todos desta classe) quando esta regra do item 3 entrou.
  if (RE_TERMINA_MASCARA.test(linha.replace(/[ \t]+$/, ''))) return false;
  return _temRotuloEmAlgumaPalavra(linha);
}

// Cabecalho de separacao de tabela markdown ("|---|---|", "|:--|--:|"). Com o
// modo ligado ele nao pode virar valor: mascarar a linha de separacao destroi
// a tabela sem proteger nada -- nao ha segredo formado so por "|", "-" e ":".
// Tratado como linha em branco: nao mascara, nao gasta orcamento, nao fecha.
// So "|", "-", ":" e espaco, com pelo menos um "|" e um "-" -- pega "|---|---|"
// e a variante de alinhamento "|:-:|:-:|". Nenhum segredo tem essa forma.
const RE_SEPARADOR_TABELA = /^[|\-: \t]+$/;

function _ehSeparadorTabela(v) {
  return RE_SEPARADOR_TABELA.test(v) && v.includes('|') && v.includes('-');
}

// So conta como palavra o que tem ao menos um alfanumerico -- "|", "-", "***"
// sao delimitadores, nao palavras. Sem isso a celula '!QAZ2wsx |' tem "2
// palavras" por causa da barra e escapa da correcao do V-1.
function _contaPalavras(v) {
  const t = v.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(p => /[A-Za-z0-9]/.test(p)).length;
}

// V-1: esta guarda foi feita para classificar LINHA de conversa, e estava
// sendo aplicada tambem ao VALOR de um campo -- por isso senha que comeca com
// "!" ou "." ou termina com "?" nunca era mascarada ('senha: !QAZ2wsx' saia
// intacta; !QAZ e o padrao de teclado mais comum em senha corporativa).
// Um token so NUNCA e pergunta: e valor. So com 2+ palavras a guarda vale.
function _ehPergunta(v) {
  if (_contaPalavras(v) < 2) return false;
  return /^[?!.]/.test(v) || /\?$/.test(v);
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

// V-2: ate o round 7 este caminho olhava SO o token colado ao separador. A
// rodada 5 tinha corrigido isso apenas para ARMAR o modo multilinha -- mas
// mensagem digitada e justamente o caso de mesma linha, e e o formato
// principal da feature. A assimetria era perversa: 'Senha:\nX' (print)
// funcionava e 'a senha do wifi: X' (digitada) nao.
// Agora, numa linha com ":", "=", ";" ou "|", se QUALQUER palavra ANTES do
// separador contiver rotulo conhecido, o que vem depois e o valor -- sujeito
// as mesmas regras de qualificacao de sempre. Linha so com espaco/traco como
// separador continua como antes, senao 'qual a senha do chatwoot?' quebra.
function _acharProximoCampo(linha, from) {
  RE_CAMPO.lastIndex = from;
  let m;
  while ((m = RE_CAMPO.exec(linha))) {
    if (_tokenValido(m[1])) {
      return { start: m.index, matchEnd: RE_CAMPO.lastIndex, token: m[1], sepChar: m[2] };
    }
    if (RE_SEP_PONTUACAO.test(m[2]) && m.index === _posV2DaLinha(linha)) {
      // viaPrefixo: o rotulo nao esta colado ao separador, foi achado pela
      // varredura da linha. Nesse caso o valor tem de ter forma de credencial
      // colada (token unico de 4+), senao 'Motivo: muita gente conectada'
      // numa mensagem que so MENCIONA senha vira '*** '.
      return { start: m.index, matchEnd: RE_CAMPO.lastIndex, token: m[1], sepChar: m[2], viaPrefixo: true };
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

    const sepEhPontuacao = RE_SEP_PONTUACAO.test(campo.sepChar);
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

    // Rotulo achado pela varredura (nao colado ao separador) exige valor com
    // forma de credencial colada, qualquer que seja o separador -- item 5.
    const exigeTokenUnico = campo.viaPrefixo === true;
    if (_ehPergunta(v) || !_valorQualifica(sepEhPontuacao && !exigeTokenUnico, v)) {
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
    return r.pendente || _linhaArmaModo(linha) || _linhaTabelaComRotulo(linha);
  }

  for (let i = 0; i < partes.length; i += 2) {
    const linha = partes[i];
    const conteudo = linha.trim();

    if (modo) {
      // Linha em branco (ou cabecalho de separacao de tabela): nao mascara,
      // nao gasta orcamento, nao fecha.
      if (conteudo === '' || _ehSeparadorTabela(conteudo)) continue;

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

'use strict';
// Decisões PURAS da pauta de anamnese. Nada aqui toca banco nem RPC — o ritual orquestra.
// Ver docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md.

// ---- Quem entra na pauta de hoje, em que ordem (Task 2) ----

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

// ── QUANDO CADA UNIDADE ABRE (correção 04/09) ────────────────────────────────────────────────
// O horário em que a equipe chega DEPENDE DO DIA DA SEMANA. O dono informou os reais:
//   Seg a Sex   Recreio 08:00 · Barra 09:00 · Campo Grande 10:00
//   Sábado      Recreio 08:00 · Barra 08:00 · Campo Grande 08:00
// O código usava os de dia útil todos os dias: no sábado a Barra recebia a pauta às 09:00 e o
// Campo Grande às 10:00 — com a equipe em pé desde as 08:00 e com aula acontecendo.
//
// DOMINGO NÃO EXISTE. Conferido na fonte em 04/09 antes de virar código: zero aulas em domingo
// nas três unidades, contando TODAS as pessoas (com ou sem pendência). Devolver null é o que faz
// o dispatcher não abrir o bloco — mais honesto que inventar horário pra um dia sem ninguém.
//
// A tabela mora AQUI, no módulo puro, e não no dispatcher: é decisão testável, e as duas pontas
// que dependem dela — a hora da mensagem de abertura e a hora a partir da qual o lembrete de
// hora em hora pode cobrar aquela unidade — precisam ler a MESMA tabela. Duas cópias
// divergiriam no dia em que uma unidade mudasse de horário e só um dos lados soubesse.
//
// A chave é o nome que situacao-aluno.nomeDaUnidade() devolve.
const ABERTURA_DIA_UTIL = { Recreio: '08:00', Barra: '09:00', 'Campo Grande': '10:00' };
const ABERTURA_SABADO = { Recreio: '08:00', Barra: '08:00', 'Campo Grande': '08:00' };

// O dia da semana sai da string YYYY-MM-DD quebrada em DÍGITOS, montada com Date.UTC e lida com
// getUTCDay. NUNCA `new Date(ymd).getDay()`: essa forma lê a data como meia-noite UTC e devolve o
// dia em hora LOCAL DO PROCESSO. Numa VPS em UTC as duas coincidem POR SORTE — no dia em que
// alguém setar TZ=America/Sao_Paulo o sábado vira sexta, a Barra volta a abrir às 09:00 e a
// pauta inteira anda um dia, em silêncio, sem exception nenhuma (LOCALYMD-UTC-SHIFT).
// Ponto ÚNICO de verdade: o ritual (_diaSemanaBrt) chama esta função.
function diaSemanaBrt(hoje) {
  const [y, m, d] = String(hoje || '').split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// null = esta unidade não abre neste dia (domingo, ou unidade que eu não conheço). Quem chama
// NÃO pode transformar null em "usa o de dia útil": falar antes de a equipe chegar é exatamente
// o que a amarra da abertura existe pra impedir.
function horaDeAberturaDaUnidade(unidadeNome, diaSemana) {
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) return null;
  if (diaSemana === 0) return null;                    // domingo: não há aula
  const mapa = diaSemana === 6 ? ABERTURA_SABADO : ABERTURA_DIA_UTIL;
  return mapa[unidadeNome] || null;
}

// Os horários DISTINTOS do dia, ordenados: é com isto que o dispatcher decide se o slot de agora
// é hora de alguma unidade falar. No sábado é um só ('08:00'); no domingo é lista vazia, e é ela
// que mantém o bloco fechado o dia inteiro sem precisar de um `if (domingo)` espalhado por aí.
function horariosDeAberturaDoDia(diaSemana) {
  const horas = Object.keys(ABERTURA_DIA_UTIL)
    .map((nome) => horaDeAberturaDaUnidade(nome, diaSemana))
    .filter(Boolean);
  return [...new Set(horas)].sort();
}

// ── QUANDO CADA UNIDADE FECHA O DIA (correção 04/09) ─────────────────────────────────────────
// O relatório de fim de dia sai por unidade, depois da última aula dela — e a última aula muda no
// sábado. Horários reais informados pelo dono:
//   Seg a Sex   Barra 19:30 · Recreio 20:30 · Campo Grande 20:30
//   Sábado      Barra 15:30 · Recreio 14:30 · Campo Grande 14:30
// Conferidos contra os dados: a última aula de sábado é 15:00 na Barra e 14:00 no Recreio e no
// Campo Grande — o relatório sai meia hora depois dela, com a equipe ainda na casa. Com o mapa de
// dia útil o relatório de sábado saía às 19:30/20:30, horas depois de a escola fechar: mensagem
// para casa vazia, e um relatório que ninguém lê ensina a equipe a ignorar o próximo também.
//
// DOMINGO NÃO EXISTE, pelo mesmo motivo da abertura (zero aulas nas três unidades, conferido na
// fonte em 04/09): sem aula não há o que relatar. null é o que faz o dispatcher não abrir o bloco.
//
// A tabela mora AQUI, ao lado da tabela da abertura, de propósito: são as duas pontas do MESMO
// dia e leem o MESMO dia da semana. Separá-las convidaria alguém a corrigir o sábado num lado só.
const FIMDIA_DIA_UTIL = { Recreio: '20:30', Barra: '19:30', 'Campo Grande': '20:30' };
const FIMDIA_SABADO = { Recreio: '14:30', Barra: '15:30', 'Campo Grande': '14:30' };

// null = esta unidade não relata neste dia (domingo, ou unidade que eu não conheço). Mesma regra
// da abertura: quem chama NÃO pode transformar null em "usa o de dia útil" — mandar o relatório
// às 20:30 de um sábado é falar sozinho num grupo que já esvaziou.
function horaDeFimDeDiaDaUnidade(unidadeNome, diaSemana) {
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) return null;
  if (diaSemana === 0) return null;                    // domingo: não há aula
  const mapa = diaSemana === 6 ? FIMDIA_SABADO : FIMDIA_DIA_UTIL;
  return mapa[unidadeNome] || null;
}

// Os horários DISTINTOS de fim de dia do dia, ordenados: é com isto que o dispatcher decide se o
// slot de agora é hora de alguma unidade relatar. No domingo é lista vazia, e é ela que mantém o
// bloco fechado o dia inteiro sem precisar de um `if (domingo)` espalhado pelo dispatcher.
function horariosDeFimDeDiaDoDia(diaSemana) {
  const horas = Object.keys(FIMDIA_DIA_UTIL)
    .map((nome) => horaDeFimDeDiaDaUnidade(nome, diaSemana))
    .filter(Boolean);
  return [...new Set(horas)].sort();
}

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// "Canto — Segunda-feira 19:00" → 1. Sem dia no texto devolve null; NÃO chuta.
function diaDaAula(resumo) {
  const t = _norm(resumo);
  for (let i = 0; i < DIAS.length; i += 1) if (t.includes(DIAS[i])) return i;
  return null;
}

function horaDaAula(resumo) {
  const m = String(resumo || '').match(/\b(\d{1,2}):(\d{2})\b/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function _curso(resumo) {
  return String(resumo || '').split('—')[0].trim() || null;
}

// Uma linha por ALUNO por dia (não por aula), na hora da PRIMEIRA aula — que é quando ele
// chega na escola, e é aí que o tablet funciona.
function pautaDoDia(pessoas, diaSemana) {
  const saida = [];
  for (const pessoa of (pessoas || [])) {
    const doDia = (pessoa.aulas_resumo || [])
      .filter((a) => diaDaAula(a) === diaSemana && horaDaAula(a))
      .sort((a, b) => String(horaDaAula(a)).localeCompare(String(horaDaAula(b))));
    if (!doDia.length) continue;
    saida.push({ pessoa, hora: horaDaAula(doDia[0]), curso: _curso(doDia[0]) });
  }
  return saida.sort((a, b) => a.hora.localeCompare(b.hora));
}

// ── A ESCADA ──────────────────────────────────────────────────────────────────────────────
// Conta APARIÇÕES falhadas, não cliques: contar "a equipe tentou" faria a escalada depender de
// todo mundo marcar checkbox certinho todo dia, e isso quebra na primeira semana corrida.
function degrau(falhas) {
  const n = Number(falhas) || 0;
  if (n >= 2) return 3;
  return n === 1 ? 2 : 1;
}

function tituloDaFilha({ pessoa, hora, curso }, falhas) {
  const base = `${hora} Anamnese — ${pessoa.nome}${curso ? ` (${curso})` : ''}`;
  const d = degrau(falhas);
  if (d === 2) return `${base} ⚠️ 2ª semana — não preencheu na anterior`;
  // Degrau 3 CONTINUA na pauta (ver separarPorDegrau abaixo) — e por isso PRECISA de marca
  // própria: sem ela se lê idêntico a quem está na 1ª vez, e a equipe repete a abordagem que já
  // falhou duas vezes. O texto diz o que MUDOU, que é o que interessa pra quem lê (a secretaria,
  // não um engenheiro): no terceiro encontro o caminho deixou de ser lembrar na aula.
  // `falhas + 1` porque `falhas` é o histórico ANTES da aparição de hoje — com 2 gravadas, hoje
  // é a 3ª semana. Começa por ' ⚠' igual ao degrau 2, de propósito: é onde os dois leitores de
  // título (_extrairNomeDaFilha no ritual e o bloco da fala no dispatcher) cortam o nome.
  if (d === 3) return `${base} ⚠️ ${(Number(falhas) || 0) + 1}ª semana sem preencher — mande o link da anamnese`;
  return base;
}

function tituloDaEscalada(pessoa, falhas) {
  const n = Number(falhas) || 0;
  return `Mandar link da anamnese — ${pessoa.nome} (${n} semanas sem preencher)`;
}

// Degrau 3 CONTINUA na pauta e TAMBÉM sai em `escalados` — o MESMO item nos dois, de propósito.
//
// POR QUÊ (correção 04/09): o desenho original tirava o degrau 3 da pauta porque a tarefa
// "Mandar link da anamnese" tomaria o lugar dele. Só que essa tarefa é a FATIA 2 e NÃO EXISTE:
// `tituloDaEscalada` (acima) só é chamado em teste, e `escaladosItens` não é consumido por
// ninguém. Na prática, a partir da 3ª aparição o aluno DESAPARECIA da pauta sem substituto — a
// equipe deixava de ver justamente quem mais precisa, e só o marker_logs saberia. É o "12 de 43"
// que a spec §7 proíbe ("meio pacote é pior que zero"): o time confia na lista e quem sumiu passa
// batido. Enquanto não houver substituto, NINGUÉM pode sair da lista.
//
// `escalados` continua com exatamente os do degrau 3 e com `falhas` junto: quando a fatia 2
// nascer, ela já tem a lista pronta e não precisa mudar este comportamento de novo.
//
// De quebra conserta um número que mentia: a mensagem das 07:30 conta `pauta`, então a partir da
// 2ª semana ela subnotificava o total de alunos do dia.
//
// `mapaFalhas` null (erro de leitura) → todo mundo é 1ª vez. Nunca escalar no escuro.
function separarPorDegrau(itens, mapaFalhas) {
  const pauta = [];
  const escalados = [];
  for (const item of (itens || [])) {
    const falhas = mapaFalhas ? (mapaFalhas.get(item.pessoa.pessoa_chave) || 0) : 0;
    // UMA cópia por item, referenciada nas duas listas: é o mesmo aluno do mesmo dia. Duas
    // cópias divergiriam no dia em que a fatia 2 carimbasse algo no item escalado.
    const comFalhas = { ...item, falhas };
    pauta.push(comFalhas);
    if (degrau(falhas) === 3) escalados.push(comFalhas);
  }
  return { pauta, escalados };
}

// ── A MENSAGEM (Task 4) ──────────────────────────────────────────────────────────────────
const PRIMEIROS_NO_ZAP = 3;

// "HH:MM Nome · HH:MM Nome". Hoje sobrou pro RELATÓRIO DA NOITE só: os blocos da manhã passaram
// a sair separados por horário (ver _linhasPorHora, logo abaixo). O relatório da noite ficou como
// estava de propósito — ali a lista é de quem FALTOU, no máximo três nomes, e a hora é detalhe
// de contexto, não o eixo pelo qual alguém age. Agrupar lá seria estrutura sem leitor.
// Item torto (sem pessoa, sem hora) não pode derrubar a mensagem da unidade inteira nem vazar a
// palavra "undefined" pro zap que a equipe lê — '?' e '--:--' são feios, mas muito melhores que
// um TypeError na hora de falar ou um "undefined" na frente da equipe.
function _horariosENomes(lista, quantos) {
  return (lista || []).slice(0, quantos)
    .map((i) => `${i.hora || '--:--'} ${(i.pessoa && i.pessoa.nome) || '?'}`).join(' · ');
}

function _alunosComAula(n) {
  return `${n} aluno${n > 1 ? 's' : ''} com aula hoje`;
}

// ── ARRUMAÇÃO POR HORÁRIO (pedido do Alf, 04/09) ─────────────────────────────────────────────
// "esse tipo de texto corrido assim é difícil. O ideal é vir separadinho, por horário. Semântico,
// grifando qual é a pendência, botando em negrito. Assim fica uma massaroca, a galera nem lê."
//
// O EIXO É A HORA, e não o aluno, porque é quando a pessoa AGE: às 09:00 chegam três alunos, a
// secretaria vai buscar esses três de uma vez. Repetir "09:00" em cada linha é justamente o que
// faz a mensagem virar bolo — a hora sobe pra um cabeçalho e some das linhas.
//
// NADA AQUI MUDA REGRA: quem entra na mensagem, quem fica de fora, o silêncio da hora vazia e o
// "não consegui conferir" continuam decididos exatamente onde estavam. Isto é arrumação de texto.

// O marcador da quebra é o RELÓGIO DA PRÓPRIA HORA — 09:00 sai com o relógio das 9. Sai de
// codepoint e não de emoji digitado: a tabela Unicode é contígua (U+1F550 = 1h … U+1F55B = 12h,
// U+1F55C = 1h30 … U+1F567 = 12h30) e calcular é a única forma de nunca imprimir um relógio que
// contradiz o número escrito ao lado. Hora ilegível (item torto) cai no relógio de parede, que
// não afirma horário nenhum — melhor que um relógio marcando uma hora inventada.
function _marcadorDaHora(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || ''));
  if (!m) return String.fromCodePoint(0x1F570, 0xFE0F);
  const h12 = (Number(m[1]) + 11) % 12;               // 0 = 1h, 11 = 12h
  return String.fromCodePoint(0x1F550 + h12 + (Number(m[2]) >= 30 ? 12 : 0));
}

// Agrupa PRESERVANDO a ordem em que os itens chegaram — quem chama já ordenou por horário, e
// re-ordenar aqui esconderia um erro de ordenação lá em cima em vez de deixá-lo aparecer.
// Item sem hora vira '--:--' e fica onde estava: some da mensagem seria perder gente em silêncio.
function _agruparPorHora(itens) {
  const grupos = new Map();
  for (const i of (itens || [])) {
    const h = (i && i.hora) || '--:--';
    if (!grupos.has(h)) grupos.set(h, []);
    grupos.get(h).push(i);
  }
  return [...grupos.entries()].map(([hora, lista]) => ({ hora, itens: lista }));
}

// A forma COMPACTA, usada nos blocos da manhã: uma linha por HORÁRIO, com os nomes daquela hora.
// Por que compacta e não em blocos como o lembrete: aqui cada item é só um nome (a pendência já
// está no cabeçalho do bloco, "Anamnese"/"Contrato"), e a manhã carrega DOIS blocos mais a linha
// da promessa. Em blocos verticais, três nomes virariam nove linhas — o oposto de ler rápido.
// No lembrete cada linha carrega a pendência do aluno e precisa de linha própria; aqui, não.
function _linhasPorHora(lista, quantos) {
  return _agruparPorHora((lista || []).slice(0, quantos))
    .map((g) => `${_marcadorDaHora(g.hora)} *${g.hora}* — `
      + g.itens.map((i) => (i && i.pessoa && i.pessoa.nome) || '?').join(' · '))
    .join('\n');
}

// ── O INTERRUPTOR DO CONTRATO (reversão pedida pelo Alf, 04/09) ──────────────────────────────
// PONTO ÚNICO DE REATIVAÇÃO. Enquanto isto for `false`, nem a mensagem da manhã nem o lembrete de
// hora em hora falam de contrato — o TOM volta ao escopo que ele tinha antes de hoje: só anamnese.
//
// POR QUE A REVERSÃO. A auditoria de hoje no Emusys mostrou que o critério que alimentava o bloco
// não mede o que ele promete medir. `filtrarPorRecorte(pessoas, 'contrato')` se apoia em
// `data_inicio_contrato`, um campo DERIVADO da data da primeira aula: ele fica preenchido desde a
// criação da matrícula, independentemente de o contrato estar assinado ou não. Ou seja, a lista
// que saía nos grupos não era "quem está sem contrato assinado" — era outra coisa, com o nome
// dessa. Cobrar a equipe por um número que ninguém mediu é exatamente o que esta casa não faz, e
// mensagem que cobra errado uma vez custa a confiança das que estão certas.
//
// QUANDO RELIGAR (a condição, não uma data): o Emusys tem o campo que responde à pergunta certa —
// o booleano `contrato_atual.contrato_assinado`. Ele ainda NÃO é trazido nem materializado no LA
// Report. Religar isto é o ÚLTIMO passo, e só depois de: (1) o campo chegar à RPC
// get_situacao_alunos_v1; (2) `filtrarPorRecorte(..., 'contrato')`, em services/situacao-aluno.js,
// passar a decidir por ele; (3) o ROTULO de lá deixar de dizer "sem data de contrato" e passar a
// dizer o que o booleano de fato afirma. Virar este `false` antes disso devolve o bug ao ar.
//
// ESTE INTERRUPTOR TAMBÉM APAGA A RESSALVA (04/09). Reverter as mensagens não fechou a porta: o
// recorte 'contrato' continuou respondendo a QUEM PERGUNTA, com o mesmo critério torto, e o dono
// tinha acabado de dizer nos três grupos "me peça a lista de contrato que eu mando ela inteira".
// A resposta NÃO foi bloqueada (quem está sem a data é pendência de verdade) — ela passou a sair
// com uma ressalva dizendo que "sem data de contrato" não é "não assinou": RESSALVA_CONTRATO, em
// services/situacao-aluno.js. Ela lê ESTE booleano em tempo de chamada, então ligar aqui apaga a
// ressalva na lista e na ficha sozinho, sem tocar em nada lá. É de propósito: dar o número CERTO
// com um aviso dizendo que ele é duvidoso é pior que não avisar, e um segundo botão só existiria
// pra alguém esquecer de apertar.
//
// POR QUE O CÓDIGO FICA. O bloco volta — o pedido do dono não mudou, só o critério é que não
// servia. Apagar e reescrever amanhã de memória perderia a copy que ele aprovou palavra por
// palavra, e os testes que a travam byte a byte (services/anamnese-pauta.test.js, passando
// `comContrato: true`) continuam rodando justamente pra que o que volta seja o que saiu.
const CONTRATO_NA_PAUTA = false;

// ── O BLOCO DE CONTRATO (pedido do Alf, 04/09) ───────────────────────────────────────────────
// "anamnese e contrato sem assinar são duas demandas extremamente importantes que precisam ser
// colocadas ali de forma separada. Não pode vir dentro do mesmo bolo, tem que estar separadinho."
//
// TRÊS coisas deste bloco não são estilo, são regra:
//
// 1. Ele NUNCA entra na primeira linha da mensagem. O dispatcher usa `texto.split('\n')[0]` como
//    chave da guarda de duplicata (`like('content', cabeçalho%)`) contra reenvio num grupo REAL.
//    Mexer na linha 1 cega essa guarda — tem teste travando isso.
// 2. Bloco vazio não aparece; bloco NÃO-LIDO aparece dizendo que não leu. Ausência se lê como
//    "hoje não tem ninguém sem contrato", que é uma afirmação — e afirmar sem medir é
//    exatamente o que esta casa não faz.
// 3. O rótulo é "sem data de contrato", igual ao ROTULO de situacao-aluno.js. O dono fala
//    "contrato sem assinar"; o que a fonte SABE é que falta a data de início. Dizer "não
//    assinado" seria inventar um fato a partir de um campo vazio.
//
// Contrato NÃO tem painel: a pauta lista, mas não cria tarefa (spec §8 — "contrato já tem dono:
// o Clayton cria na mão com horário de assinatura combinado, e duas fontes criando a mesma
// tarefa colidem"). Por isso, quando a lista corta, o texto ENSINA a pedir o resto — é o único
// caminho que existe pra ela, e o recorte 'contrato' já está no <<SITUACAO_ALUNO>> do grupo.
function _blocoDeContrato({ contrato, contratoErro, dataBr }) {
  const cabecalho = `✍️ *Contrato — hoje (${dataBr})*`;
  if (contratoErro) {
    return `${cabecalho}\nNão consegui conferir contrato agora. Assim que eu conseguir, eu aviso.`;
  }
  const lista = contrato || [];
  if (!lista.length) return null;
  const n = lista.length;
  // A lista sai SEPARADA POR HORÁRIO (04/09), igual à do bloco de anamnese. O ':' fecha a linha
  // da contagem e a lista desce — "Hoje:" no meio de uma frase que já diz "hoje" era repetição.
  const corpo = `${cabecalho}\n${_alunosComAula(n)} ainda sem data de contrato`
    + `${n > PRIMEIROS_NO_ZAP ? '. Os primeiros:' : ':'}\n${_linhasPorHora(lista, PRIMEIROS_NO_ZAP)}`;
  return n > PRIMEIROS_NO_ZAP
    ? `${corpo}\nMe peça a lista de contrato que eu mando ela inteira.`
    : corpo;
}

// Os N primeiros HORÁRIOS, não os N primeiros nomes alfabéticos: quem chega às 8h é quem
// importa quando o dia começa. A lista inteira mora no painel.
// `unidadeNome` não entra no texto de propósito: a mensagem já vai pro grupo daquela
// unidade — repetir o nome seria redundante. Não é esquecimento; não "conserte" tirando o parâmetro.
// `comContrato` NÃO é opção de produto: é o interruptor da reversão (CONTRATO_NA_PAUTA, lá em
// cima) com uma porta pro TESTE poder continuar travando, byte a byte, a copy que volta quando o
// campo certo chegar. Produção não passa este parâmetro — nem o dispatcher, nem o ritual — e por
// isso a manhã sai hoje exatamente como saía antes de o bloco existir. Quando `false`, `contrato` e
// `contratoErro` são IGNORADOS de propósito: o aviso "não consegui conferir contrato" é uma
// promessa de que o TOM está olhando contrato, e prometer o que não se mede é pior que o silêncio.
function mensagemDoGrupo({ itens, contrato, contratoErro, unidadeNome, dataBr, comContrato = CONTRATO_NA_PAUTA } = {}) {
  const lista = itens || [];
  if (!lista.length) return null;
  const n = lista.length;
  // SEPARADO POR HORÁRIO (04/09). A primeira linha continua sendo o cabeçalho — a guarda de
  // duplicata do dispatcher casa `like('content', texto.split('\n')[0] + '%')`, e a arrumação
  // acontece toda da segunda linha pra baixo, onde ela não alcança.
  const cabeca = _linhasPorHora(lista, PRIMEIROS_NO_ZAP);
  const blocoAnamnese = `📋 *Anamnese — hoje (${dataBr})*\n`
    + `${_alunosComAula(n)} ainda sem anamnese${n > PRIMEIROS_NO_ZAP ? '. Os primeiros:' : ':'}\n`
    + `${cabeca}\n`
    + 'A lista completa está no painel do grupo.';
  // Linha EM BRANCO entre os dois: é o "separadinho" que o dono pediu. No WhatsApp é o que faz
  // o olho ver duas demandas e não um bolo só.
  const blocoContrato = comContrato ? _blocoDeContrato({ contrato, contratoErro, dataBr }) : null;
  const corpo = blocoContrato ? `${blocoAnamnese}\n\n${blocoContrato}` : blocoAnamnese;
  // A LINHA DO LEMBRETE (pedido do Alf, 04/09). Vem no FIM e depois de uma linha em branco: ela
  // não pertence a nenhum dos dois blocos — é o que o TOM vai fazer com eles pelo resto do dia.
  // NUNCA na primeira linha: o dispatcher usa `texto.split('\n')[0]` como chave da guarda de
  // duplicata contra reenvio num grupo REAL (mesma regra do bloco de contrato, acima).
  // Ela é uma PROMESSA: se o lembrete de hora em hora for desligado um dia, esta linha vira
  // mentira e sai junto.
  return `${corpo}\n\n${LINHA_LEMBRETE_HORA}`;
}

// ── O RELATÓRIO DE FIM DE DIA (pedido do Alf, 04/09) ─────────────────────────────────────────
// "no final do dia ele manda uma lista do que foi feito ali no dia. Alunos que tiveram na escola
// e não preencheram a anamnese. 'Semana que vem eu vou lembrar de novo.'"
//
// Duas metades, nesta ordem: o que a equipe CONSEGUIU e quem ESCAPOU. A ordem importa — quem lê
// passou o dia trabalhando; abrir pela falha é injusto e faz o relatório virar cobrança.
//
// A promessa da última linha é VERDADE, não consolo: a escada faz o aluno reaparecer no próximo
// dia de aula dele (pautaDoDia roda todo dia) e, a partir da 2ª aparição, tituloDaFilha carimba
// o aviso no título. Se algum dia a escada for desligada, esta frase vira mentira e tem que sair
// junto.
//
// Este texto NÃO fecha nada: quem grava resultado, fecha filha e fecha container é o ritual das
// 23:00 (fecharPautaDaUnidade). Aqui é leitura.
const FALTARAM_NO_ZAP = 3;

function mensagemDeFimDeDia({ preencheram, faltaram, semVerificacao, dataBr, erro } = {}) {
  const cabecalho = `🌙 *Anamnese — como foi hoje (${dataBr})*`;
  // Fonte fora NUNCA vira relatório de zeros: "0 preencheram" é um número, e número que não foi
  // medido não sai daqui. Diz o que não deu e o que acontece a seguir — o fechamento das 23:00
  // relê a fonte e decide o dia de verdade.
  if (erro) {
    return `${cabecalho}\nNão consegui conferir o dia agora. Volto a olhar no fechamento da noite.`;
  }
  const faltou = faltaram || [];
  const ok = Number(preencheram) || 0;
  const semVer = Number(semVerificacao) || 0;
  // O total soma os TRÊS desfechos: quem preencheu, quem não preencheu e quem não deu pra
  // conferir. Sem o terceiro, as contas da mensagem não fecham e a equipe percebe.
  const total = ok + faltou.length + semVer;
  if (!total) return null;   // ninguém entrou na pauta hoje — silêncio, não um relatório de zeros

  const linhas = [cabecalho];
  const osAlunos = total === 1 ? 'o único aluno da pauta' : `os ${total} alunos da pauta`;
  if (!faltou.length && !semVer) {
    linhas.push(`Dia bom: ${osAlunos} ${total === 1 ? 'preencheu' : 'preencheram'} a anamnese hoje. 👏`);
  } else if (!ok) {
    linhas.push(total === 1
      ? 'Hoje o único aluno da pauta não preencheu a anamnese.'
      : `Hoje nenhum dos ${total} alunos da pauta preencheu a anamnese.`);
  } else {
    linhas.push(`Hoje ${ok} dos ${total} alunos da pauta preencheram a anamnese.`);
  }

  if (faltou.length) {
    const cortou = faltou.length > FALTARAM_NO_ZAP;
    // "Faltaram 1" é o tipo de descuido que faz a mensagem inteira soar automática demais pra
    // merecer confiança — e quem lê é a secretaria, todo dia.
    const verbo = faltou.length > 1 ? 'Faltaram' : 'Faltou';
    linhas.push(`${verbo} ${faltou.length}${cortou ? ', começando por' : ''}: `
      + `${_horariosENomes(faltou, FALTARAM_NO_ZAP)}`);
    // O container do dia só fecha às 23:00 — então, na hora deste recado, a lista inteira ainda
    // ESTÁ na tela. Só apontamos pra lá quando cortamos: com todo mundo no texto, seria ruído.
    if (cortou) linhas.push('A lista de hoje ainda está no painel do grupo.');
  }
  if (semVer) {
    // Nem vitória nem falta: somar em "preencheu" inflaria o resultado, somar em "faltou"
    // acusaria quem talvez tenha preenchido. Sai como o que é — não sei.
    linhas.push(`${semVer} eu não consegui conferir — não achei no sistema hoje.`);
  }
  // Sem faltante não há a quem prometer semana que vem — a frase viraria enfeite.
  if (faltou.length) {
    linhas.push('Semana que vem eu lembro de novo — eles voltam na pauta no próximo dia de aula deles.');
  }
  return linhas.join('\n');
}

// ── O LEMBRETE DE HORA EM HORA (pedido do Alf, 04/09) ────────────────────────────────────────
// De hora em hora (09:00 às 19:00) o TOM fala da PRÓXIMA hora — nunca da lista do dia.
//
// POR QUE A PRÓXIMA HORA E NÃO A LISTA DO DIA: a lista inteira repetida 11 vezes vira ruído, e a
// equipe para de ler — aí a mensagem que importa também deixa de ser lida. O que serve no meio do
// expediente é quem está CHEGANDO agora. Medido nos dados de hoje: 2 a 7 alunos por horário.
//
// AQUI ANAMNESE E CONTRATO CONVIVEM NA MESMA LINHA, ao contrário da mensagem da manhã, onde o
// dono pediu blocos separados. Não é incoerência: lá são duas listas do dia inteiro, com gente
// diferente em cada uma, e misturá-las esconde uma demanda dentro da outra. Aqui é a MESMA pessoa
// chegando na MESMA hora — quebrar em dois blocos faria a secretaria procurar o mesmo aluno duas
// vezes pra descobrir que era um só.
//
// A promessa que a mensagem da manhã faz mora aqui do lado, de propósito: quem desligar um dos
// dois vê o outro na mesma tela.
const LINHA_LEMBRETE_HORA = 'De hora em hora eu aviso aqui quem chega na hora seguinte.';

// Ordem FIXA do rótulo: "anamnese e contrato", nunca "contrato e anamnese". A ordem sai de uma
// lista, não da ordem em que os recortes foram lidos — senão o mesmo aluno apareceria escrito de
// um jeito hoje e de outro amanhã, e a equipe leria isso como duas coisas diferentes.
const ORDEM_PENDENCIAS = ['anamnese', 'contrato'];

// Junta os dois recortes numa linha por ALUNO. Os dois lados chegam PRONTOS de pautaDoDia — a
// mesma função que monta a pauta da manhã, alimentada por filtrarPorRecorte, que é a única
// definição de cada pendência nesta casa. Nunca um filtro próprio aqui: uma segunda cópia faria o
// lembrete e o card do LA Report discordarem sobre a mesma pessoa, e ninguém confiaria em nenhum.
//
// A identidade é `pessoa_chave`, NUNCA o nome: uma unidade tem dezenas de "Maria", e juntar por
// nome faria duas alunas virarem uma linha só — com a pendência de uma colada na outra. Sem
// chave nenhuma o item é DESCARTADO em vez de virar linha fantasma no zap.
// `recuperacao` muda o RECORTE, não o critério: em vez da hora exata, tudo do começo do dia até
// `hora` (inclusive). É o primeiro lembrete do dia de cada unidade — ver o comentário do texto,
// logo abaixo. Comparação de string funciona porque a hora vem sempre "HH:MM" com zero à
// esquerda (horaDaAula garante isso); um "9:00" quebraria a ordem e o corte ao mesmo tempo.
// `comContrato` é o MESMO interruptor da mensagem da manhã (CONTRATO_NA_PAUTA, lá em cima), com a
// mesma porta pro teste. Aqui o efeito não é de bloco, é de LISTA: com ele desligado, quem estava
// sendo cobrado SÓ por contrato sai do lembrete, e quem tinha os dois rótulos volta a ter um só
// ("anamnese"). O recorte continua CHEGANDO na função — quem chama não precisa saber da reversão
// pra estar certo, e é isto que faz religar amanhã ser uma linha, não uma cirurgia.
function alunosDaHora({ anamnese, contrato, hora, recuperacao = false, comContrato = CONTRATO_NA_PAUTA } = {}) {
  if (!hora) return [];   // sem hora não há "próxima hora" — nada a dizer
  const porChave = new Map();
  const somar = (lista, pendencia) => {
    for (const item of (lista || [])) {
      if (!item || !item.hora) continue;
      if (recuperacao ? item.hora > hora : item.hora !== hora) continue;
      const chave = item.pessoa && item.pessoa.pessoa_chave;
      if (!chave) continue;
      const ja = porChave.get(chave);
      if (ja) { ja.pendencias.add(pendencia); continue; }
      porChave.set(chave, {
        pessoa: item.pessoa, hora: item.hora, curso: item.curso || null,
        pendencias: new Set([pendencia]),
      });
    }
  };
  somar(anamnese, 'anamnese');
  if (comContrato) somar(contrato, 'contrato');
  // HORÁRIO e, dentro da mesma hora, ordem alfabética. No lembrete normal a hora é única, então
  // isto se degrada exatamente na ordem alfabética de sempre — nada muda ali. Na recuperação é o
  // que faz a mensagem se ler na ordem em que o dia aconteceu: quem já está na escola primeiro.
  // O que NUNCA pode aparecer é a ordem em que a RPC devolveu as linhas: ela muda de um slot pro
  // outro sem motivo nenhum que a equipe entenda.
  return [...porChave.values()]
    .map((i) => ({ ...i, pendencias: ORDEM_PENDENCIAS.filter((p) => i.pendencias.has(p)) }))
    .sort((a, b) => String(a.hora).localeCompare(String(b.hora))
      || String(a.pessoa.nome || '').localeCompare(String(b.pessoa.nome || ''), 'pt-BR'));
}

// O texto. Curto por desenho: quem lê é a secretaria no meio do expediente, de pé, com aluno na
// frente. Cabeçalho + uma linha por aluno, nada de rodapé ensinando a pedir lista — a lista do dia
// já saiu de manhã e está no painel.
//
// A HORA no cabeçalho não é enfeite: a primeira linha é a chave da guarda de duplicata do
// dispatcher (`like('content', cabeçalho%)`), e sem a hora o lembrete das 16:00 casaria o
// cabeçalho do das 15:00 — e nunca sairia.
// A RECUPERAÇÃO (correção 04/09). O primeiro lembrete do dia de cada unidade fala da hora
// SEGUINTE — então quem tem aula às 08:00 numa unidade que abre às 08:00 (ou às 09:00 numa que
// abre às 09:00) nunca aparecia em lembrete nenhum: 25 aulas por semana invisíveis, medido na
// fonte. Nessa primeira passada a mensagem cobre do começo do dia até o fim da hora seguinte; do
// segundo lembrete em diante volta a ser só a próxima hora, senão a mesma gente sairia 11 vezes
// e a equipe pararia de ler — que é o ruído que este lembrete existe pra evitar.
//
// O TEXTO MUDA JUNTO, e não é estilo: "⏰ *Próxima hora — 10:00*" numa mensagem que carrega gente
// das 08:00 é uma afirmação FALSA, todo dia, em três grupos reais. O cabeçalho da recuperação diz
// a FAIXA e cada linha carrega a hora do aluno — sem ela a equipe não sabe quem já está na escola
// e quem ainda vai chegar. Os dois cabeçalhos são distintos e nenhum é prefixo do outro: a guarda
// de duplicata do dispatcher casa `like('content', primeiraLinha%)`, e um prefixo comum a deixaria
// cega justo na mensagem nova. Os dois levam a HORA, que é o que separa um slot do outro.
//
// SEPARADO POR HORÁRIO E COM A PENDÊNCIA EM NEGRITO (pedido do Alf, 04/09): "o ideal é vir
// separadinho, por horário. Semântico, grifando qual é a pendência, botando em negrito." O que
// está em negrito é o que a secretaria vai PEDIR ao aluno — é a única coisa acionável da linha.
//
// O CABEÇALHO DE HORA SÓ APARECE QUANDO HÁ MAIS DE UMA HORA NA MENSAGEM. Com uma hora só, ele
// repetiria o que o cabeçalho de cima já diz e custaria duas linhas (a dele e a em branco) pra
// não dizer nada — numa hora com um aluno, isso é pior que a linha única. O lembrete normal cai
// sempre nesse caso (alunosDaHora filtra pela hora exata); a recuperação cai nele nos dias em que
// a faixa varrida tem gente de uma hora só, e aí a hora continua na linha, como estava.
function lembreteDaProximaHora({ itens, hora, recuperacao = false } = {}) {
  if (!hora) return null;
  // Item sem pendência nenhuma não vira linha: "· Fulano — " não diz nada e é pior que ausência.
  const validos = (itens || []).filter((i) => ((i && i.pendencias) || []).length);
  // Hora sem ninguém pendente NÃO gera mensagem: silêncio ali é notícia boa. Quem distingue "zero
  // por saúde" de "zero por falha" é o marcador que o dispatcher grava, não a ausência de texto.
  if (!validos.length) return null;
  const cabecalho = recuperacao
    ? `⏰ *Do começo do dia até as ${hora}*`
    : `⏰ *Próxima hora — ${hora}*`;
  const linha = (i, comHora) => {
    const nome = (i.pessoa && i.pessoa.nome) || '?';
    const quando = comHora ? `${i.hora || '--:--'} ` : '';
    return `· ${quando}${nome}${i.curso ? ` (${i.curso})` : ''} — *${i.pendencias.join(' e ')}*`;
  };
  const grupos = _agruparPorHora(validos);
  if (grupos.length < 2) return [cabecalho, ...validos.map((i) => linha(i, recuperacao))].join('\n');
  // Linha EM BRANCO entre os blocos: é ela que dá o respiro no celular — sem ela o agrupamento
  // só acrescenta linhas e a mensagem continua sendo um bolo, que é a queixa original.
  const blocos = grupos.map((g) => [
    `${_marcadorDaHora(g.hora)} *${g.hora}*`,
    ...g.itens.map((i) => linha(i, false)),
  ].join('\n'));
  return `${cabecalho}\n\n${blocos.join('\n\n')}`;
}

module.exports = {
  diaDaAula, horaDaAula, pautaDoDia, DIAS,
  // O horário de abertura sai daqui pro dispatcher e pros testes lerem a MESMA tabela — uma
  // cópia redigitada lá faria a suíte continuar verde no dia em que alguém mudasse o valor aqui.
  diaSemanaBrt, horaDeAberturaDaUnidade, horariosDeAberturaDoDia,
  ABERTURA_DIA_UTIL, ABERTURA_SABADO,
  // O horário do relatório de fim de dia sai daqui pelo mesmo motivo da abertura: o dispatcher e
  // os testes leem a MESMA tabela, e uma cópia redigitada lá faria a suíte continuar verde no dia
  // em que uma unidade mudasse de horário aqui.
  horaDeFimDeDiaDaUnidade, horariosDeFimDeDiaDoDia,
  FIMDIA_DIA_UTIL, FIMDIA_SABADO,
  degrau, tituloDaFilha, tituloDaEscalada, separarPorDegrau,
  mensagemDoGrupo, PRIMEIROS_NO_ZAP,
  mensagemDeFimDeDia, FALTARAM_NO_ZAP,
  alunosDaHora, lembreteDaProximaHora, LINHA_LEMBRETE_HORA,
  // O interruptor da reversão do contrato sai daqui pro dispatcher e pro ritual lerem o MESMO
  // valor: um `false` redigitado em cada ponta faria a reversão voltar pela metade no dia em que
  // alguém religasse só um lado — e a metade que ficasse ligada seria justamente a que cobra.
  CONTRATO_NA_PAUTA,
};

'use strict';
// Decisões PURAS da pauta de anamnese. Nada aqui toca banco nem RPC — o ritual orquestra.
// Ver docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md.

// ---- Quem entra na pauta de hoje, em que ordem (Task 2) ----

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

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

// "HH:MM Nome · HH:MM Nome". UM lugar só: os dois blocos da manhã e a lista da noite usam o
// MESMO formato, e uma segunda cópia divergiria no dia em que alguém trocasse o '·' por vírgula
// em um dos lados e não no outro.
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
  const corpo = `${cabecalho}\n${_alunosComAula(n)} ainda sem data de contrato.\n`
    + `${n > PRIMEIROS_NO_ZAP ? 'Os primeiros' : 'Hoje'}: ${_horariosENomes(lista, PRIMEIROS_NO_ZAP)}`;
  return n > PRIMEIROS_NO_ZAP
    ? `${corpo}\nMe peça a lista de contrato que eu mando ela inteira.`
    : corpo;
}

// Os N primeiros HORÁRIOS, não os N primeiros nomes alfabéticos: quem chega às 8h é quem
// importa quando o dia começa. A lista inteira mora no painel.
// `unidadeNome` não entra no texto de propósito: a mensagem já vai pro grupo daquela
// unidade — repetir o nome seria redundante. Não é esquecimento; não "conserte" tirando o parâmetro.
function mensagemDoGrupo({ itens, contrato, contratoErro, unidadeNome, dataBr } = {}) {
  const lista = itens || [];
  if (!lista.length) return null;
  const n = lista.length;
  const cabeca = _horariosENomes(lista, PRIMEIROS_NO_ZAP);
  const blocoAnamnese = `📋 *Anamnese — hoje (${dataBr})*\n`
    + `${_alunosComAula(n)} ainda sem anamnese.\n`
    + `${n > PRIMEIROS_NO_ZAP ? 'Os primeiros' : 'Hoje'}: ${cabeca}\n`
    + 'A lista completa está no painel do grupo.';
  // Linha EM BRANCO entre os dois: é o "separadinho" que o dono pediu. No WhatsApp é o que faz
  // o olho ver duas demandas e não um bolo só.
  const blocoContrato = _blocoDeContrato({ contrato, contratoErro, dataBr });
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
function alunosDaHora({ anamnese, contrato, hora } = {}) {
  if (!hora) return [];   // sem hora não há "próxima hora" — nada a dizer
  const porChave = new Map();
  const somar = (lista, pendencia) => {
    for (const item of (lista || [])) {
      if (!item || item.hora !== hora) continue;
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
  somar(contrato, 'contrato');
  // Ordem alfabética: dentro de uma hora só, o horário não desempata nada, e a ordem em que a RPC
  // devolveu as linhas mudaria de um slot pro outro sem motivo nenhum que a equipe entenda.
  return [...porChave.values()]
    .map((i) => ({ ...i, pendencias: ORDEM_PENDENCIAS.filter((p) => i.pendencias.has(p)) }))
    .sort((a, b) => String(a.pessoa.nome || '').localeCompare(String(b.pessoa.nome || ''), 'pt-BR'));
}

// O texto. Curto por desenho: quem lê é a secretaria no meio do expediente, de pé, com aluno na
// frente. Cabeçalho + uma linha por aluno, nada de rodapé ensinando a pedir lista — a lista do dia
// já saiu de manhã e está no painel.
//
// A HORA no cabeçalho não é enfeite: a primeira linha é a chave da guarda de duplicata do
// dispatcher (`like('content', cabeçalho%)`), e sem a hora o lembrete das 16:00 casaria o
// cabeçalho do das 15:00 — e nunca sairia.
function lembreteDaProximaHora({ itens, hora } = {}) {
  if (!hora) return null;
  const linhas = [];
  for (const i of (itens || [])) {
    // Item sem pendência nenhuma não vira linha: "· Fulano — " não diz nada e é pior que ausência.
    const rotulo = (i && i.pendencias || []).join(' e ');
    if (!rotulo) continue;
    const nome = (i.pessoa && i.pessoa.nome) || '?';
    linhas.push(`· ${nome}${i.curso ? ` (${i.curso})` : ''} — ${rotulo}`);
  }
  // Hora sem ninguém pendente NÃO gera mensagem: silêncio ali é notícia boa. Quem distingue "zero
  // por saúde" de "zero por falha" é o marcador que o dispatcher grava, não a ausência de texto.
  if (!linhas.length) return null;
  return [`⏰ *Próxima hora — ${hora}*`, ...linhas].join('\n');
}

module.exports = {
  diaDaAula, horaDaAula, pautaDoDia, DIAS,
  degrau, tituloDaFilha, tituloDaEscalada, separarPorDegrau,
  mensagemDoGrupo, PRIMEIROS_NO_ZAP,
  mensagemDeFimDeDia, FALTARAM_NO_ZAP,
  alunosDaHora, lembreteDaProximaHora, LINHA_LEMBRETE_HORA,
};

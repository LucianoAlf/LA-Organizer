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

// Os N primeiros HORÁRIOS, não os N primeiros nomes alfabéticos: quem chega às 8h é quem
// importa quando o dia começa. A lista inteira mora no painel.
// `unidadeNome` não entra no texto de propósito: a mensagem já vai pro grupo daquela
// unidade — repetir o nome seria redundante. Não é esquecimento; não "conserte" tirando o parâmetro.
function mensagemDoGrupo({ itens, unidadeNome, dataBr } = {}) {
  const lista = itens || [];
  if (!lista.length) return null;
  const n = lista.length;
  // Item torto (sem pessoa, sem hora) não pode derrubar a mensagem da unidade inteira
  // nem vazar a palavra "undefined" pro zap que a equipe lê — '?' e '--:--' são feios,
  // mas muito melhores que um TypeError às 07:30 ou um "undefined" na frente da equipe.
  const cabeca = lista.slice(0, PRIMEIROS_NO_ZAP)
    .map((i) => `${i.hora || '--:--'} ${(i.pessoa && i.pessoa.nome) || '?'}`).join(' · ');
  return `📋 *Anamnese — hoje (${dataBr})*\n`
    + `${n} aluno${n > 1 ? 's' : ''} com aula hoje ainda sem anamnese.\n`
    + `${n > PRIMEIROS_NO_ZAP ? 'Os primeiros' : 'Hoje'}: ${cabeca}\n`
    + 'A lista completa está no painel do grupo.';
}

module.exports = {
  diaDaAula, horaDaAula, pautaDoDia, DIAS,
  degrau, tituloDaFilha, tituloDaEscalada, separarPorDegrau,
  mensagemDoGrupo, PRIMEIROS_NO_ZAP,
};

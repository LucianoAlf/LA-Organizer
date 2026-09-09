'use strict';
// habito-confirmado.js — HABITO-CONFIRMADO-NAO-TEM-ONDE-CAIR (Bianca, 19/07 a 09/09/2026).
//
// A Bianca recebe o briefing "PESSOAL · hoje: 💪 Tomar remédios" e responde "Remédios tomados".
// Em 52 dias ela fez isso pelo menos 6 vezes (19/07, 19/08, 01/09, 03/09, 05/09, 09/09) e o
// hábito tem OITO registros no total. O último é de 07/09 — o de 09/09 não existe.
//
// Por que ninguém pegava. São três vãos em fila, e o pedido dela cai em todos:
//
//   1. O briefing lembra o hábito mas NÃO grava `ref_type`/`ref_id` em conversation_history.
//      A Fatia 1 determinística (resolverConclusaoDeLembrete) só lê `ref_type='task'` — então
//      ela nunca vê o briefing, e não há âncora nenhuma pra confirmação seca.
//   2. O bloco PESSOAL do briefing renderiza HÁBITO e TAREFA misturados. Quando o LLM tenta
//      agir, emite <<TASK_UPDATE>> action=complete title="Tomar remédios" — e o resolvedor de
//      tarefa não acha nada em `tasks` (0 linhas), gravando `all_failed:1` com `fails:[]`.
//      Não existe queda de TASK_UPDATE para HABIT_ACTION.
//   3. Em 09/09 ele nem tentou: o turno saiu só com <<REACT>>✅<<END>>. Ela recebeu o ✅ —
//      que pra ela quer dizer "registrei" — e nada foi gravado. A prova está três linhas acima
//      no próprio briefing: *streak: 1 dia*, depois de meses avisando.
//
// Este módulo fecha o vão 1 pelo lado que não depende do LLM: se a pessoa diz que fez, e o
// nome bate com UM hábito ativo dela, o engine grava ANTES de chamar o modelo — igual à Fatia 1
// faz com tarefa. A decisão mora aqui, pura e testável; a escrita fica no applyHabitActions,
// que já sabe fazer upsert do dia e recalcular streak.
//
// FAIL-CLOSED em tudo que não for certeza: negação, futuro, pergunta e empate entre dois
// hábitos não gravam nada e devolvem 'nenhum'. Marcar hábito errado é pior que não marcar —
// quem não marcou pode marcar depois; quem marcou errado corrompeu o streak, que é o único
// número que a pessoa usa pra saber se está conseguindo.

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na',
  'nos', 'nas', 'um', 'uma', 'por', 'para', 'pra', 'com', 'meu', 'minha', 'ao',
]);

// Só marca conclusão quem AFIRMA ter feito. "ok" e "sim" ficam de fora de propósito:
// sozinhos eles não dizem O QUE foi feito, e sem isso o casamento por nome não tem âncora.
const CONCLUSAO_RE = /\b(feit[oa]s?|fiz|tomad[oa]s?|tomei|bebi|comi|corri|treinei|conclu[ií]d[oa]s?|conclui|pronto|prontinho|finalizad[oa]s?|check|ja (fiz|foi|tomei|tomado))\b/i;

// Qualquer um destes derruba o turno inteiro: são as formas de dizer que NÃO fez, ou ainda não.
const NEGACAO_RE = /\b(n[ãa]o|nao|nem|esqueci|esquec[ie]|faltou|deixei de|sem)\b/i;
const FUTURO_RE = /\b(vou|irei|pretendo|amanh[ãa]|depois|mais tarde|daqui a pouco|logo mais|preciso)\b/i;

function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function tokens(s) {
  return normalizar(s).split(/[^a-z0-9]+/).filter(Boolean);
}

// Token do NOME é "forte" se tem 4+ letras e não é palavra de ligação. Nome de hábito costuma
// ser "Tomar remédios", "Beber água", "Ler 20 páginas" — o substantivo é o que identifica.
function tokensFortes(nome) {
  return tokens(nome).filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

// Casamento por PREFIXO de 4, não por igualdade: "tomar" (do nome) precisa alcançar "tomados"
// (do texto), e "correr" precisa alcançar "corri". Igualdade exata perderia os dois, que são
// justamente a forma como a pessoa fala — ela conjuga o verbo, o cadastro não.
function casaToken(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 4) return false;
  return a.slice(0, 4) === b.slice(0, 4) && (a.startsWith(b) || b.startsWith(a));
}

/**
 * Decide se uma fala confirma a conclusão de UM hábito ativo da pessoa.
 *
 * @param {object} entrada
 * @param {string} entrada.texto      fala da pessoa (inbound cru)
 * @param {Array}  entrada.habitos    [{ id, name }] — hábitos ATIVOS do colaborador
 * @returns {{modo:'exato'|'ambiguo'|'nenhum', habitId?:string, candidatos?:Array}}
 */
function resolverConclusaoDeHabito(entrada) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const texto = String(e.texto == null ? '' : e.texto).trim();
  const habitos = Array.isArray(e.habitos) ? e.habitos : [];
  if (!texto || !habitos.length) return { modo: 'nenhum' };

  // Fala longa não é confirmação seca: é conversa, e conversa é assunto do LLM. O teto de 12
  // palavras deixa passar "remédios tomados", "já tomei os remédios hoje de manhã" e barra
  // parágrafo em que o nome do hábito aparece de passagem.
  if (tokens(texto).length > 12) return { modo: 'nenhum' };
  if (/\?\s*$/.test(texto)) return { modo: 'nenhum' };
  if (NEGACAO_RE.test(texto)) return { modo: 'nenhum' };
  if (FUTURO_RE.test(texto)) return { modo: 'nenhum' };
  if (!CONCLUSAO_RE.test(texto)) return { modo: 'nenhum' };

  const tt = tokens(texto);
  const candidatos = [];
  for (const h of habitos) {
    if (!h || !h.id || !h.name) continue;
    const fortes = tokensFortes(h.name);
    if (!fortes.length) continue;
    const casados = fortes.filter((f) => tt.some((t) => casaToken(f, t)));
    if (casados.length >= 1) candidatos.push({ id: h.id, name: h.name, casados: casados.length });
  }
  if (!candidatos.length) return { modo: 'nenhum' };

  // Desempate por FORÇA, não por ordem: "Tomar remédios" casando 2 tokens ganha de um hábito
  // que casou 1. Empate no topo é ambiguidade real — aí não grava nada e deixa pro LLM
  // perguntar, que é o mesmo freio da Fatia 1 de tarefa.
  candidatos.sort((a, b) => b.casados - a.casados);
  if (candidatos.length > 1 && candidatos[0].casados === candidatos[1].casados) {
    return { modo: 'ambiguo', candidatos };
  }
  return { modo: 'exato', habitId: candidatos[0].id, nome: candidatos[0].name };
}

module.exports = { resolverConclusaoDeHabito };

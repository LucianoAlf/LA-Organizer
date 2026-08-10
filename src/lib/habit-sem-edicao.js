'use strict';
// habit-sem-edicao.js — quando a capacidade não existe, o TOM mostra o caminho. PURO.
//
// HABIT-EDIT-SEM-CAMINHO (10/08/2026). Editar hábito por conversa não existe: o engine
// implementa create/log/query_progress/delete, e a skill ensina os mesmos quatro. Quando alguém
// pede uma alteração ("tira o lembrete das 6h"), o LLM inventa `action:update`, o validador
// devolve `unknown_action` e nada acontece.
//
// Até 10/08 isso saía como confirmação falsa (HABIT-UPDATE-SILENT-LIE). O fix daquele bug fez o
// TOM parar de mentir — mas a fala honesta genérica ("não consegui registrar, me manda de novo")
// convida a pessoa a repetir um pedido que NUNCA vai funcionar. Honestidade sem saída é beco.
//
// Decisão do Alf: mostrar o caminho. A capacidade continua fora (feature freeze); o que muda é
// que a pessoa sai da conversa sabendo aonde ir. A aba *Hábitos* fica na barra inferior do app
// (web/src/components/BottomNav.tsx), então o caminho é curto e não precisa de instrução longa.

const { sanitizeOptimisticConfirm } = require('./optimistic-confirm');

// Rastro exato de "o LLM pediu uma ação que não existe" — vem de validateHabitAction, no formato
// "action[i]:motivo". Erro de schema em ação EXISTENTE (bad_habit_id, name_missing) fica de fora
// de propósito: ali o pedido é possível, e mandar pro app seria empurrar trabalho que o TOM faz.
const RE_SEM_CAPACIDADE = /(^|:)unknown_action$/;

function pediuEdicaoDeHabito(motivos) {
  if (!Array.isArray(motivos)) return false;
  return motivos.some((m) => typeof m === 'string' && RE_SEM_CAPACIDADE.test(m.trim()));
}

// Sem "me manda de novo": repetir não resolve. Sem verbo de conclusão: se afirmasse qualquer
// coisa feita, o chokepoint rebaixaria esta própria mensagem e a pessoa ficaria sem o caminho.
const CAMINHO = '_Editar hábito eu ainda não consigo fazer por aqui. Pra mexer no lembrete: abre o app, aba *Hábitos*, toca no hábito e ajusta o horário._';

/**
 * Devolve a fala já sem a confirmação falsa e com o caminho no fim.
 * @param {string} textoLimpo  cleanText do marker (a fala do LLM sem o bloco).
 */
function respostaSemEdicaoDeHabito(textoLimpo) {
  const t = typeof textoLimpo === 'string' ? textoLimpo : '';
  // includeWeak: a fala da Bianca ("Beleza! Hábito continua, só sem o toque das 6h") não tem
  // verbo forte — sem o fraco a mentira ficaria acima do caminho, e quem lê acredita na primeira.
  const base = t.trim() ? sanitizeOptimisticConfirm(t, 'failed', { includeWeak: true }).trim() : '';
  return base ? `${base}\n\n${CAMINHO}` : CAMINHO;
}

module.exports = { pediuEdicaoDeHabito, respostaSemEdicaoDeHabito, CAMINHO };

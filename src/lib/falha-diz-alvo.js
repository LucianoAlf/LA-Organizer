'use strict';
// src/lib/falha-diz-alvo.js — quando a ação falha, a resposta diz QUAL alvo não foi achado.
//
// A RAIZ do TASK-COMPLETE-ALVO-NAO-ACHADO (reincidiu 2×, em parada desde 14/08).
//
// O engine tem **101** `failCount++` e **um** empurra mensagem em `failMessages`. Os outros
// 100 caem no genérico "_não consegui registrar agora. Me passa de novo?_", que não diz o que
// falhou. A pessoa reenvia exatamente a mesma coisa e leva exatamente a mesma resposta — a
// Mayra provou o beco repetindo "Feito" → "Feito tom", e o Quintela levou o mesmo beco em dois
// dias seguidos.
//
// POR QUE AQUI E NÃO NOS 101: o fix de 13/08 deu fala honesta ao handler `complete` — cobriu 1
// e reincidiu, porque o padrão está espalhado. Guard por caminho de código vira queijo suíço
// (antipadrão 13.1 do manual de governança). Este módulo é chamado do PONTO ÚNICO DE SAÍDA,
// onde os 101 convergem: `engine.js`, ramo `failCount > 0 && okCount === 0`.
//
// O que ele NÃO faz: adivinhar por que falhou. Só nomeia o que foi tentado — que é o que
// permite à pessoa corrigir o nome, ou perceber que a tarefa é de outra pessoa.

const GENERICO = '_não consegui registrar agora. Me passa de novo?_';
const MAX_TITULOS = 3;
const MAX_CHARS = 48;

// Verbo por ação. `create` fica de fora de propósito: ele não PROCURA alvo nenhum, então
// "não achei 'Comprar pão'" seria absurdo — ele deveria criar, não achar.
const VERBO = {
  complete: 'concluir',
  cancel: 'cancelar',
  reschedule: 'remarcar',
  delegate: 'delegar',
  update: 'atualizar',
  snooze: 'adiar',
};

const _corta = (s) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s);

/**
 * Fala honesta que nomeia o alvo não encontrado.
 * Cai no genérico quando não há o que nomear — inventar nome é pior que não nomear.
 *
 * @param {Array<{action?:string, title?:string}>} actions ações do marker que falharam
 * @returns {string} a fala (nunca vazia)
 */
function falaDoQueTentou(actions) {
  const lista = Array.isArray(actions) ? actions : [];
  const comAlvo = lista.filter((a) => a && VERBO[a.action] && typeof a.title === 'string' && a.title.trim());
  if (!comAlvo.length) return GENERICO;

  // Verbo do primeiro: misturar "concluir e remarcar" numa frase só fica pior que o genérico.
  // Ações de tipos diferentes no mesmo marker são raras; quando houver, o primeiro manda.
  const verbo = VERBO[comAlvo[0].action];
  const titulos = [...new Set(comAlvo.map((a) => _corta(a.title.trim())))];
  const mostra = titulos.slice(0, MAX_TITULOS).map((t) => `*${t}*`).join(', ');
  const resto = titulos.length > MAX_TITULOS ? ` +${titulos.length - MAX_TITULOS}` : '';

  return `_Não achei ${titulos.length > 1 ? 'essas tarefas' : 'essa tarefa'} pra ${verbo}: ${mostra}${resto}. `
    + 'Confere o nome, ou me diz de outro jeito que eu procuro._';
}

module.exports = { falaDoQueTentou, GENERICO };

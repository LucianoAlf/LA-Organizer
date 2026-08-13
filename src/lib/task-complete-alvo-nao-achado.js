'use strict';
// task-complete-alvo-nao-achado.js — o `complete` para de falhar mudo. PURO.
//
// TASK-COMPLETE-ALVO-NAO-ACHADO (Clayton 11/08 15:02, Mayra 11/08 13:47+13:48). O title-lookup
// do handler `complete` (engine.js:4507) fazia `failCount++` sem empurrar nada em `failMessages`.
// Vazia, ela não passa no teste de engine.js:11054 e a resposta cai no genérico
// "_não consegui registrar agora. Me passa de novo?_".
//
// No caso do Clayton isso é um beco: a tarefa é da Fefê (ele criou e delegou) e o handler casa só
// por `assigned_to` — de propósito, e essa parte não muda aqui. Repetir devolve a mesma falha
// para sempre. A Mayra provou o beco na prática: repetiu ("Feito" → "Feito tom") e levou a mesma
// resposta nos dois turnos.
//
// Os irmãos já resolviam: `reschedule` nomeia o dono (engine.js:4879-4888) e `snooze` diz que não
// achou (engine.js:5042). Este módulo é a mesma cortesia para o `complete`, que é a ação mais
// usada do sistema.

const LIMITE_TITULO = 60;

function _titulo(t) {
  const s = typeof t === 'string' ? t.trim() : '';
  if (!s) return 'essa tarefa';
  return s.length > LIMITE_TITULO ? `${s.slice(0, LIMITE_TITULO)}…` : s;
}

/**
 * Fala honesta para "não achei a tarefa pra concluir".
 * Nunca devolve vazio: é o retorno vazio que joga o engine no genérico.
 *
 * @param {string} titulo    o que o marker pediu pra concluir.
 * @param {string} [donoNome] full_name do responsável, quando a tarefa existe pra outra pessoa.
 * @returns {string} sempre não-vazia, sem pedido de repetição e sem afirmar conclusão.
 */
function mensagemAlvoNaoAchado(titulo, donoNome) {
  const alvo = _titulo(titulo);
  const dono = typeof donoNome === 'string' ? donoNome.trim() : '';
  if (dono) {
    // Sem pronome: chutar gênero pelo fim do nome erraria já no primeiro caso real ("Fefê", que
    // o Clayton trata por "ela"). "de <Nome>" serve pra qualquer nome.
    const primeiro = dono.split(/\s+/)[0];
    return `_*${alvo}* é tarefa de *${primeiro}* — a baixa quem dá é quem tá com ela, então não consigo fechar essa por aqui._`;
  }
  return `_Não achei nenhuma tarefa aberta chamada *${alvo}* no teu nome. Me diz qual é que eu fecho._`;
}

module.exports = { mensagemAlvoNaoAchado, LIMITE_TITULO };

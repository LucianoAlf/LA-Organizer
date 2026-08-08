'use strict';
// confirm-create-gate.js — decide se uma pergunta de confirmação SEM payload executável
// pode liberar marker de CRIAÇÃO. PURO.
//
// O PROBLEMA (F3 de TASK-CONFIRM-DONE-NOOP, medido em 08/08)
// A intent genérica de fim de turno (engine.js ~13116) nasce com payload
// {last_user_text, last_tom_reply} — e nenhum desses campos está em `hasConcrete`
// (engine.js ~10112). Então TODA intent genérica cai no ramo "sem item concreto", cujo
// markerRule manda o TOM dizer que não conseguiu e pedir pra pessoa repetir. Em 15 casos
// medidos o TOM tinha acabado de descrever a coisa na própria pergunta ("Entendi: lembrete
// amanhã às 11h — mandar mensagem pro Rômulo. Certo?") e a confirmação do usuário era
// inequívoca em 100% deles. A informação existia; só a REGRA proibia agir.
//
// POR QUE A PROIBIÇÃO EXISTE (e não pode simplesmente cair)
// Caso Conciliação/Rose 10/06: com payload vazio e "emita o marker AGORA", o LLM escolheu
// alvos sozinho e REAGENDOU 2 tarefas que ela nunca pediu. O perigo é sempre o mesmo —
// o LLM chutar QUAL item existente tocar. Quando a proposta é de CRIAÇÃO isso não se aplica:
// não há alvo a chutar, o item é o que o próprio TOM acabou de descrever.
//
// Daí o gate: libera só quando a pergunta é reconhecidamente uma proposta de criação E não
// menciona ação sobre item que já existe. FAIL-CLOSED — sem sinal claro de criação devolve
// false, e o comportamento segue o de hoje (fricção honesta, que é ruim mas não estraga nada).
//
// LIMITE ACEITO DE PROPÓSITO: o título da coisa a criar pode conter um verbo de edição
// ("tarefa *Reagendar retorno na neuropediatra*"). O gate bloqueia esse caso e perde uma
// criação legítima. Preferimos perder uma do que arriscar duplicar/alterar item existente —
// o custo de errar é assimétrico.

// Ação sobre item que JÁ EXISTE. Qualquer um destes veta, mesmo com sinal de criação junto.
const ACAO_SOBRE_EXISTENTE = new RegExp([
  'deleg\\w*', 'fechament\\w*', '\\bfech(?:a|ar|o)\\b', 'conclu\\w+', 'reagend\\w+',
  '\\bremarc\\w+', 'cancel\\w+', '\\badia\\w*\\b', '\\bapag\\w+', '\\bdelet\\w+',
  '\\bexclu\\w+', 'd[áa]\\s+baixa', 'dar\\s+baixa', 'marc\\w*\\s+como\\s+feit\\w*',
  'tir(?:o|ar)\\s+da\\s+(?:sua\\s+)?fila', 'estorn\\w+', '\\blan[çc]\\w+',
  'j[áa]\\s+existe', 'atualiz\\w+', '\\bedit\\w+',
].join('|'), 'iu');

// Sinal de que o TOM está PROPONDO criar algo novo (tarefa, lembrete, compromisso, plano).
const PROPOE_CRIACAO = new RegExp([
  'lembret\\w*', 'te\\s+lembr\\w+', 'me\\s+lembr\\w+', '\\bcompromisso\\w*',
  '\\bevento\\w*', '\\bagend(?:a|o|ar)\\b', '\\breuni[ãa]o\\w*', '\\bviagem\\b',
  'plano\\s+da\\s+semana', '\\btarefa\\w*', '\\bcri(?:o|ar|ando)\\b',
  '\\banot(?:o|ar)\\b', '\\bregistr(?:o|ar)\\b',
].join('|'), 'iu');

/**
 * A pergunta de confirmação pode liberar marker de CRIAÇÃO?
 * @param {string} perguntaDoTom  question_text da intent (o que o TOM perguntou)
 * @returns {boolean} true só quando é proposta de criação sem menção a item existente
 */
function podeLiberarCriacao(perguntaDoTom) {
  if (typeof perguntaDoTom !== 'string') return false;
  const t = perguntaDoTom.trim();
  if (!t) return false;
  if (ACAO_SOBRE_EXISTENTE.test(t)) return false;  // veta primeiro (fail-closed)
  return PROPOE_CRIACAO.test(t);
}

module.exports = { podeLiberarCriacao, ACAO_SOBRE_EXISTENTE, PROPOE_CRIACAO };

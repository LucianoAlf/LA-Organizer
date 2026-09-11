'use strict';
// edicao-tarefa.js — TASK-UPDATE-NAO-EXISTIA (Alf decidiu em 10/09/2026: opção A).
//
// Em 90 dias quatro pessoas pediram pro TOM editar uma tarefa já criada: renomear (Yuri 28/07),
// acrescentar detalhe (Dudu 27/08 e 09/09), mover pro grupo Financeiro (Rose 26/07). O TOM até
// oferecia "Crio nova ou atualizo a existente?" — mas `update` não existia no executor de
// tarefas: o marker caía como schema_invalid e a pessoa lia "não consegui".
//
// Este módulo lê o pedido nos formatos que o LLM REALMENTE emitiu (medidos em marker_logs) e
// monta a alteração. PURO: quem acha a tarefa, resolve o grupo e grava é o engine.
//   • com `id`   → `title` é o NOME NOVO (Yuri: {id, title});
//   • sem `id`   → `title` é a tarefa de HOJE, pra achar (Dudu: {title, notes});
//   • `new_title` é sempre nome novo;
//   • detalhe (`notes`/`description`) é ACRESCENTADO ao que já existe — nunca apaga o que a
//     pessoa escreveu antes;
//   • `assigned_group` move a tarefa pro grupo, e o grupo vira o dono exclusivo (o banco exige
//     exatamente um dono: sai o responsável individual).
// Data e lembrete não passam por aqui: continuam no `reschedule`.

const CAMPOS_DE_DETALHE = ['notes', 'description', 'details', 'detalhes'];
const MAX_TITULO = 200;
const MAX_DETALHE = 2000;
const { lerFlag } = require('./lembrete-diario');

function _t(v) { return typeof v === 'string' ? v.trim() : ''; }

/**
 * @returns {{erro:string} | {id:string|null, busca:string|null, novoTitulo:string, detalhe:string, grupo:string}}
 */
function lerEdicao(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { erro: 'not_object' };
  const id = _t(a.id) || null;
  const titulo = _t(a.title);
  // LEMBRETE-DIARIO-POR-TAREFA (Alf 11/09): com o flag e sem new_title, o `title` só identifica —
  // não renomeia (o LLM manda o nome junto com o id).
  const lembreteDiario = lerFlag(a.lembrete_diario);
  const novoTitulo = (_t(a.new_title) || (id && lembreteDiario === null ? titulo : '')).slice(0, MAX_TITULO);
  const busca = id ? null : (titulo || null);
  const detalhe = (CAMPOS_DE_DETALHE.map((k) => _t(a[k])).find(Boolean) || '').slice(0, MAX_DETALHE);
  const grupo = _t(a.assigned_group) || _t(a.group);
  if (!id && !busca) return { erro: 'bad_id' };
  if (!novoTitulo && !detalhe && !grupo && lembreteDiario === null) return { erro: 'update:no_editable_field' };
  return { id, busca, novoTitulo, detalhe, grupo, lembreteDiario };
}

/**
 * @param {object} edicao     saída de lerEdicao (sem erro)
 * @param {object} atual      linha da tarefa: {title, description, assigned_group_id}
 * @param {{id:string, name:string}|null} grupo  grupo já resolvido pelo engine
 * @returns {{patch:object, mudancas:string[]}}
 */
function montarPatch(edicao, atual, grupo = null) {
  const patch = {};
  const mudancas = [];
  const t = atual || {};
  if (edicao.novoTitulo && edicao.novoTitulo !== _t(t.title)) {
    patch.title = edicao.novoTitulo;
    mudancas.push('título');
  }
  if (edicao.detalhe) {
    const antes = _t(t.description);
    if (!antes.toLowerCase().includes(edicao.detalhe.toLowerCase())) {
      patch.description = (antes ? `${antes}\n${edicao.detalhe}` : edicao.detalhe).slice(0, 4000);
      mudancas.push('detalhe');
    }
  }
  if (grupo && grupo.id && grupo.id !== t.assigned_group_id) {
    patch.assigned_group_id = grupo.id;
    patch.assigned_to = null;
    mudancas.push(`grupo ${grupo.name || ''}`.trim());
  }
  if (edicao.lembreteDiario === true || edicao.lembreteDiario === false) {
    if (edicao.lembreteDiario !== (t.lembrete_diario === true)) {
      patch.lembrete_diario = edicao.lembreteDiario;
      mudancas.push(edicao.lembreteDiario ? 'lembrete diário ligado' : 'lembrete diário desligado');
    }
  }
  return { patch, mudancas };
}

module.exports = { lerEdicao, montarPatch };

'use strict';
// membros-fantasma.js — SAIR-DO-GRUPO-NAO-CHEGA-NO-APP (Alf, 09/09/2026).
//
// O Alf saiu dos grupos operacionais no WhatsApp de propósito — está registrado nas memórias
// de 08/09: "saiu do grupo para não acompanhar o dia a dia operacional". Mas a agenda dele
// continuou mostrando os pacotes de anamnese da Barra, dia após dia: 27 tarefas numa tela que
// deveria estar vazia.
//
// A visibilidade da agenda (`fetchTasksForDay`, web/src/lib/dayItems.ts) é
// `assigned_to = eu OU created_by = eu OU assigned_group_id IN (meus grupos)`, e "meus grupos"
// vem de `useMyGroupIds` — que lê `work_group_members` e nada mais. Sem bypass de diretor,
// corretamente. O problema é que NADA remove a linha quando a pessoa sai do grupo no WhatsApp:
// `getGroupParticipants` só é usado pra descobrir quem falou, nunca pra atualizar a membresia.
// E a tabela sequer tem coluna de saída — `group_id, collaborator_id, added_by, created_at`.
//
// Sair não tem representação no modelo. A pessoa sai do grupo e o app não fica sabendo.
//
// Este módulo NÃO remove ninguém: só compara e nomeia. Remover sozinho seria perigoso — se a
// API do WhatsApp devolver lista vazia ou incompleta num dia ruim, o "conserto" automático
// esvaziaria os grupos e as tarefas sumiriam da agenda de todo mundo. Fail-closed: lista vazia
// ou ilegível não acusa ninguém.
//
// Medido em 09/09, depois de tirar o Alf: zero fantasmas nos outros cinco grupos. Ele era o
// único — mas era o dono do produto, e olhou pra tela achando que o app estava quebrado.

/** Só os 4 últimos dígitos: o 9º dígito e o DDI variam entre as duas fontes, e telefone
 *  inteiro nunca sai daqui — nem em log, nem em retorno. */
function _fim(tel) {
  return String(tel == null ? '' : tel).replace(/\D/g, '').slice(-4);
}

/** Extrai o telefone de um participante, que a API devolve em formatos diferentes. */
function _telDoParticipante(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return p.id || p.jid || p.phone || '';
}

/**
 * Quem está no app e NÃO está mais no grupo do WhatsApp.
 *
 * @param {object} e
 * @param {Array}  e.noApp            [{ full_name, phone }] de work_group_members
 * @param {Array}  e.participantesWa  lista crua da API (strings ou objetos)
 * @returns {{fantasmas: Array, aferido: boolean, motivo?: string}}
 */
function comparaMembresia(e) {
  const ent = e && typeof e === 'object' ? e : {};
  const noApp = Array.isArray(ent.noApp) ? ent.noApp.filter(Boolean) : [];
  const parts = Array.isArray(ent.participantesWa) ? ent.participantesWa : null;

  // Sem lista confiável, não acusa. Um dia ruim da API não pode virar acusação de que o time
  // inteiro saiu dos grupos.
  if (!parts || parts.length === 0) {
    return { fantasmas: [], aferido: false, motivo: 'lista do WhatsApp vazia ou indisponível' };
  }
  const fins = new Set(parts.map((p) => _fim(_telDoParticipante(p))).filter(Boolean));
  if (fins.size === 0) {
    return { fantasmas: [], aferido: false, motivo: 'nenhum telefone legível na lista' };
  }

  const fantasmas = noApp.filter((c) => {
    const f = _fim(c && c.phone);
    // Cadastro sem telefone não dá pra conferir — e na dúvida não acusa.
    if (!f) return false;
    return !fins.has(f);
  }).map((c) => (c && c.full_name) || 'sem nome');

  return { fantasmas, aferido: true };
}

/** Texto do check. Sem número de telefone, sempre. */
function resumirFantasmas(linhas) {
  const arr = Array.isArray(linhas) ? linhas : [];
  const comFantasma = arr.filter((l) => l && l.aferido && l.fantasmas && l.fantasmas.length);
  const naoAferidos = arr.filter((l) => l && !l.aferido).length;
  const sufixo = naoAferidos ? ` · ${naoAferidos} grupo(s) não aferido(s)` : '';

  if (!comFantasma.length) {
    return { status: 'ok', detail: `Membresia do app bate com o WhatsApp em ${arr.length - naoAferidos} grupo(s)${sufixo}` };
  }
  const txt = comFantasma
    .map((l) => `${l.grupo}: ${l.fantasmas.join(', ')}`)
    .join(' | ');
  return {
    status: 'warning',
    detail: `👻 ${comFantasma.length} grupo(s) com quem já saiu do WhatsApp e continua vendo as tarefas no app — ${txt}${sufixo}`,
  };
}

module.exports = { comparaMembresia, resumirFantasmas };

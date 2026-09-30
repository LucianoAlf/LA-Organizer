'use strict';
// delegacao-itens-resolve.js — prova POR ITEM de uma pergunta de delegação (auditoria 30/09).
//
// Recebe os itens {task_title, to_name} do delegate-question-parse e decide, com o banco, UMA de três:
//   'nova'       — NENHUM item tem tarefa aberta parecida (atribuída A ou criada POR quem pediu).
//                  → payload.delegacao_nova {task_title, to_name, itens:[…]}: o create-gate libera a
//                    criação, e a regra do LLM fica escopada a ESTES itens.
//   'existente'  — UM item só, e ele é o TÍTULO INTEIRO de UMA tarefa minha (resolveTaskTarget
//                  'exato'). → payload.delegation {task_id, to_name}: repasse determinístico.
//   'ambigua'    — qualquer outra coisa com candidato no banco: item já existe numa lista, fragmento
//                  que casa com tarefa de título maior, linhagens distintas… → payload.delegacao_ambigua:
//                  no "sim" o TOM PERGUNTA ("é essa ou crio nova?") em vez de agir.
//   null         — leitura do banco falhou: nada estagiado (fail-closed, como antes).
//
// Por que "título inteiro": o ilike '%fragmento%' + resolveTaskTarget dava 'exato' com UM candidato
// qualquer. "delegar pra Kailane: *Ligar pro lead*" com uma "Ligar pro lead da Ana — matrícula" aberta
// repassava a da Ana — tarefa que ninguém citou. Delegar a tarefa errada é pior que perguntar.
//
// Puro: as consultas são INJETADAS (engine: tasks abertas por assigned_to e por created_by de quem
// pediu). TITULO-REESCRITO (29/09): o engine não filtra mais por ilike — o filtro é aqui, por
// tarefasParecidas (lib/titulo-mesma-tarefa): contém o trecho OU é a mesma tarefa por conteúdo.
// Sem isso, título reescrito pelo TOM ("ver o vídeo da Vitória" × "Ver o vídeo de registro de
// visitas (postado pela Vitória no grupo)") virava 'nova' e o "sim" criava duplicata.

const { tarefasParecidas } = require('../lib/titulo-mesma-tarefa');

function _short(id) {
  return String(id).replace(/-/g, '').slice(0, 8);
}

function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** O título da tarefa é o MESMO que o citado (tolera caixa, acento, pontuação e sufixo " — Unidade"). */
function tituloCasaInteiro(tituloTarefa, tituloCitado) {
  const q = _norm(tituloCitado);
  if (!q) return false;
  if (_norm(tituloTarefa) === q) return true;
  const semSufixo = String(tituloTarefa || '').split(/\s+[—–-]\s+/)[0];
  return _norm(semSufixo) === q;
}

async function classificarItensDelegacao({ itens, queryDono, queryCriadas, resolveTaskTarget } = {}) {
  if (!Array.isArray(itens) || !itens.length) return null;
  if (typeof queryDono !== 'function' || typeof queryCriadas !== 'function' || typeof resolveTaskTarget !== 'function') return null;

  const avaliados = [];
  for (const it of itens) {
    if (!it || !it.task_title || !it.to_name) return null;
    let dono;
    let criadas;
    try {
      [dono, criadas] = await Promise.all([queryDono(it.task_title), queryCriadas(it.task_title)]);
    } catch (_) {
      return null; // leitura falhou → não prova nada
    }
    if (!Array.isArray(dono) || !Array.isArray(criadas)) return null;
    dono = tarefasParecidas(dono, it.task_title);
    criadas = tarefasParecidas(criadas, it.task_title);
    const porId = new Map();
    for (const t of [...dono, ...criadas]) if (t && t.id) porId.set(t.id, t);
    avaliados.push({
      task_title: it.task_title,
      to_name: it.to_name,
      candidatos: [...porId.values()],
      donoIds: new Set(dono.filter((t) => t && t.id).map((t) => t.id)),
    });
  }

  const limpos = itens.map(({ task_title, to_name }) => ({ task_title, to_name }));
  if (avaliados.every((a) => a.candidatos.length === 0)) {
    return { tipo: 'nova', delegacao_nova: { task_title: limpos[0].task_title, to_name: limpos[0].to_name, itens: limpos } };
  }

  if (avaliados.length === 1) {
    const a = avaliados[0];
    const r = resolveTaskTarget({ candidatos: a.candidatos });
    if (r && r.modo === 'exato' && r.tarefa && r.tarefa.id && a.donoIds.has(r.tarefa.id)
        && tituloCasaInteiro(r.tarefa.title, a.task_title)) {
      return { tipo: 'existente', delegation: { task_id: _short(r.tarefa.id), to_name: a.to_name } };
    }
  }

  return {
    tipo: 'ambigua',
    delegacao_ambigua: {
      itens: avaliados.map((a) => ({
        task_title: a.task_title,
        to_name: a.to_name,
        situacao: a.candidatos.length ? 'existe' : 'nova',
        parecidas: a.candidatos.slice(0, 3).map((t) => String(t.title || '').slice(0, 120)),
      })),
    },
  };
}

/** Resposta ao "sim" quando a delegação é ambígua: mostra o que achou e PERGUNTA. Nunca afirma ação. */
function perguntaDelegacaoAmbigua(d) {
  const itens = (d && Array.isArray(d.itens)) ? d.itens : [];
  if (!itens.length) return 'Antes de delegar, me confirma qual tarefa é?';
  const linhas = ['Antes de delegar, preciso que você me diga qual é:', ''];
  for (const it of itens) {
    if (it.situacao === 'existe' && Array.isArray(it.parecidas) && it.parecidas.length) {
      linhas.push(`• *${it.task_title}* (pra ${it.to_name}) — já tem parecida: ${it.parecidas.map((t) => `_${t}_`).join(' / ')}`);
    } else {
      linhas.push(`• *${it.task_title}* (pra ${it.to_name}) — não achei nenhuma, seria nova`);
    }
  }
  linhas.push('');
  const existentes = itens.filter((it) => it.situacao === 'existe').length;
  linhas.push(existentes === 1 && itens.length === 1
    ? `É essa que eu passo pra ${itens[0].to_name}, ou crio uma nova?`
    : 'Repasso as que já existem ou crio como novas? Me diz item por item.');
  return linhas.join('\n');
}

/** Regra do LLM quando a criação delegada foi liberada: SÓ os itens provados novos. */
function regraDelegacaoNova(d) {
  let itens = [];
  if (d && Array.isArray(d.itens) && d.itens.length) itens = d.itens;
  else if (d && d.task_title && d.to_name) itens = [{ task_title: d.task_title, to_name: d.to_name }];
  if (!itens.length) return '';
  const lista = itens.map((i, k) => `${k + 1}) "${i.task_title}" → ${i.to_name}`).join('; ');
  return ` É uma DELEGAÇÃO de tarefa(s) NOVA(s): o banco provou, item a item, que ainda não existem. Crie SOMENTE estas, cada uma atribuída à pessoa indicada: ${lista}. Qualquer outra tarefa citada na pergunta NÃO teve prova: NÃO a crie nem a delegue — diga em uma linha que essa precisa ser confirmada à parte.`;
}

module.exports = { classificarItensDelegacao, perguntaDelegacaoAmbigua, regraDelegacaoNova, tituloCasaInteiro };

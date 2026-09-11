'use strict';
// serie-antigas.js — SERIE-ANTIGAS-UMA-PERGUNTA (decisão do Alf, 11/09/2026 — 8071e4f3, 4ce2d1ec).
//
// Clayton, julho: "Criar tarefas para as meninas da ADM" é diária e acumulou ocorrências de mesmo
// nome (due 14/07, 15/07, 17/07, 18/07, 22/07…). Ele fechava "a tarefa" e o TOM seguia cobrando a
// outra ocorrência homônima — cada fala do TOM era verdade sobre uma linha diferente, e ele não
// tinha como distinguir. Decisão: fechar a de hoje e perguntar UMA vez "fecho as N antigas?".
// PURO: recebe as ocorrências irmãs já lidas do banco.
function antigasDaMesmaSerie(instancias, { hojeYmd } = {}) {
  if (typeof hojeYmd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(hojeYmd)) return [];
  return (Array.isArray(instancias) ? instancias : [])
    .filter((x) => x && x.id && !['done', 'cancelled'].includes(x.status)
      && typeof x.due_date === 'string' && x.due_date.slice(0, 10) < hojeYmd)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

function perguntaAntigas(titulo, antigas) {
  const lista = Array.isArray(antigas) ? antigas : [];
  const n = lista.length;
  const fmt = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const datas = lista.slice(0, 5).map((x) => fmt(x.due_date)).join(', ') + (n > 5 ? '…' : '');
  return n === 1
    ? `Ainda tem 1 ocorrência antiga de *${titulo}* em aberto (${datas}). Fecho ela também?`
    : `Ainda tem ${n} ocorrências antigas de *${titulo}* em aberto (${datas}). Fecho todas também?`;
}

module.exports = { antigasDaMesmaSerie, perguntaAntigas };

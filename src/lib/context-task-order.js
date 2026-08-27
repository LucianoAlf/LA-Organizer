'use strict';

// CTX-WINDOW-SORTPOS-BLIND (Rafinha, 26/08 12:48 BRT) — o bloco de tarefas do system prompt
// corta em 8 itens (slice do renderTaskList), e a ordem chegava do SQL com sort_position (o DnD
// do PWA) na frente do prazo. Seis tarefas de 31/08 com sort_position 0..5 ocupavam a janela e
// as 3 de quinta 27/08 caíam fora — o TOM respondeu "pra quinta 27/08 não vejo nada cadastrado"
// com as três no banco. Mesma raiz do fix de 30/05, que já tinha tirado remind_at da frente do
// due_date: prazo define urgência real; sort_position/remind_at são desempate DENTRO do dia.
//
// A ordenação é estável (V8), então a ordem recebida do SQL sobrevive entre datas iguais — é
// assim que a ordem manual do PWA continua valendo dentro do mesmo dia.
function orderByDueDate(tasks) {
  const key = (t) => (t && t.due_date) || '9999-12-31';
  return [...(tasks || [])].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

module.exports = { orderByDueDate };

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

// TASK-COMPLETE-REEMIT-JA-CONCLUIDA (Ana Paula 05/10 19:11 BRT). O resolvedor do `complete` só
// enxerga tarefa ABERTA. Quando o LLM re-emite o fechamento de algo que a própria pessoa acabou
// de fechar ("3 tá ok / 8 tá ok", 2 min depois do ok=2), a ausência vira "Não achei nenhuma
// tarefa aberta… me diz qual é" — FALSO sobre o estado. Porta da tarefa da família
// EVENT-CANCEL-SERIE-JA-ENCERRADA (21/09, evento). Só conta fechamento DELA, `done`, recente.
const JANELA_JA_CONCLUIDA_MIN = 60;

function escolherJaConcluida(rows, collaboratorId, nowMs = Date.now()) {
  const piso = nowMs - JANELA_JA_CONCLUIDA_MIN * 60000;
  const ok = (rows || []).filter((r) => r && r.status === 'done'
    && r.completed_by === collaboratorId
    && Date.parse(r.completed_at) >= piso && Date.parse(r.completed_at) <= nowMs);
  ok.sort((x, y) => Date.parse(y.completed_at) - Date.parse(x.completed_at));
  return ok[0] || null;
}

// Afirmação de ESTADO, sem verbo de conclusão em 1ª pessoa (as portas de honestidade comem
// "fechei/concluí" em ramo de falha).
function mensagemJaConcluida(titulo, completedAt) {
  const hhmm = new Date(completedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `_*${_titulo(titulo)}* já consta como concluída desde as ${hhmm} — não ficou nada aberto com esse nome._`;
}

module.exports = { mensagemAlvoNaoAchado, escolherJaConcluida, mensagemJaConcluida, JANELA_JA_CONCLUIDA_MIN, LIMITE_TITULO };

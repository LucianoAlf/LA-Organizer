'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { podeLiberarCriacao } = require('./confirm-create-gate');

// Fixtures REAIS: as perguntas guardadas em marker_logs.raw_excerpt nos 15 CONFIRM_NOEXEC
// medidos entre 16/07 e 07/08. Não são inventadas — é o texto que o TOM mandou.

// ── LIBERA: proposta de criação, sem item existente no meio ──────────────────
test('libera criação — casos reais de lembrete/tarefa/evento/plano', () => {
  const liberar = [
    ['Bianca 07/08', 'Entendi: lembrete amanhã às 11h — mandar mensagem pro *Rômulo Massagista*.\n\nCerto?'],
    ['Arthur 04/08', 'Entendi: te lembro amanhã às 10h de *passar o Levy pra BIA* — ação pra quinta.\n\nCerto?'],
    ['Rafinha 27/07', 'Três compromissos pra sábado (01/08) — me confirma rapidinho:\n\n• *Igreja Bangu (Igor) · 15h* — presencial, pessoal. Certo?'],
    ['Jéssica 25/07', '📅 *Viagem*\n🗓️ Seg 10/08 · 04h–05h\n🏢 Presencial · Pessoal\n\nCerto?'],
    ['Rose 26/07', 'Beleza! Com 3 entregas, todas pra amanhã, fica assim:\n\n🗓️ *Plano da semana:*\n\n• Seg (27/07): Pegar parcelamentos'],
  ];
  for (const [quem, q] of liberar) {
    assert.strictEqual(podeLiberarCriacao(q), true, `${quem} deveria liberar`);
  }
});

// ── BLOQUEIA: a pergunta é sobre item que JÁ EXISTE ──────────────────────────
// Estes são o motivo de o gate existir. Liberar aqui é o risco real: o LLM chutaria
// qual item tocar (caso Conciliação/Rose 10/06) ou criaria duplicata do que já existe.
test('bloqueia ação sobre item existente — casos reais', () => {
  const bloquear = [
    ['Rafinha 28/07 delegar', 'Entendido! Delego a tarefa *Comprar material de iluminação* pro Alf e tiro da sua fila? Confirma?'],
    ['Alf 22/07 fechamento', 'Confirma o fechamento destas 3 tarefas: *Video abertura*, *Videos Chamadas do meio*, *Video final*?'],
    ['Yuri 28/07 ritual', 'Fechamento do dia, Yuri 👽\n\nDas suas 3 coisas:\n1. 📋 *Editar LA Session 4* — fez?'],
    ['Rose 16/07 fatura', 'lançar fatura?'],
  ];
  for (const [quem, q] of bloquear) {
    assert.strictEqual(podeLiberarCriacao(q), false, `${quem} NÃO pode liberar`);
  }
});

// ── BLOQUEIA por falta de sinal (fail-closed), não por veto ──────────────────
// Coordenação/recado não é criação de item — tem executor próprio (staged_coord).
// Sem sinal claro de criação o gate devolve false e o comportamento segue o de hoje.
test('fail-closed: sem sinal de criação → false', () => {
  const semSinal = [
    ['Arthur 03/08 coord', 'Aviso a Krissya amanhã às 18h40 pra pegar os fones em CG? Confirma?'],
    ['Rafinha 28/07 aviso', 'Aviso o Alf sobre os calendários das escolas? Confirma?'],
    ['vazio', ''],
    ['genérico', 'Confirma?'],
  ];
  for (const [quem, q] of semSinal) {
    assert.strictEqual(podeLiberarCriacao(q), false, `${quem} deveria ser false`);
  }
});

// ── O limite que aceitamos de propósito ──────────────────────────────────────
// O TÍTULO da tarefa a criar contém um verbo de edição. O gate não distingue título de
// ação e bloqueia — perde uma criação legítima. É a troca deliberada: o custo de errar é
// assimétrico (duplicar/alterar item alheio é pior que pedir pra pessoa repetir).
test('LIMITE CONHECIDO: verbo de edição no título da coisa a criar bloqueia', () => {
  const anaPaula = 'Entendi: tarefa *pessoal* — *Reagendar retorno na neuropediatra para novembro*, com lembrete por volta de 15/10. Certo?';
  assert.strictEqual(podeLiberarCriacao(anaPaula), false,
    'bloqueia por "Reagendar" no título — conservador de propósito, documentado no módulo');
});

// ── defensivo ────────────────────────────────────────────────────────────────
test('defensivo: não-string → false', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    assert.strictEqual(podeLiberarCriacao(v), false);
  }
});

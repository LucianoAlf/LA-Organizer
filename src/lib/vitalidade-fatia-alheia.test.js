const { test } = require('node:test');
const assert = require('node:assert');
const { vitalidadeDasFatias } = require('./vitalidade-parse-on-open');

// Caso real: intent 96f54589, Alf, 16/09/2026 19:17:46 BRT (pending_intents).
// O ritual de Fechamento do dia escreve, na própria instrução, «Pode ser: "fiz", "não fiz"
// ou "reagendei pra X"». O tema do reagendamento é largo de propósito e casa esse
// "reagendei" — mas a pergunta não é de reagendamento: ela estagiou `closing`, que é uma
// QUINTA família de executor determinístico (nascida em 15/09, fora do registro).
//
// O filtro `_outra` existia justamente pra isso e olhava só as QUATRO chaves de fatia.
// Como `closing` não é chave de fatia nenhuma, a pergunta passava, virava `tema 1` com
// `parser 0`, e o laudo saía `ancora_nao_casa` — mandando investigar uma âncora intacta.
// Foi o alarme que chegou no pedido de 18/09; é a 5ª rodada seguida de alarme falso deste
// bloco (07, 11, 12, 13 e 18/09).

const FECHAMENTO_1609 = 'Fechamento do dia, Alf \u{1F47D}\n\nDas suas tarefas:\n'
  + '1. \u{1F4CB} *Pedido na Staner — 2 caixas bluetooth KUB* — fez?\n\n'
  + 'Me diz se fez. Pode ser: "fiz", "não fiz" ou "reagendei pra X".';

const fechamentoIntent = {
  question_text: FECHAMENTO_1609,
  payload: {
    action: 'complete',
    closing: {
      items: [{ id: '56a3a530-5fb2-41bf-b3f2-01d0182d72bf', type: 'task', index: 1, title: 'Pedido na Staner' }],
      ref_date: '2026-09-16',
    },
  },
  asked_at: '2026-09-16T22:17:46.436352+00:00',
};

const fatia = (vits, chave) => vits.find((v) => v.chave === chave);

test('pergunta que estagiou `closing` não conta como oportunidade do reagendamento', () => {
  const v = fatia(vitalidadeDasFatias([fechamentoIntent], { hoje: '2026-09-16' }), 'reschedule');
  assert.strictEqual(v.tema, 0, 'o Fechamento não é pergunta de reagendamento');
  assert.strictEqual(v.anteriores, 1, 'ela tem que ser contada como descartada, não sumir');
  assert.strictEqual(v.veredito, 'sem_oportunidade');
});

test('CONTROLE — pergunta de reagendamento de verdade segue medindo `viva`', () => {
  // Literal de 03/09 21:40:50 BRT (intent 4f2e1aec), com a data movida pra depois da
  // âncora atual (9e9f73be, 08/09 09:20 BRT) e a alça no payload.
  const real = {
    question_text: '\u{1F4CB} Vou reagendar:\n• *tarefa 0c528968* → 16/09\n'
      + '• *tarefa 2c45b5f3* → 16/09\n\nConfirma? (responde "isso" / "sim")',
    payload: { reschedule: { actions: [{ action: 'reschedule', short_id: '0c528968', new_due_date: '2026-09-16' }] } },
    asked_at: '2026-09-16T20:00:00.000Z',
  };
  const v = fatia(vitalidadeDasFatias([real], { hoje: '2026-09-16' }), 'reschedule');
  assert.strictEqual(v.tema, 1);
  assert.strictEqual(v.parser, 1);
  assert.strictEqual(v.estagiou, 1);
  assert.strictEqual(v.veredito, 'viva');
});

test('CONTROLE — âncora que de fato não casa a prosa continua acusando', () => {
  // Sem família alheia no payload: é pergunta de reagendamento mesmo, e o parser não pega.
  // Um veredito que nunca acusa é pior que um que acusa demais.
  const generica = {
    question_text: 'Quer que eu reagende isso pra semana que vem?',
    payload: { last_tom_reply: 'x', last_user_text: 'y' },
    asked_at: '2026-09-16T20:00:00.000Z',
  };
  const v = fatia(vitalidadeDasFatias([generica], { hoje: '2026-09-16' }), 'reschedule');
  assert.strictEqual(v.tema, 1);
  assert.strictEqual(v.parser, 0);
  assert.strictEqual(v.veredito, 'ancora_nao_casa');
});

test('CONTROLE — `anchor` também é família alheia, embora não seja chave de fatia', () => {
  const ancorada = {
    question_text: 'Confirma o fechamento desta tarefa: *Ligar pro Dudu*?',
    payload: { anchor: { task_id: '56a3a530-5fb2-41bf-b3f2-01d0182d72bf' }, action: 'complete' },
    asked_at: '2026-09-16T20:00:00.000Z',
  };
  const v = fatia(vitalidadeDasFatias([ancorada], { hoje: '2026-09-16' }), 'batch_complete');
  assert.strictEqual(v.tema, 0, 'complete ancorado não é fechamento em lote');
  assert.strictEqual(v.veredito, 'sem_oportunidade');
});

test('CONTROLE — a própria fatia não se auto-exclui', () => {
  // Literal real do ramo A2 (rótulo que ele grava em question_text).
  const lote = {
    question_text: 'Confirmar fechamento em lote: *Trocar spot quadrado branco quente — Recreio*, '
      + '*Trocar 2 spot quadrado branco quente — Escada e cozinha funcionários (Recreio)*?',
    payload: { batch_complete: ['56a3a530-5fb2-41bf-b3f2-01d0182d72bf'] },
    asked_at: '2026-09-16T20:00:00.000Z',
  };
  const v = fatia(vitalidadeDasFatias([lote], { hoje: '2026-09-16' }), 'batch_complete');
  assert.strictEqual(v.tema, 1, 'estagiar a PRÓPRIA chave não pode excluir a pergunta');
  assert.strictEqual(v.estagiou, 1);
});

// Efeito colateral medido sobre as 456 intents reais de 30 dias (18/09): o tema do
// `batch_complete` cai de 348 para 21, porque 327 hits eram o ritual de Fechamento —
// família `closing`, que nunca foi alvo deste parser. É a razão sinal/ruído de 17% que
// ficou anotada na escada em 12/09 e que ninguém tinha como limpar sem esta lista.
// Nenhuma fatia muda de veredito além da que estava em alarme falso.
test('o ritual de Fechamento sai do tema do fechamento por pergunta, sem mudar o veredito', () => {
  const comEstagio = {
    question_text: 'Confirmar fechamento em lote: *Ligar pro Dudu*?',
    payload: { batch_complete: ['56a3a530-5fb2-41bf-b3f2-01d0182d72bf'] },
    asked_at: '2026-09-16T20:00:00.000Z',
  };
  const v = fatia(vitalidadeDasFatias([fechamentoIntent, comEstagio], { hoje: '2026-09-16' }), 'batch_complete');
  assert.strictEqual(v.tema, 1, 'só a pergunta de lote conta; o ritual não');
  assert.strictEqual(v.veredito, 'viva_sem_parser');
});

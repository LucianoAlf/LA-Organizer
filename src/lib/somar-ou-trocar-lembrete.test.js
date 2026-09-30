'use strict';
// SOMAR-HORARIO-1A1 — decisão SOMA × TROCA de horário numa tarefa que já existe (1:1).
// Caso-raiz: Ana Paula, 1:1, 11/09/2026 00:38 UTC — "Me lembra 12h e 20h". O marker trouxe 5
// reschedule com new_remind_at 20h (task_comments de 440fcc1b: "Prazo: 30/09 → 26/09 (lembrete
// 20:00)", …) e cada um sobrescreveu o remind_at. Depois: "Agora sim — 10 registros".
const test = require('node:test');
const assert = require('node:assert');
const { decidirHorarioNovo, horariosDaFala, falaListaHorarios, textoLembretesSomados } = require('./somar-ou-trocar-lembrete');

const R = { action: 'reschedule', title: 'Semana de provas - Faculdade', new_remind_at: '2026-09-26T20:00:00-03:00' };
const modo = (texto, acao = R) => decidirHorarioNovo({ texto, acao }).modo;

test('Ana Paula 11/09 (fala real): "Me lembra 12h e 20h" SOMA', () => {
  assert.strictEqual(modo('Me lembra 12h e 20h'), 'somar');
});

test('pedidos de horário A MAIS somam', () => {
  for (const t of [
    'me lembra também às 20h',
    'Tom, me lembra tambem as 20h',
    'mais um lembrete às 20h',
    'coloca outro lembrete 20h',
    'e às 20h também',
    'e 20h',
    'adiciona um lembrete às 20h nessa',
    'me lembra de novo às 20h',
    'às 9h, 12h e 15h',
    'me avisa 9h e às 15h',
  ]) assert.strictEqual(modo(t), 'somar', t);
});

test('pedidos de TROCA seguem trocando (comportamento de sempre)', () => {
  for (const t of [
    'muda pra 20h',
    'passa pra 20h',
    'troca o lembrete pra 20h',
    'muda de 12h pra 20h',
    'na verdade é às 20h',
    'me lembra às 20h em vez de 12h',
    'só às 20h',
    'adia pra amanhã 20h',
    'adia mais um dia, 20h',
  ]) assert.strictEqual(modo(t), 'trocar', t);
});

test('REPLAY 60d — falsos positivos reais ficam de fora', () => {
  // Anne 13/08 00:05 (reschedule legítimo da tarefa "Ligar para a clínica Ipê" pra 10h40):
  // o "também" é do DIA, não do lembrete.
  assert.strictEqual(modo('Amanhã também, às 10h40 preciso ligar para a clinica veterinária IPÊ para marcar um dentista para a Lala.'), 'trocar');
  // Duda 21/09 20:09: horários são CONTEÚDO da tarefa, não lembretes.
  assert.strictEqual(falaListaHorarios('tom, lembrar o Arthur de fazer as anamneses da parte da noite, alunos de 18h e 19h'), false);
  assert.strictEqual(falaListaHorarios('me lembra amanhã às 12h e 20h'), true);
});

test('REPLAY 60d — Anne 03/08: "Me lembre também…" num pedido de vários itens que MOVE o prazo é troca', () => {
  const fala = 'Tom me lembre às 9h30 que preciso dar o remédio quimioterápico da Lala. Que preciso ligara para a clinica Ipê para marcar a cirurgia do dente da Lala. Me lembre também que preciso pagar o cartão do Santander.  \nÀs 10h me lembre que preciso marcar ginecologista e endocrinologista';
  const d = decidirHorarioNovo({ texto: fala, prazoAtual: '2026-08-01', acao: { action: 'reschedule', id: 'x', new_due_date: '2026-08-03', new_remind_at: '2026-08-03T09:30:00-03:00' } });
  assert.deepStrictEqual(d, { modo: 'trocar', motivo: 'fala_soma_mas_prazo_muda' });
  // sem mudar o prazo, o mesmo "também" soma
  assert.strictEqual(decidirHorarioNovo({ texto: 'me lembra também às 20h', prazoAtual: '2026-08-03', acao: { ...R, new_due_date: '2026-08-03' } }).modo, 'somar');
});

test('estrutural: 2º horário pra MESMA tarefa no MESMO lote soma, mesmo com fala neutra', () => {
  assert.strictEqual(decidirHorarioNovo({ texto: 'ok', acao: R, jaReagendadaNoLote: true }).modo, 'somar');
  assert.strictEqual(decidirHorarioNovo({ texto: 'na verdade é 20h', acao: R, jaReagendadaNoLote: true }).modo, 'trocar');
});

test('fala neutra: sem o campo add_reminder troca (compatível); com o campo, soma', () => {
  assert.strictEqual(modo('me lembra às 20h'), 'trocar');
  assert.strictEqual(modo('me lembra às 20h', { ...R, add_reminder: true }), 'somar');
  assert.strictEqual(modo('me lembra às 20h', { ...R, add_reminder: 'true' }), 'somar');
});

test('a fala vence o campo do marker quando diz TROCA', () => {
  assert.strictEqual(modo('muda pra 20h', { ...R, add_reminder: true }), 'trocar');
  assert.strictEqual(modo('na verdade é 20h', { ...R, add_reminder: true }), 'trocar');
});

test('sem new_remind_at não há o que somar', () => {
  assert.strictEqual(modo('me lembra também', { action: 'reschedule', title: 'x', new_due_date: '2026-10-01' }), 'trocar');
});

test('horariosDaFala: lê o que a pessoa disse, sem confundir data com hora', () => {
  assert.deepStrictEqual(horariosDaFala('Me lembra 12h e 20h'), [720, 1200]);
  assert.deepStrictEqual(horariosDaFala('dia 29/09 às 09h e às 15h30'), [540, 930]);
  assert.deepStrictEqual(horariosDaFala('meio-dia'), [720]);
  assert.deepStrictEqual(horariosDaFala('De 26/09 até 30/09'), []);
});

test('confirmação lista SÓ o que ficou gravado — nunca "10 registros"', () => {
  const txt = textoLembretesSomados([{
    titulo: 'Semana de provas - Faculdade',
    horarios: ['2026-09-26T23:00:00.000Z', '2026-09-27T23:00:00.000Z', '2026-09-28T23:00:00.000Z'],
    recusados: ['2026-09-29T20:00:00-03:00', '2026-09-30T20:00:00-03:00'],
  }]);
  assert.strictEqual(txt,
    '🔔 *Semana de provas - Faculdade* — 3 lembretes gravados: 26/09 20h, 27/09 20h e 28/09 20h.\n'
    + '⚠️ 29/09 20h e 30/09 20h não entraram — no máximo 3 lembretes por tarefa, com 30 min entre eles.');
  assert.ok(!/10/.test(txt));
});

test('confirmação no mesmo dia junta as horas', () => {
  assert.strictEqual(textoLembretesSomados([{ titulo: 'Remédio', horarios: ['2026-10-01T15:00:00Z', '2026-10-01T23:00:00Z'] }]),
    '🔔 *Remédio* — 2 lembretes gravados: 01/10 às 12h e 20h.');
});

test('só recusa / só falha: diz o que NÃO entrou, sem afirmar gravação', () => {
  assert.strictEqual(textoLembretesSomados([{ titulo: 'X', horarios: [], recusados: ['2026-10-01T15:10:00Z'] }]),
    '⚠️ 01/10 às 12h10 não entrou em *X* — no máximo 3 lembretes por tarefa, com 30 min entre eles.');
  assert.strictEqual(textoLembretesSomados([{ titulo: 'X', horarios: [], falhas: ['2026-10-01T23:00:00Z'] }]),
    '⚠️ Não consegui gravar o lembrete de 01/10 às 20h em *X* — me pede de novo?');
});

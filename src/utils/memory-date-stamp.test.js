'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { carimbaMemoriaRelativa, precisaCarimbo } = require('./memory-date-stamp');

// Fixtures REAIS: linhas de collaborator_memory medidas em 08/08 (33 das 456 têm termo
// relativo). Sem carimbo, o TOM lê "amanhã" semanas depois e resolve pro amanhã de hoje.

test('casos reais ganham a data de origem', () => {
  assert.strictEqual(
    carimbaMemoriaRelativa('Yuri planeja enviar vídeos de cultura para Peterson amanhã.', '2026-07-28T14:00:00Z'),
    '(28/07) Yuri planeja enviar vídeos de cultura para Peterson amanhã.');
  assert.strictEqual(
    carimbaMemoriaRelativa('Krissya irá colocar os valores na planilha às 12h39 de hoje.', '2026-07-23T11:00:00Z'),
    '(23/07) Krissya irá colocar os valores na planilha às 12h39 de hoje.');
  assert.strictEqual(
    carimbaMemoriaRelativa('Quintela irá revisar o inventário das unidades amanhã.', '2026-08-08T10:00:00Z'),
    '(08/08) Quintela irá revisar o inventário das unidades amanhã.');
});

test('relativos de semana/mês também envelhecem — e são carimbados', () => {
  for (const s of ['Rose entrega o relatório semana que vem', 'Fecha o caixa mês que vem',
                   'A reunião ficou pra próxima semana', 'Ele viajou semana passada']) {
    assert.ok(precisaCarimbo(s), `"${s}" deveria precisar de carimbo`);
    assert.ok(carimbaMemoriaRelativa(s, '2026-07-10T12:00:00Z').startsWith('(10/07) '), s);
  }
});

// A grande maioria (93%) não fala em tempo relativo e tem que passar intacta — carimbar tudo
// poluiria o prompt sem ganho.
test('memória atemporal passa intacta', () => {
  for (const s of ['Rose prefere áudio a texto', 'Arthur é coordenador do Recreio',
                   'Prefere ser chamada de Dai', 'Trabalha de terça a sábado',
                   'A reunião de 12/08 foi cancelada']) {
    assert.strictEqual(carimbaMemoriaRelativa(s, '2026-07-10T12:00:00Z'), s, s);
  }
});

test('NÃO casa dentro de palavra', () => {
  for (const s of ['O sistema é homogêneo', 'Amanhecer no Recreio', 'Ontologia do produto']) {
    assert.strictEqual(precisaCarimbo(s), false, s);
  }
});

// Sem data confiável, carimbar seria pior que não carimbar — inventaria uma referência falsa.
test('fail-safe: data ausente ou inválida → devolve intacto', () => {
  const s = 'Yuri envia os vídeos amanhã';
  for (const d of [null, undefined, '', 'ontem', 'lixo', NaN]) {
    assert.strictEqual(carimbaMemoriaRelativa(s, d), s, `data=${JSON.stringify(d)}`);
  }
});

test('idempotente: não carimba duas vezes', () => {
  const uma = carimbaMemoriaRelativa('Yuri envia os vídeos amanhã', '2026-07-28T14:00:00Z');
  assert.strictEqual(carimbaMemoriaRelativa(uma, '2026-07-28T14:00:00Z'), uma);
});

test('carimbo usa BRT, não UTC — 21h em SP não vira o dia seguinte', () => {
  // 2026-07-28T23:30:00-03:00 = 2026-07-29T02:30Z. Em UTC seria 29/07; em BRT é 28/07.
  assert.ok(carimbaMemoriaRelativa('Manda amanhã', '2026-07-29T02:30:00Z').startsWith('(28/07)'));
});

// Caso Anne Susan, 12/09/2026 (um SÁBADO). A memória abaixo foi gravada em 31/05 e o briefing
// da manhã renderizou "⚠️ Prova de clínica psicanalítica é hoje" — a prova não existia. Dia da
// semana envelhece exatamente como "amanhã": sem a data de origem, "no sábado" é sempre o
// sábado de hoje. 19 das 506 memórias ativas estão nessa situação (medido em 13/09).
test('dia da semana PONTUAL envelhece igual a "amanhã" — caso Anne 12/09', () => {
  assert.strictEqual(
    carimbaMemoriaRelativa('Anne Susan precisa estudar para a prova de clínica psicanalítica no sábado.', '2026-05-31T03:00:28Z'),
    '(31/05) Anne Susan precisa estudar para a prova de clínica psicanalítica no sábado.');
  for (const s of ['Arthur irá fazer a encomenda de descartáveis na segunda às 9:30.',
                   'Juliana precisa agendar uma reunião com Rodrigo na segunda-feira às 15h.',
                   'Luciano planeja uma reunião com Vitor na próxima sexta-feira às 9h.',
                   'Yuri irá agendar a gravação da Legacy nesta quinta.',
                   'Dai vai concluir a anamnese dos alunos sexta que vem.']) {
    assert.ok(precisaCarimbo(s), `"${s}" deveria precisar de carimbo`);
  }
});

// O carimbo mente quando a frase é uma REGRA permanente: "(04/05) prefere receber na segunda"
// sugere um evento pontual que passou. Os dois primeiros são linhas reais do banco.
test('dia da semana RECORRENTE ou ordinal passa intacto', () => {
  for (const s of ['Prefere receber o planejamento da semana na segunda-feira às 10h.',
                   'Matheus NÃO quer cobranças no fim de semana. Lembretes começam na segunda-feira.',
                   'Bianca deve evitar reuniões às sextas-feiras após 17h',
                   'Tom organiza reuniões online às terças às 15h',
                   'Krissya acompanha prazos de tarefas até sexta-feira',
                   'Trabalha de terça a sábado',
                   'Anne precisa dar a segunda dose do quimioterápico no dia 1º de agosto',
                   'Revisar o material na segunda quinzena']) {
    assert.strictEqual(precisaCarimbo(s), false, s);
    assert.strictEqual(carimbaMemoriaRelativa(s, '2026-07-10T12:00:00Z'), s, s);
  }
});

test('defensivo: não-string / vazio', () => {
  for (const v of [null, undefined, '', 42, {}]) {
    assert.strictEqual(carimbaMemoriaRelativa(v, '2026-07-28T14:00:00Z'), v);
  }
});

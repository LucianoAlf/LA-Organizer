// RESUMO-SEMANAL-VIROU-AGENDA (Alf 30/09): o resumo 75020d33 guardava "Jornada de Cordas —
// remarcada para 30/09, 13h–17h" como fato e virou "rolou?" num fechamento de dia sem agenda.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rs = require('./resumo-semanal');

// Trecho REAL do resumo 75020d33 (created_at 2026-09-28T01:08:16Z = 27/09 22:08 BRT).
const REAL_75020D33 = {
  week_start: '2026-09-21',
  created_at: '2026-09-28T01:08:16.015954+00:00',
  summary: `**Resumo da semana (21–27/09)**

**Compromissos agendados na semana:**
- Alinhamento parceria FEPP (Colégio Rosário, com Renata) — remarcado duas vezes: de 23/09 → segunda 28/09 à tarde → sexta 25/09 15h. Status da realização em 25/09 ainda não confirmado por você.
- Compromisso presencial com Xuxu e Aline, segunda 28/09, 17h, LA Music Campo Grande.
- Jornada de Cordas (convite do Quintela), confirmada presença — remarcada para 30/09, 13h–17h.
- Mentoria com Ariel (Neon Escola) — 22/09, feita.
- Mentoria Levi — 25/09, confirmação pendente.

**Padrões recorrentes:**
- Múltiplos "fechamentos do dia" com transações bancárias não identificadas.`,
};

test('dia do retrato = created_at em BRT (27/09, não 28/09 UTC)', () => {
  assert.equal(rs.diaDoRetrato(REAL_75020D33), '2026-09-27');
  assert.equal(rs.diaDoRetrato({ week_start: '2026-09-21' }), '2026-09-28');
});

test('resumo real: linhas com data DEPOIS do retrato saem; passado e cabeçalho ficam', () => {
  const r = rs.neutralizarCompromissosFuturos(REAL_75020D33.summary, '2026-09-27');
  assert.equal(r.removidas.length, 3);
  assert.doesNotMatch(r.texto, /Jornada de Cordas/);
  assert.doesNotMatch(r.texto, /Xuxu/);
  assert.doesNotMatch(r.texto, /FEPP/); // tinha 28/09 no meio da remarcação
  assert.match(r.texto, /Resumo da semana \(21–27\/09\)/);
  assert.match(r.texto, /Mentoria com Ariel \(Neon Escola\) — 22\/09, feita/);
  assert.match(r.texto, /Mentoria Levi — 25\/09/);
  assert.match(r.texto, /Padrões recorrentes/);
});

test('título da janela fica mesmo com a data de segunda (resumo real 9043f00a, gerado dom 16/08 22h BRT)', () => {
  const txt = '*Semana encerrada em 17/08/2026*\n**Resumo semanal — Jordan (semana até 17/08/2026)**\nAs três tarefas principais ficaram concentradas para segunda-feira (17/08):';
  const r = rs.neutralizarCompromissosFuturos(txt, '2026-08-16');
  assert.equal(r.removidas.length, 1);
  assert.match(r.texto, /Semana encerrada em 17\/08\/2026/);
  assert.match(r.texto, /semana até 17\/08\/2026/);
  assert.doesNotMatch(r.texto, /concentradas para segunda/);
});

test('o próprio dia do retrato é passado (gerador roda domingo 22h): fica', () => {
  const r = rs.neutralizarCompromissosFuturos('- Ensaio no domingo 27/09, feito.\n- Reunião segunda 28/09, 17h.', '2026-09-27');
  assert.match(r.texto, /Ensaio no domingo 27\/09/);
  assert.doesNotMatch(r.texto, /28\/09/);
});

test('fração não é data; virada de ano resolve pro ano certo', () => {
  assert.deepEqual(rs.datasDaLinha('3/3 confirmaram', '2026-09-27'), []);
  assert.deepEqual(rs.datasDaLinha('volta 05/01', '2026-12-27'), ['2027-01-05']);
  assert.deepEqual(rs.datasDaLinha('foi 28/12', '2027-01-03'), ['2026-12-28']);
});

test('render: cabeçalho explícito de retrato + aviso das linhas tiradas; Jornada não chega ao prompt', () => {
  const bloco = rs.renderResumoSemanal(REAL_75020D33).join('\n');
  assert.match(bloco, /Retrato de 27\/09 \(semana a partir de 21\/09\) — compromissos aqui podem ter mudado; a agenda real é a seção de agenda/);
  assert.match(bloco, /NUNCA liste nada deste bloco como compromisso de hoje/);
  assert.doesNotMatch(bloco, /Jornada de Cordas/);
  assert.match(bloco, /3 linha\(s\) com compromisso depois de 27\/09 tirada\(s\)/);
  assert.deepEqual(rs.renderResumoSemanal(null), []);
});

test('gerador: prompt proíbe compromisso futuro como fato e manda "conferir a agenda"', () => {
  const p = rs.promptDoResumoSemanal({ nome: 'Luciano Alf', historyText: 'x', hojeYmd: '2026-09-27' });
  assert.match(p, /Hoje é 27\/09/);
  assert.match(p, /NÃO registre compromisso FUTURO \(data depois de 27\/09\) como fato/);
  assert.match(p, /conferir a agenda/);
  // o que o modelo devolveu em 27/09 passa pelo filtro antes de gravar
  const gravado = rs.neutralizarCompromissosFuturos(REAL_75020D33.summary, '2026-09-27').texto;
  assert.equal(rs.datasDaLinha(gravado, '2026-09-27').filter((d) => d > '2026-09-27').length, 0);
});

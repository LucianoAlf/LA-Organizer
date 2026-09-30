'use strict';
// SOMAR-HORARIO-1A1 — escrita do horário A MAIS numa tarefa 1:1 que já existe.
// Caso-raiz: Ana Paula, 1:1, 11/09/2026. Tarefa real 440fcc1b "Semana de provas - Faculdade"
// (due 30/09). Às 00:38 UTC ela pediu "Me lembra 12h e 20h"; o marker trouxe 5 reschedule, um por
// dia (26→30/09), todos com new_remind_at 20h e todos resolvidos pro MESMO id — cada um sobrescreveu
// o anterior (task_comments 00:39:02–03). O TOM disse "10 registros"; o banco tinha 1 horário.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { somarLembreteNaTarefa } = require('./somar-lembrete');
const { decidirHorarioNovo, textoLembretesSomados } = require('../lib/somar-ou-trocar-lembrete');

// Banco em memória que APLICA os filtros (o defeito é de escrita: o teste olha o que ficou).
function banco(inicial = {}) {
  const T = { tasks: [], task_reminders: [], ...inicial };
  let seq = 0;
  function q(tabela) {
    const preds = [];
    let op = 'select', payload = null;
    const alvo = () => (T[tabela] || []).filter((r) => preds.every((p) => p(r)));
    const exec = () => {
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `${tabela}-${++seq}`, sent_at: null, ...r }));
        (T[tabela] = T[tabela] || []).push(...rows);
        return { data: rows, error: null };
      }
      if (op === 'update') { const rs = alvo(); rs.forEach((r) => Object.assign(r, payload)); return { data: rs, error: null }; }
      return { data: alvo(), error: null };
    };
    const b = {
      select() { return b; },
      eq(c, v) { preds.push((r) => r[c] === v); return b; },
      is(c, v) { preds.push((r) => (r[c] ?? null) === v); return b; },
      insert(r) { op = 'insert'; payload = r; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      maybeSingle() { const r = exec(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return b;
  }
  return { T, sb: { from: (t) => q(t) } };
}

const ID = '440fcc1b-c3a8-47a6-9f02-20b42f0fc1b3';
const TAREFA = { id: ID, title: 'Semana de provas - Faculdade', due_date: '2026-09-30', remind_at: null, reminded_at: null, status: 'pending' };
// Marker real (reconstruído dos task_comments de 11/09 00:39): 5 reschedule, 20h de 26 a 30/09.
const MARKER_ANA = ['26', '27', '28', '29', '30'].map((d) => ({
  action: 'reschedule', title: 'Semana de provas - Faculdade', new_due_date: `2026-09-${d}`, new_remind_at: `2026-09-${d}T20:00:00-03:00`,
}));

// O que o reschedule do engine faz com cada ação no modo soma (mesma sequência do engine.js).
async function aplicaComoEngine(sb, fala, acoes) {
  const it = { titulo: null, horarios: [], recusados: [], falhas: [] };
  const modos = [];
  let jaNoLote = false;
  for (const a of acoes) {
    const d = decidirHorarioNovo({ texto: fala, acao: a, prazoAtual: '2026-09-30', jaReagendadaNoLote: jaNoLote });
    jaNoLote = true;
    modos.push(d.modo);
    if (d.modo !== 'somar') continue;
    const r = await somarLembreteNaTarefa({ supabase: sb, taskId: ID, iso: a.new_remind_at });
    it.titulo = it.titulo || r.titulo;
    if (r.horarios.length) it.horarios = r.horarios.slice();
    if (r.status === 'teto') it.recusados.push(a.new_remind_at);
    else if (!['somou', 'definiu', 'jaTinha'].includes(r.status)) it.falhas.push(a.new_remind_at);
  }
  return { modos, it };
}

test('REPLAY Ana 11/09: nenhum horário é sobrescrito; grava até o teto e a confirmação diz exatamente isso', async () => {
  const { T, sb } = banco({ tasks: [{ ...TAREFA }] });
  const { modos, it } = await aplicaComoEngine(sb, 'Me lembra 12h e 20h', MARKER_ANA);
  assert.deepStrictEqual(modos, ['somar', 'somar', 'somar', 'somar', 'somar']);
  // e mesmo que a fala não tivesse a lista, a partir do 2º horário na MESMA tarefa já somaria:
  assert.strictEqual(decidirHorarioNovo({ texto: 'ok', acao: MARKER_ANA[1], prazoAtual: '2026-09-30', jaReagendadaNoLote: true }).modo, 'somar');
  // 1º horário vira o remind_at (não havia nenhum); os outros viram linhas; prazo NÃO se mexe.
  assert.strictEqual(T.tasks[0].remind_at, '2026-09-26T23:00:00.000Z');
  assert.strictEqual(T.tasks[0].due_date, '2026-09-30');
  assert.deepStrictEqual(T.task_reminders.map((r) => r.remind_at), ['2026-09-27T23:00:00.000Z', '2026-09-28T23:00:00.000Z']);
  const txt = textoLembretesSomados([it]);
  assert.match(txt, /3 lembretes gravados: 26\/09 20h, 27\/09 20h e 28\/09 20h/);
  assert.match(txt, /29\/09 20h e 30\/09 20h não entraram/);
  assert.ok(!/\b10\b/.test(txt), 'nunca "10 registros"');
});

test('"me lembra também às 20h" com 12h já marcado: o 12h FICA e o 20h entra em task_reminders', async () => {
  const { T, sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-26T15:00:00+00:00' }] });
  const a = { action: 'reschedule', title: TAREFA.title, new_remind_at: '2026-09-26T20:00:00-03:00' };
  assert.strictEqual(decidirHorarioNovo({ texto: 'me lembra também às 20h', acao: a }).modo, 'somar');
  const r = await somarLembreteNaTarefa({ supabase: sb, taskId: ID, iso: a.new_remind_at });
  assert.strictEqual(r.status, 'somou');
  assert.strictEqual(T.tasks[0].remind_at, '2026-09-26T15:00:00+00:00', 'o 12h foi sobrescrito');
  assert.deepStrictEqual(T.task_reminders.map((x) => [x.task_id, x.remind_at]), [[ID, '2026-09-26T23:00:00.000Z']]);
  assert.deepStrictEqual(r.horarios, ['2026-09-26T15:00:00.000Z', '2026-09-26T23:00:00.000Z']);
});

test('mesmo horário de novo: não duplica', async () => {
  const { T, sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-26T23:00:00Z' }] });
  const r = await somarLembreteNaTarefa({ supabase: sb, taskId: ID, iso: '2026-09-26T20:00:00-03:00' });
  assert.strictEqual(r.status, 'jaTinha');
  assert.strictEqual(T.task_reminders.length, 0);
});

test('teto: 4º horário, ou a menos de 30 min de outro, NÃO é gravado', async () => {
  const cheio = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-26T12:00:00Z' }],
    task_reminders: [{ id: 'r1', task_id: ID, remind_at: '2026-09-26T15:00:00Z', sent_at: null }, { id: 'r2', task_id: ID, remind_at: '2026-09-26T18:00:00Z', sent_at: null }] });
  const r1 = await somarLembreteNaTarefa({ supabase: cheio.sb, taskId: ID, iso: '2026-09-26T23:00:00Z' });
  assert.strictEqual(r1.status, 'teto');
  assert.strictEqual(cheio.T.task_reminders.length, 2);
  const perto = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-26T15:00:00Z' }] });
  const r2 = await somarLembreteNaTarefa({ supabase: perto.sb, taskId: ID, iso: '2026-09-26T15:20:00Z' });
  assert.strictEqual(r2.status, 'teto');
  assert.strictEqual(perto.T.task_reminders.length, 0);
});

test('remind_at que JÁ disparou não conta: o horário novo re-arma a tarefa', async () => {
  const { T, sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-26T15:00:00Z', reminded_at: '2026-09-26T15:00:40Z' }] });
  const r = await somarLembreteNaTarefa({ supabase: sb, taskId: ID, iso: '2026-09-26T23:00:00Z' });
  assert.strictEqual(r.status, 'definiu');
  assert.strictEqual(T.tasks[0].remind_at, '2026-09-26T23:00:00.000Z');
  assert.strictEqual(T.tasks[0].reminded_at, null);
});

test('linha de task_reminders já enviada não conta pro teto', async () => {
  const { T, sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-27T12:00:00Z' }],
    task_reminders: [{ id: 'r1', task_id: ID, remind_at: '2026-09-26T12:00:00Z', sent_at: '2026-09-26T12:00:30Z' }, { id: 'r2', task_id: ID, remind_at: '2026-09-26T15:00:00Z', sent_at: '2026-09-26T15:00:30Z' }] });
  const r = await somarLembreteNaTarefa({ supabase: sb, taskId: ID, iso: '2026-09-27T23:00:00Z' });
  assert.strictEqual(r.status, 'somou');
  assert.strictEqual(T.task_reminders.length, 3);
});

// Contrato da fiação no engine (applyTaskActions usa o supabase global — não roda aqui).
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: o reschedule decide SOMA antes de montar o update que sobrescreve', () => {
  const ini = ENGINE.indexOf("} else if (a.action === 'reschedule') {", ENGINE.indexOf('async function applyTaskActions('));
  assert.ok(ini > 0);
  const trecho = ENGINE.slice(ini, ENGINE.indexOf("} else if (a.action === 'snooze_reminders')", ini));
  const iDecide = trecho.indexOf('decidirHorarioNovo(');
  const iUpdate = trecho.indexOf('const update = {};');
  assert.ok(iDecide > 0 && iUpdate > 0 && iDecide < iUpdate, 'a decisão tem de vir antes do update de remind_at');
  assert.match(trecho, /somarLembreteNaTarefa\(/);
  assert.match(trecho, /_dec\.modo === 'somar'[\s\S]*?continue;/);
});

test('engine: a resposta do lote de somas é o texto do que ficou gravado', () => {
  assert.match(ENGINE, /lembretesSomados: \[\.\.\._somados\.values\(\)\]/);
  assert.match(ENGINE, /base = _soSomas \? _txtSoma : /);
});

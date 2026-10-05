'use strict';
// HEALTH-CHECK-ATRASO-SEM-JANELA (05/10). Segunda-feira 05:00: "⚠️ 6/33 tasks vencidas (2+ dias)
// sem cobrança nas últimas 48h (+2 em silêncio)". As 8 tarefas venceram no SÁBADO 03/10; o
// coletor de atraso (checkOverdueAlerts) só roda 13h–19h e só cobra o que venceu até ONTEM, então
// a 1ª chance delas era domingo 04/10 — dia fechado (sem aula), e o rituals.log tem >1000
// "alerta_atraso skipped quiet:dia_fechado:sem_aula". Nenhuma chance de cobrar = não é negligência.
// Todos os 5 alarmes deste check nos últimos 30 dias caíram numa SEGUNDA (07, 14, 21, 28/09, 05/10).
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./health-check');

function fakeSb(tabelas) {
  return {
    from(nome) {
      const filtros = [];
      const q = {
        select() { return q; },
        eq(c, v) { filtros.push((r) => r[c] === v); return q; },
        gte(c, v) { filtros.push((r) => r[c] >= v); return q; },
        lt(c, v) { filtros.push((r) => r[c] < v); return q; },
        lte(c, v) { filtros.push((r) => r[c] <= v); return q; },
        in(c, vs) { filtros.push((r) => vs.includes(r[c])); return q; },
        not(c, op, v) {
          if (op === 'is') filtros.push((r) => r[c] != null);
          else if (op === 'in') { const vs = String(v).replace(/[()]/g, '').split(','); filtros.push((r) => !vs.includes(r[c])); }
          return q;
        },
        then(ok, ko) { return Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r))), error: null }).then(ok, ko); },
      };
      return q;
    },
  };
}

// Segunda 05/10 05:00:16 BRT — o carimbo real da rodada (health_check_runs 08:00:16Z).
const AGORA = Date.parse('2026-10-05T08:00:16.204Z');
// As 8 tarefas REAIS que venceram em 03/10 sem cobrança (ids e donos do banco).
const VENCERAM_SABADO = [
  ['2cf66879-57a4-4004-b6a3-a398ba48155f', 'e6afed0d-59af-432b-aec3-ce2427db7be2'],
  ['809457d7-3324-46c3-987d-bd1ef814b3a7', 'fded00f4-6a6c-47f7-b749-bcd1ea1d1254'],
  ['9372b370-19b4-42ba-a5f6-39b506fb3339', 'e6afed0d-59af-432b-aec3-ce2427db7be2'],
  ['8c6f6305-42ca-4d0a-8b3f-92f6cba3b3bc', 'c6067c7d-05f1-4882-a224-3f91d4de5997'],
  ['c2a87b2f-43d6-487e-b099-29e3c70d6135', 'c9e72a40-3f91-4be8-bc6c-0e4060f7fc84'],
  ['fbad86ca-9786-4638-9785-4fadc37fe503', 'c6067c7d-05f1-4882-a224-3f91d4de5997'],
  ['1e968d8a-c301-44d0-b897-943dca3405eb', '5d74b86b-da6a-4aa1-8783-4b80a2a6d102'],
  ['c518b7e5-d1cc-4f6b-a36b-cae0a5f6a0eb', 'fded00f4-6a6c-47f7-b749-bcd1ea1d1254'],
].map(([id, dono]) => ({ id, assigned_to: dono, due_date: '2026-10-03', status: 'pending' }));

// Calendário real da semana: domingo 04/10 fechado (sem aula), o resto aberto. Ninguém em silêncio
// pessoal — o caso é só o dia fechado. Às 05:00 (sem ymd, como o nowBrtParts manda) ninguém quieto.
const quietCalendario = async (_dono, now) => (now && now.ymd === '2026-10-04'
  ? { quiet: true, reason: 'dia_fechado:sem_aula' } : { quiet: false, reason: null });

test('caso 05/10: tarefas que venceram no sábado e só teriam o domingo fechado NÃO alarmam', async () => {
  const sb = fakeSb({ tasks: VENCERAM_SABADO, notifications: [] });
  const r = await H.checkOverdueTasks({ sb, quiet: quietCalendario, agoraMs: AGORA });
  assert.strictEqual(r.status, 'ok', r.detail);
  assert.match(r.detail, /8 sem janela de cobrança/);
});

test('caso genuíno continua alarmando: venceu quinta, sábado 13–19h aberto, nenhuma cobrança', async () => {
  const genuina = { id: 'gen-1', assigned_to: 'c6067c7d-05f1-4882-a224-3f91d4de5997', due_date: '2026-10-01', status: 'pending' };
  const sb = fakeSb({ tasks: [...VENCERAM_SABADO, genuina], notifications: [] });
  const r = await H.checkOverdueTasks({ sb, quiet: quietCalendario, agoraMs: AGORA });
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /^1\/9 tasks vencidas/);
});

test('cobrança dentro das 48h tira a tarefa do alarme (controle)', async () => {
  const genuina = { id: 'gen-1', assigned_to: 'c6067c7d-05f1-4882-a224-3f91d4de5997', due_date: '2026-10-01', status: 'pending' };
  const sb = fakeSb({ tasks: [genuina], notifications: [{ reference_id: 'gen-1', notification_type: 'overdue_alert', sent_at: '2026-10-03T19:00:00.000Z' }] });
  const r = await H.checkOverdueTasks({ sb, quiet: quietCalendario, agoraMs: AGORA });
  assert.strictEqual(r.status, 'ok');
});

test('dono em silêncio de trabalho a tarde inteira do sábado também não tem chance (não é só dia fechado)', async () => {
  const genuina = { id: 'gen-1', assigned_to: 'dono-silencio', due_date: '2026-10-01', status: 'pending' };
  const quiet = async (dono, now) => (dono === 'dono-silencio' && now && now.ymd ? { quiet: true, reason: 'quiet_day' } : quietCalendario(dono, now));
  const r = await H.checkOverdueTasks({ sb: fakeSb({ tasks: [genuina], notifications: [] }), quiet, agoraMs: AGORA });
  assert.strictEqual(r.status, 'ok', r.detail);
});

test('teveChanceDeCobranca: só conta rodada 13–19h DEPOIS do vencimento e DENTRO da janela medida', async () => {
  const desdeMs = AGORA - 48 * 3600 * 1000;
  const vistos = [];
  const quiet = async (_d, now) => { vistos.push(`${now.ymd} ${now.hour}`); return { quiet: true }; };
  const tem = await H.teveChanceDeCobranca('x', '2026-10-02', { desdeMs, agoraMs: AGORA, quiet });
  assert.strictEqual(tem, false);
  assert.deepStrictEqual(vistos, ['2026-10-03 13', '2026-10-03 14', '2026-10-03 15', '2026-10-03 16', '2026-10-03 17', '2026-10-03 18',
    '2026-10-04 13', '2026-10-04 14', '2026-10-04 15', '2026-10-04 16', '2026-10-04 17', '2026-10-04 18']);
});

test('teveChanceDeCobranca: falha ao aferir o silêncio conta como chance (alarme não some por erro)', async () => {
  const quiet = async () => { throw new Error('banco fora'); };
  assert.strictEqual(await H.teveChanceDeCobranca('x', '2026-10-01', { desdeMs: AGORA - 48 * 3600e3, agoraMs: AGORA, quiet }), true);
});

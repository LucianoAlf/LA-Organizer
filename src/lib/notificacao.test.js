'use strict';
// NOTIFICATIONS-CALADA (30/09) — ver cabeçalho de notificacao.js. Erro real do banco (pg_constraint
// lido em 30/09): notifications_notification_type_check não aceita task_reminder / silent_checkin /
// task_assigned_by_other → PostgREST devolve { error: { code: '23514' } } e não lança.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const N = require('./notificacao');

const ERRO_CHECK = { code: '23514', message: 'new row for relation "notifications" violates check constraint "notifications_notification_type_check"' };

function sbInsert(resposta) {
  const inseridos = [];
  return { inseridos, from: (t) => ({ insert: async (row) => { inseridos.push({ t, row }); return resposta; } }) };
}
function comConsole(fn) {
  const orig = console.error; const linhas = [];
  console.error = (...a) => linhas.push(a.join(' '));
  return Promise.resolve(fn()).finally(() => { console.error = orig; }).then((r) => ({ r, linhas }));
}

test('insert recusado pelo CHECK: NÃO é calado — loga tipo/onde/código e conta por tipo', async () => {
  N._zeraFalhas();
  const sb = sbInsert({ data: null, error: ERRO_CHECK });
  const { r, linhas } = await comConsole(() => N.registrarNotificacao(sb, { notification_type: 'task_reminder', collaborator_id: 'c1' }, { onde: 'checkReminders' }));
  assert.deepStrictEqual(r, { ok: false, code: '23514', erro: ERRO_CHECK.message });
  assert.strictEqual(linhas.length, 1);
  assert.match(linhas[0], /\[notifications\] insert FALHOU tipo=task_reminder onde=checkReminders code=23514/);
  await comConsole(() => N.registrarNotificacao(sb, { notification_type: 'task_reminder' }, { onde: 'checkReminders' }));
  assert.deepStrictEqual(N.falhasDeNotificacao(), { task_reminder: 2 });
});

test('insert que passa: ok, sem log, sem contagem', async () => {
  N._zeraFalhas();
  const sb = sbInsert({ data: null, error: null });
  const { r, linhas } = await comConsole(() => N.registrarNotificacao(sb, { notification_type: 'overdue_alert' }, { onde: 'x' }));
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(linhas.length, 0);
  assert.deepStrictEqual(N.falhasDeNotificacao(), {});
});

// conversation_history em memória (like com % e filtros usados)
function sbHist(rows) {
  return {
    from: () => {
      const preds = [];
      const b = {
        select() { return b; }, limit() { return b; },
        eq(c, v) { preds.push((r) => r[c] === v); return b; },
        gte(c, v) { preds.push((r) => new Date(r[c]) >= new Date(v)); return b; },
        like(c, pat) { const re = new RegExp('^' + pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's'); preds.push((r) => re.test(String(r[c] || ''))); return b; },
        then(res, rej) { return Promise.resolve({ data: rows.filter((r) => preds.every((p) => p(r))), error: null }).then(res, rej); },
      };
      return b;
    },
  };
}
const ENVIO = { direction: 'outbound', ref_type: 'task', ref_id: 't1', collaborator_id: 'c1' };

test('cooldown lê o ENVIO do lembrete de hora (e só ele — "⏰ Lembrete:" de task_reminders não conta)', async () => {
  const sb = sbHist([
    { ...ENVIO, content: '⏰ Lembrete: *Pagar boleto* — hoje', created_at: '2026-09-29T15:00:20Z' },
    { ...ENVIO, content: '🔔 *Lembrete:* Pagar boleto', created_at: '2026-09-29T12:00:20Z' },
  ]);
  assert.strictEqual(await N.jaAvisouLembreteDesde(sb, 't1', '2026-09-29T11:00:00Z'), true);
  assert.strictEqual(await N.jaAvisouLembreteDesde(sb, 't1', '2026-09-29T13:00:00Z'), false, 'o ⏰ das linhas extras não é o lembrete de hora');
  assert.strictEqual(await N.jaAvisouLembreteDesde(sb, 'outra', '2026-09-29T11:00:00Z'), false);
});

test('trava do check-in silencioso lê o check-in enviado', async () => {
  const sb = sbHist([{ direction: 'outbound', collaborator_id: 'c1', content: 'Oi Ana, aqui é o TOM. Faz uns dias que a gente não conversa — tudo certo aí?', created_at: '2026-09-25T12:00:00Z' }]);
  assert.strictEqual(await N.jaFezCheckinDesde(sb, 'c1', '2026-09-16T00:00:00Z'), true);
  assert.strictEqual(await N.jaFezCheckinDesde(sb, 'c2', '2026-09-16T00:00:00Z'), false);
});

test('"recém-atribuídas": o envio real vira a entrada que o bloco de decisões lê, sem duplicar', () => {
  const hist = [{ ref_id: 'aaaaaaaa-1111', created_at: '2026-09-30T12:00:00Z',
    content: '📋 O Clayton abriu uma tarefa pra você:\n*Conferir caixa da Barra* (prazo 01/10)\n\n❓ *Como você quer tratar?*' }];
  const r = N.juntaAtribuidas([{ notification_type: 'overdue_alert', reference_id: 'x' }], hist);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual({ t: r[1].notification_type, id: r[1].reference_id, title: r[1].title },
    { t: 'task_assigned_by_other', id: 'aaaaaaaa-1111', title: 'Conferir caixa da Barra (de Clayton)' });
  assert.strictEqual(N.juntaAtribuidas(r, hist).length, 2);
});

// Contrato: nenhum insert em notifications fica sem ler o erro.
const SRC = path.join(__dirname, '..');
test('todo insert em notifications lê o erro (claim com `error:` ou registrarNotificacao)', () => {
  const soltos = [];
  for (const f of ['engine.js', 'rituals/dispatcher.js']) {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    const re = /from\('notifications'\)\s*\.insert\(/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const antes = s.slice(Math.max(0, m.index - 120), m.index);
      if (!/\{[^{}]*\berror\b[^{}]*\}\s*=\s*await\s+\w+\s*\.\s*$/.test(antes)) {
        soltos.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  assert.deepStrictEqual(soltos, [], 'insert em notifications sem ler o `error`: ' + soltos.join(', '));
});

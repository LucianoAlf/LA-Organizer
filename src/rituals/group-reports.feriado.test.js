'use strict';
// FERIADO-COBRA-QUEM-NAO-TRABALHA (Alf, 07/09/2026 — Independência).
//
// O digest de tarefas atrasadas saiu às 10:30 na Barra num feriado, cobrando o time.
// O `weekdays` cobre sábado e domingo e mais nada. A pauta de anamnese já lia o calendário
// desde 06/09 e ficou calada no mesmo dia — este ritual é OUTRO e nunca soube.
//
// Números reais do dia, que são o que define o desenho: Barra 0 aulas (141 na sexta, 103 na
// terça); as 3 aulas de 07/09 eram TODAS do Recreio. Por isso o portão é POR UNIDADE: o
// Recreio segue recebendo, a Barra não.

const assert = require('node:assert');
const { test } = require('node:test');
const { escolaAbertaHoje, PRESETS_DIARIOS, dispatchGroupReports } = require('./group-reports');

const UNI_BARRA = '368d47f5-2d88-4475-bc14-ba084a9a348e';
const UNI_RECREIO = '95553e96-971b-4590-a6eb-0201d013c14d';

// Dublê do PostgREST: guarda os filtros e devolve as aulas que casam.
function fakeLaReport(aulasPorUnidade, { erro = null, lanca = false } = {}) {
  return {
    from() {
      const st = {};
      const b = {
        select() { return b; },
        eq(c, v) { st[c] = v; return b; },
        gte() { return b; },
        lte() { return b; },
        limit() {
          if (lanca) throw new Error('conexão caiu');
          if (erro) return Promise.resolve({ data: null, error: { message: erro } });
          const n = aulasPorUnidade[st.unidade_id] || 0;
          return Promise.resolve({ data: Array.from({ length: Math.min(n, 1) }, (_, i) => ({ id: i })), error: null });
        },
      };
      return b;
    },
  };
}

test('feriado: unidade SEM aula hoje → não envia (caso Barra 07/09)', async () => {
  const r = await escolaAbertaHoje({
    laReport: fakeLaReport({ [UNI_RECREIO]: 3 }), unidadeId: UNI_BARRA, ymd: '2026-09-07',
  });
  assert.strictEqual(r.enviar, false);
  assert.match(r.motivo, /nao tem aula hoje/);
});

test('mesmo dia, unidade COM aula → envia (caso Recreio 07/09)', async () => {
  const r = await escolaAbertaHoje({
    laReport: fakeLaReport({ [UNI_RECREIO]: 3 }), unidadeId: UNI_RECREIO, ymd: '2026-09-07',
  });
  assert.strictEqual(r.enviar, true);
  assert.strictEqual(r.motivo, null);
});

// --- FAIL-OPEN: silêncio por incapacidade é pior que ruído -------------------
test('grupo SEM unidade → envia (não dá pra consultar calendário)', async () => {
  const r = await escolaAbertaHoje({ laReport: fakeLaReport({}), unidadeId: null, ymd: '2026-09-07' });
  assert.strictEqual(r.enviar, true);
});

test('leitura do calendário FALHA → envia mesmo assim, com motivo', async () => {
  const r = await escolaAbertaHoje({
    laReport: fakeLaReport({}, { erro: 'timeout' }), unidadeId: UNI_BARRA, ymd: '2026-09-07',
  });
  assert.strictEqual(r.enviar, true, 'nunca silenciar por falha de leitura');
  assert.match(r.motivo, /leitura do calendario falhou/);
});

test('cliente do LA Report ausente → envia', async () => {
  const r = await escolaAbertaHoje({ laReport: null, unidadeId: UNI_BARRA, ymd: '2026-09-07' });
  assert.strictEqual(r.enviar, true);
});

test('exceção na leitura → envia (nunca derruba o tick)', async () => {
  const r = await escolaAbertaHoje({
    laReport: fakeLaReport({}, { lanca: true }), unidadeId: UNI_BARRA, ymd: '2026-09-07',
  });
  assert.strictEqual(r.enviar, true);
  assert.match(r.motivo, /leitura do calendario falhou/);
});

test('só os presets DIÁRIOS entram no portão', () => {
  assert.ok(PRESETS_DIARIOS.has('overdue'));
  assert.ok(PRESETS_DIARIOS.has('daily_morning'));
  assert.ok(!PRESETS_DIARIOS.has('weekly'), 'resumo de período não pode sumir por feriado');
  assert.ok(!PRESETS_DIARIOS.has('monthly'));
});

// --- integração: o overdue da Barra num feriado não chega a construir relatório
test('dispatchGroupReports: overdue em dia sem aula NÃO chama buildGroupReport', async () => {
  let construiu = 0;
  const supabase = {
    from(tbl) {
      const b = {
        select() { return b; },
        eq() { return Promise.resolve({
          data: [{
            group_id: 'g1', preset: 'overdue', enabled: true, weekdays: [1, 2, 3, 4, 5],
            day_of_month: null, time_local: '10:30',
            group: { name: 'Administrativo e Comercial Barra', la_report_unidade_id: UNI_BARRA },
          }],
          error: null,
        }); },
        insert() { return b; },
        single() { return Promise.resolve({ data: { id: 'claim1' }, error: null }); },
      };
      if (tbl !== 'group_notification_settings') {
        b.eq = () => Promise.resolve({ data: [], error: null });
      }
      return b;
    },
  };
  await dispatchGroupReports({
    now: { ymd: '2026-09-07', hour: 10, minute: 30, dow: 1 },
    supabase,
    deps: {
      laReport: fakeLaReport({ [UNI_RECREIO]: 3 }),
      buildGroupReport: async () => { construiu++; return { html: '<div/>', isEmpty: false }; },
    },
  });
  assert.strictEqual(construiu, 0, 'não pode nem montar o relatório num dia sem aula');
});

test('dispatchGroupReports: com aula, o overdue segue construindo', async () => {
  let construiu = 0;
  const inseridos = [];
  const supabase = {
    from(tbl) {
      const b = {
        select() { return b; },
        eq() { return Promise.resolve({
          data: [{
            group_id: 'g1', preset: 'overdue', enabled: true, weekdays: [1, 2, 3, 4, 5],
            day_of_month: null, time_local: '10:30',
            group: { name: 'Administração Recreio', la_report_unidade_id: UNI_RECREIO },
          }],
          error: null,
        }); },
        insert(row) { inseridos.push({ tbl, row }); return b; },
        single() { return Promise.resolve({ data: { id: 'claim1' }, error: null }); },
      };
      if (tbl !== 'group_notification_settings') {
        b.eq = () => Promise.resolve({ data: [], error: null });
      }
      return b;
    },
  };
  await dispatchGroupReports({
    now: { ymd: '2026-09-07', hour: 10, minute: 30, dow: 1 },
    supabase,
    deps: {
      laReport: fakeLaReport({ [UNI_RECREIO]: 3 }),
      buildGroupReport: async () => { construiu++; return { html: '<div/>', isEmpty: false }; },
    },
  });
  assert.strictEqual(construiu, 1);
  assert.ok(inseridos.some((i) => i.tbl === 'group_chat_messages'), 'o card tem que ser inserido');
});

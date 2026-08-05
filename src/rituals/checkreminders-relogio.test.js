'use strict';
// QUEM COBROU O MATHEUS
//
// O cenário A do Replay Lab dirigia `remindOperationalTasks`. Handler errado: ele — e o
// irmão `remindPersonalTasks` — filtram por `due_date = amanhã` e só rodam na janela
// 12:00-12:10 UTC. Nenhum dos dois lê `remind_at`. Quem lê é `checkReminders`
// (dispatcher.js), o único que faz `.lte('remind_at', agora)`.
//
// A consequência era pior do que "o teste não roda": o cobrador NUNCA selecionava a
// tarefa da fixture, então a verificação "não cobrou antes da quinta" passava por
// VACUIDADE — ficaria verde com o bug presente, que é o falso-verde que o laboratório
// existe para eliminar.
//
// Para o laboratório poder dirigir o cobrador de verdade, `checkReminders` precisava de
// duas coisas que não tinha: ser exportado e aceitar o relógio. Sem relógio injetável não
// há como perguntar "e na quinta, ele cobra?" sem esperar até quinta.
//
// Este teste prova o CONTRATO do relógio: o instante que entra na consulta é o que foi
// passado, não o do sistema. Se alguém reintroduzir `new Date()` lá dentro, cai aqui.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fachada.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fachada';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://fachada.local';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'fachada';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'fachada';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fachada';

const test = require('node:test');
const assert = require('node:assert');
const dispatcher = require('./dispatcher');

// Dublê do query-builder: registra os filtros e devolve zero linhas, para o cobrador
// retornar antes do laço de envio (que iria ao banco de verdade).
function sbCaptura(linhas = [], perfis = null) {
  const filtros = { tabela: null, lte: {}, is: {}, not: [], in: {} };
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    gte() { return chain; },
    in(col, val) { filtros.in[col] = val; return chain; },
    not(col, op, val) { filtros.not.push([col, op, val]); return chain; },
    lte(col, val) { filtros.lte[col] = val; return chain; },
    is(col, val) { filtros.is[col] = val; return chain; },
    limit() { return Promise.resolve({ data: linhas, error: null }); },
  };
  // `collaborators` responde direto no select (é como idsDePerfisQA consulta).
  const colabs = { select: async () => ({ data: perfis || [], error: null }) };
  return { filtros, sb: { from(t) { filtros.tabela = t; return t === 'collaborators' && perfis ? colabs : chain; } } };
}

test('checkReminders está exportado — o Replay Lab precisa dirigir o cobrador real', () => {
  assert.equal(typeof dispatcher.checkReminders, 'function',
    'sem export, o cenário chama o handler errado e passa por vacuidade');
});

test('checkReminders consulta pelo relógio RECEBIDO, não pelo do sistema', async () => {
  const q = sbCaptura([]);
  const quinta0930 = new Date('2026-08-06T12:30:00.000Z');
  await dispatcher.checkReminders(quinta0930, { supabase: q.sb });

  assert.equal(q.filtros.tabela, 'tasks');
  assert.equal(q.filtros.lte.remind_at, quinta0930.toISOString(),
    'a consulta usou outro instante: o relógio não está injetado de verdade');
});

test('relógio diferente ⇒ corte diferente (o cobrador não congela o instante no require)', async () => {
  const a = sbCaptura([]);
  const b = sbCaptura([]);
  await dispatcher.checkReminders(new Date('2026-08-05T12:00:00.000Z'), { supabase: a.sb });
  await dispatcher.checkReminders(new Date('2026-08-06T12:30:00.000Z'), { supabase: b.sb });

  assert.notEqual(a.filtros.lte.remind_at, b.filtros.lte.remind_at,
    'os dois ticks produziram o mesmo corte — o relógio está sendo ignorado');
});

// ---- Escopo em replay (achado ao rodar o cenário A em 05/08) ----
// Com o relógio adiantado, este sweep selecionou 24 lembretes de gente real e tentou
// mandar. A trava de saída barrou os 24; mas o laboratório não pode chegar até ela.
const { runInTurn } = require('../services/turn-claim');

const PERFIS = [
  { id: 'qa1', phone: '5500000000001' },
  { id: 'matheus', phone: '5521968060404' },
];

test('[replay] a varredura fica restrita aos perfis da faixa reservada', async () => {
  const q = sbCaptura([], PERFIS);
  await runInTurn({ waMessageId: 'W', qa: true, runId: 'r' }, () =>
    dispatcher.checkReminders(new Date('2026-08-07T12:30:00Z'), { supabase: q.sb }));

  assert.deepEqual(q.filtros.in.assigned_to, ['qa1'],
    'o laboratório está enxergando tarefa de gente real');
});

test('[produção] fora de replay a varredura NÃO é restrita — nada mudou para o time', async () => {
  const q = sbCaptura([], PERFIS);
  await dispatcher.checkReminders(new Date('2026-08-07T12:30:00Z'), { supabase: q.sb });

  assert.equal(q.filtros.in.assigned_to, undefined,
    'o guard de replay vazou para produção e o cobrador parou de ver o time');
});

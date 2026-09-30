// RITUAL-AGENDA-GUARD (Alf 30/09 19:04 BRT): fechamento perguntou "rolou?" de evento cancelado.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./ritual-agenda-guard');

// Texto REAL enviado ao Alf em 30/09 22:04 UTC (conversation_history 0b57292b).
const REAL_ALF_3009 = `E aí, Alf, como foi o dia? 👽

📭 Sem tarefas marcadas hoje, nem pessoal nem trabalho.

🗓️ *Jornada de Cordas* (13h–17h) — rolou? me confirma.`;

// Agenda REAL do Alf em 30/09: os dois eventos do dia estavam cancelados (Mentoria Benji e a
// Jornada 3001604f, cancelada em 29/09). A Jornada remarcada (41a6e5af) é de 07/10 — não é hoje.
const AGENDA_ALF_3009 = [];

test('caso real 30/09: linha da Jornada cancelada sai; o resto fica', () => {
  const r = g.filtrarEventosForaDaAgenda(REAL_ALF_3009, { agenda: AGENDA_ALF_3009, hojeYmd: '2026-09-30' });
  assert.equal(r.fired, true);
  assert.equal(r.removidas.length, 1);
  assert.deepEqual(r.removidas[0].titulos, ['Jornada de Cordas']);
  assert.equal(r.texto, 'E aí, Alf, como foi o dia? 👽\n\n📭 Sem tarefas marcadas hoje, nem pessoal nem trabalho.');
  assert.doesNotMatch(r.texto, /Jornada/);
});

test('mesmo texto com o evento DE PÉ na agenda de hoje: nada muda', () => {
  const r = g.filtrarEventosForaDaAgenda(REAL_ALF_3009, { agenda: [{ title: 'Jornada de Cordas' }], hojeYmd: '2026-09-30' });
  assert.equal(r.fired, false);
  assert.equal(r.texto, REAL_ALF_3009);
});

test('agenda que não carregou ≠ agenda vazia: não remove nada', () => {
  const r = g.filtrarEventosForaDaAgenda(REAL_ALF_3009, { agenda: [], agendaOk: false, hojeYmd: '2026-09-30' });
  assert.equal(r.fired, false);
  assert.equal(r.texto, REAL_ALF_3009);
});

test('linhas reais de eventos VÁLIDOS (replay 30 dias) casam pelo título, com variação de escrita', () => {
  const casos = [
    ['🗓️ 14h — *Reunião com Leo e Juliana*', 'Reunião com Leo e Juliana', '2026-09-01'],
    ['3. 🗓️ *Consulta Alice* — rolou? me confirma.', 'Consulta Alice', '2026-09-23'],
    ['• 🗓️ 13h–20h — *Marcar presencas do horário*', 'Marcar presenças do horário', '2026-09-09'],
    ['🗓️ 13h–20h — Marcar presenças do horário', 'Marcar presenças do horário', '2026-09-01'],
    ['🗓️ *Entrevista — Serjão (Recepcionista SonoraMente)* (13h30) — rolou? Me confirma.', 'Entrevista — Serjão', '2026-09-10'],
    ['• 🗓️ Terapia — ⏰ 19h (online)', 'Terapia', '2026-09-09'],
    ['🗓️ *Mentoria com Ariel (Neon Escola)* (9h) — ✅ feito', 'Mentoria com Ariel', '2026-09-22'],
  ];
  for (const [linha, titulo, dia] of casos) {
    const r = g.filtrarEventosForaDaAgenda(`Oi\n${linha}`, { agenda: [{ title: titulo }], hojeYmd: dia });
    assert.equal(r.fired, false, `não devia remover: ${linha}`);
    assert.equal(r.parciais.length, 0, `casou inteira: ${linha}`);
  }
});

test('linha com vários eventos: só sai se NENHUM casar; parcial fica e é reportado', () => {
  const linha = '🗓️ *Serafin* (13h) · *Pet* (17h) · *Antonio* (17h30) · *Kaio* (18h)';
  const parcial = g.filtrarEventosForaDaAgenda(linha, { agenda: [{ title: 'REC Serafin' }, { title: 'REC Pet' }], hojeYmd: '2026-09-11' });
  assert.equal(parcial.fired, false);
  assert.equal(parcial.parciais.length, 1);
  assert.deepEqual(parcial.parciais[0].fora, ['Antonio', 'Kaio']);
  const nenhum = g.filtrarEventosForaDaAgenda(linha, { agenda: [{ title: 'Reunião ADM' }], hojeYmd: '2026-09-11' });
  assert.equal(nenhum.fired, true);
});

test('linha que cita OUTRO dia não é "evento de hoje" (briefings reais de 24–28/09)', () => {
  const linhas = [
    ['🗓️ Amanhã (30/09) você já confirmou presença na *Jornada de Cordas*, 13h–17h na Casa do Alf.', '2026-09-28'],
    ['🗓️ *Jornada de Cordas* — qua 30/09 · 13h–17h (confirmado ✅)', '2026-09-24'],
    ['🗓️ Só de olho: quarta (30/09) tem *Jornada de Cordas*, 13h às 17h, e sua presença já está confirmada.', '2026-09-26'],
    ['🗓️ *Reunião Jornada Bateria* (quarta 02/09, com Luciano) — rolou? Me confirma pra eu fechar.', '2026-09-04'],
  ];
  for (const [linha, dia] of linhas) {
    assert.equal(g.linhaDeEvento(linha, { hojeYmd: dia }), null, linha);
    assert.equal(g.filtrarEventosForaDaAgenda(linha, { agenda: [], hojeYmd: dia }).fired, false);
  }
  // mas a data de HOJE escrita por extenso continua sendo hoje
  assert.notEqual(g.linhaDeEvento('🗓️ *Jornada de Cordas* — 30/09 · 13h–17h', { hojeYmd: '2026-09-30' }), null);
});

test('tarefa, cabeçalho e texto comum não são linha de evento', () => {
  const texto = [
    '1. ⏰ 15h — *Revisar relatório* — fez?',
    '🗓️ *Compromissos de hoje:*',
    '2. 🔴 *SEO da loja* — fez?',
    'Me diz quais fez. Pode ser: "1 e 2" ou "fiz tudo".',
    '🗓️ ⏰ 9h–10h30 — *Reunião Jordan Jornada Bateria* · Online · 3/3 confirmaram',
  ].join('\n');
  const r = g.filtrarEventosForaDaAgenda(texto, { agenda: [{ title: 'Reunião Jordan Jornada Bateria' }], hojeYmd: '2026-09-02' });
  assert.equal(r.fired, false);
  assert.equal(r.texto, texto);
});

test('"rolou?" com hora sem emoji também é checado', () => {
  const r = g.filtrarEventosForaDaAgenda('• *Jornada de Cordas* (13h–17h) — rolou?', { agenda: [], hojeYmd: '2026-09-30' });
  assert.equal(r.fired, true);
});

test('caso real 28/09 (mesma família): "Compromisso com Xuxu e Aline" cancelado às 16h06, fechamento 19h04 perguntou', () => {
  const linha = '🗓️ *Reunião com Xuxu e Aline* (17h) — rolou? me confirma.';
  assert.equal(g.filtrarEventosForaDaAgenda(`Oi\n${linha}`, { agenda: [], hojeYmd: '2026-09-28' }).fired, true);
  // se estivesse de pé, o título diferente ("Compromisso" × "Reunião") ainda casa
  assert.equal(g.filtrarEventosForaDaAgenda(`Oi\n${linha}`, { agenda: [{ title: 'Compromisso com Xuxu e Aline' }], hojeYmd: '2026-09-28' }).fired, false);
});

test('"rolou?" de evento de ontem não fechado fica (briefing real do Alf 11/09); sem "rolou" não vale', () => {
  const recentes = [{ title: 'Mentoria de IA — Leonardo da Br[Ai]n' }, { title: 'Entrevista — Serjão (Recepcionista SonoraMente)' }];
  const txt = '• 🗓️ *Mentoria de IA — Leonardo da Br[Ai]n* (14h30) — rolou?\n• 🗓️ *Entrevista — Serjão, recepcionista* (13h30) — rolou?';
  const r = g.filtrarEventosForaDaAgenda(txt, { agenda: [], recentes, hojeYmd: '2026-09-11' });
  assert.equal(r.fired, false);
  // sem "rolou", a linha diz "hoje tem" — evento de ontem não serve
  const hoje = g.filtrarEventosForaDaAgenda('🗓️ 14h30 — *Mentoria de IA — Leonardo da Br[Ai]n*', { agenda: [], recentes, hojeYmd: '2026-09-11' });
  assert.equal(hoje.fired, true);
});

test('frase corrida sem título estruturado não é checada (fechamentos reais de 21, 22 e 28/09)', () => {
  const linha = '📭 Sem nada marcado hoje. Rolou alguma coisa que vale anotar — tipo aquela revisão de relatórios às 19h?';
  assert.equal(g.linhaDeEvento(linha, { hojeYmd: '2026-09-28' }), null);
  assert.equal(g.filtrarEventosForaDaAgenda(linha, { agenda: [], hojeYmd: '2026-09-28' }).fired, false);
});

test('casamento de título: sem acento/caixa, contido, palavras; não casa título diferente', () => {
  assert.equal(g.titulosCasam('Marcar presencas do horario', 'Marcar Presenças do Horário'), true);
  assert.equal(g.titulosCasam('Casamento Miguel — Alto da Boa Vista', 'Casamento Miguel Caxias'), true);
  assert.equal(g.titulosCasam('Jornada de Cordas', 'Reunião Jordan Jornada Bateria'), false);
  assert.equal(g.titulosCasam('REC', 'Ir para o Recreio'), false);
});

// Fake mínimo do supabase-js: cada from(tabela) devolve um builder encadeável que resolve com os
// dados configurados, aplicando só os filtros que importam pro teste (status cancelado vem do banco).
function fakeSupabase(tabelas, inserts = []) {
  return {
    from(nome) {
      const b = {
        _nome: nome,
        select() { return b; }, eq() { return b; }, neq() { return b; }, gte() { return b; },
        lte() { return b; }, or() { return b; },
        insert(row) { inserts.push({ tabela: nome, row }); return Promise.resolve({ error: null }); },
        then(res, rej) { return Promise.resolve(tabelas[nome] || { data: [], error: null }).then(res, rej); },
      };
      return b;
    },
  };
}

test('carregarAgendaDoDia: participante com evento cancelado ou de outro dia não entra; institucional de hoje entra', async () => {
  const sb = fakeSupabase({
    events: { data: [], error: null },
    event_participants: { data: [
      { status: 'confirmed', event: { id: '3001604f', title: 'Jornada de Cordas', status: 'cancelled', start_at: '2026-09-30T16:00:00+00:00' } },
      { status: 'confirmed', event: { id: '41a6e5af', title: 'Jornada de Cordas', status: 'scheduled', start_at: '2026-10-07T16:00:00+00:00' } },
      { status: 'confirmed', event: { id: 'x1', title: 'Reunião ADM', status: 'scheduled', start_at: '2026-09-30T17:00:00+00:00' } },
      { status: 'confirmed', event: { id: 'x2', title: 'Mentoria Levi', status: 'scheduled', start_at: '2026-09-29T12:00:00+00:00' } },
      { status: 'confirmed', event: { id: 'x3', title: 'Reunião cancelada ontem', status: 'cancelled', start_at: '2026-09-29T12:00:00+00:00' } },
      { status: 'confirmed', event: { id: 'x4', title: 'Velho demais', status: 'scheduled', start_at: '2026-09-20T12:00:00+00:00' } },
    ], error: null },
    school_events: { data: [{ id: 's1', title: 'Semana da Música', event_date: '2026-09-28', end_date: '2026-10-02', status: 'active' }], error: null },
  });
  const r = await g.carregarAgendaDoDia({ supabase: sb, collaboratorId: 'a', hojeYmd: '2026-09-30' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.agenda.map((e) => e.title).sort(), ['Reunião ADM', 'Semana da Música']);
  assert.deepEqual(r.recentes.map((e) => e.title), ['Mentoria Levi']);
});

test('carregarAgendaDoDia: erro de consulta → ok=false (fail-open no guard)', async () => {
  const sb = fakeSupabase({ events: { data: null, error: { message: 'boom' } } });
  const r = await g.carregarAgendaDoDia({ supabase: sb, collaboratorId: 'a', hojeYmd: '2026-09-30' });
  assert.equal(r.ok, false);
  const inserts = [];
  const sb2 = fakeSupabase({ events: { data: null, error: { message: 'boom' } } }, inserts);
  const a = await g.aplicarGuardaDeAgenda({ supabase: sb2, collaboratorId: 'a', ritual: 'fechamento', texto: REAL_ALF_3009, hojeYmd: '2026-09-30' });
  assert.equal(a.texto, REAL_ALF_3009);
  assert.equal(inserts.length, 0);
});

test('aplicarGuardaDeAgenda: remove e registra no marker_logs (RITUAL_AGENDA_GUARD/rejected)', async () => {
  const inserts = [];
  const sb = fakeSupabase({}, inserts);
  const a = await g.aplicarGuardaDeAgenda({ supabase: sb, collaboratorId: 'alf', ritual: 'fechamento', texto: REAL_ALF_3009, hojeYmd: '2026-09-30' });
  assert.doesNotMatch(a.texto, /Jornada/);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].tabela, 'marker_logs');
  assert.equal(inserts[0].row.marker_type, 'RITUAL_AGENDA_GUARD');
  assert.equal(inserts[0].row.result, 'rejected');
  assert.equal(inserts[0].row.collaborator_id, 'alf');
  assert.match(inserts[0].row.reason, /Jornada de Cordas/);
  assert.ok(inserts[0].row.reason.length <= 120);
});

// Integração READ-ONLY com o banco real: a agenda do Alf em 30/09 não tem a Jornada (cancelada).
const temBanco = !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY));
test('banco real (read-only): agenda do Alf em 30/09 não contém a Jornada; o fechamento real perde a linha', { skip: !temBanco }, async () => {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
  const ALF = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
  const ag = await g.carregarAgendaDoDia({ supabase: sb, collaboratorId: ALF, hojeYmd: '2026-09-30' });
  assert.equal(ag.ok, true, ag.erro);
  assert.equal(ag.agenda.some((e) => /Jornada de Cordas/i.test(e.title)), false);
  const { data } = await sb.from('conversation_history').select('content').eq('id', '0b57292b-710f-4e05-b0cb-986af92ae543').maybeSingle();
  if (!data) return; // histórico podado: o teste de texto real acima cobre
  const r = g.filtrarEventosForaDaAgenda(data.content, { agenda: ag.agenda, hojeYmd: '2026-09-30' });
  assert.equal(r.fired, true);
  assert.doesNotMatch(r.texto, /Jornada/);
  // e no dia 07/10 a Jornada remarcada é agenda real
  const ag7 = await g.carregarAgendaDoDia({ supabase: sb, collaboratorId: ALF, hojeYmd: '2026-10-07' });
  assert.equal(ag7.ok, true);
  assert.equal(ag7.agenda.some((e) => /Jornada de Cordas/i.test(e.title)), true);
});

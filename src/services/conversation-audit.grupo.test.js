'use strict';
// Auditoria de GRUPO — defeitos achados na auditoria de 05/10, todos com o episódio REAL do
// grupo "Administrativo e Comercial Barra" (5489691c) em 03/10: Arthur pediu "tom, alunos de
// hoje sem anamnese" às 17:02Z, cobrou "cade" às 17:04Z e o TOM nunca entregou a lista.
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('./conversation-audit');

// Supabase falso em memória: só a parte da cadeia que a auditoria usa. Filtros de verdade
// (eq/like/gte/lt/in), porque o defeito mora justamente em QUAL linha a consulta acha.
function fakeSb(tabelas = {}) {
  const t = (nome) => (tabelas[nome] = tabelas[nome] || []);
  let seq = 0;
  return {
    tabelas,
    from(nome) {
      const filtros = [];
      let op = 'select'; let carga = null; let lim = null; let ord = null;
      const q = {
        select() { return q; },
        eq(c, v) { filtros.push((r) => String(r[c]) === String(v)); return q; },
        like(c, p) {
          const re = new RegExp('^' + p.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
          filtros.push((r) => re.test(String(r[c] == null ? '' : r[c]))); return q;
        },
        gte(c, v) { filtros.push((r) => Date.parse(r[c]) >= Date.parse(v)); return q; },
        lte(c, v) { filtros.push((r) => Date.parse(r[c]) <= Date.parse(v)); return q; },
        lt(c, v) { filtros.push((r) => Date.parse(r[c]) < Date.parse(v)); return q; },
        in(c, vs) { filtros.push((r) => vs.includes(r[c])); return q; },
        order(c, o = {}) { ord = { c, asc: o.ascending !== false }; return q; },
        limit(n) { lim = n; return q; },
        insert(o) { op = 'insert'; carga = o; return q; },
        update(o) { op = 'update'; carga = o; return q; },
        then(ok, ko) {
          let res;
          if (op === 'insert') {
            const linhas = (Array.isArray(carga) ? carga : [carga]).map((o) => ({ id: `id-${++seq}`, created_at: new Date().toISOString(), ...o }));
            t(nome).push(...linhas);
            res = { data: linhas, error: null };
          } else if (op === 'update') {
            const alvo = t(nome).filter((r) => filtros.every((f) => f(r)));
            for (const r of alvo) Object.assign(r, carga);
            res = { data: alvo, error: null };
          } else {
            let d = t(nome).filter((r) => filtros.every((f) => f(r)));
            if (ord) d = d.slice().sort((a, b) => (Date.parse(a[ord.c]) - Date.parse(b[ord.c])) * (ord.asc ? 1 : -1));
            if (lim != null) d = d.slice(0, lim);
            res = { data: d, error: null };
          }
          return Promise.resolve(res).then(ok, ko);
        },
      };
      return q;
    },
  };
}

const BARRA = { id: '5489691c-24e5-4eda-9232-c049a3aaf2db', name: 'Administrativo e Comercial Barra' };
const ARTHUR = { preferred_name: 'Arthur', full_name: 'Arthur' };
// Mensagens REAIS (group_chat_messages, 03/10), ids e carimbos do banco.
const MSGS_0310 = [
  { id: '0f378293-c504-478e-9eb7-6ca4f4ea749a', group_id: BARRA.id, role: 'member', sender: ARTHUR,
    content: 'tom, alunos de hoje sem anamnese', created_at: '2026-10-03T17:02:14.145769+00:00' },
  { id: '9d2c4780-4c3f-43f1-99f5-96b656cb7883', group_id: BARRA.id, role: 'tom',
    content: 'Pauta de hoje já tá no painel — são 14 alunos com aula hoje. Deixa eu confirmar quem ainda falta:\n\n‹‹ACTIONS››[{"kind":"situacao","status":"ok","label":"Situação do aluno (anamnese)"}]',
    created_at: '2026-10-03T17:02:29.259611+00:00' },
  { id: 'fb05b1b2-088e-4617-bcf1-c16630d58067', group_id: BARRA.id, role: 'member', sender: ARTHUR,
    content: 'cade', created_at: '2026-10-03T17:04:07.85392+00:00' },
  { id: '37f7ce87-c3bf-4642-a080-d5d89d8c619e', group_id: BARRA.id, role: 'tom',
    content: 'Pauta de hoje já tá aí no painel — são 14 alunos com aula hoje sem anamnese preenchida. Deixa eu confirmar quem ainda tá pendente:\n\n‹‹ACTIONS››[{"kind":"situacao","status":"ok","label":"Situação do aluno (anamnese)"}]',
    created_at: '2026-10-03T17:04:20.618079+00:00' },
  { id: '5733fab6-1d29-493b-83c1-690e2ec643dc', group_id: BARRA.id, role: 'tom',
    content: '<div><h3>📋 Resumo da sessão</h3><ul><li>TOM avisou que hoje tem 14 alunos com aula sem anamnese preenchida.</li></ul></div>',
    created_at: '2026-10-03T17:12:27.545931+00:00' },
  // Última da janela: é ESTE carimbo (18:30Z) que virava o occurred_at/incident de tudo.
  { id: 'ultima', group_id: BARRA.id, role: 'member', sender: { full_name: 'Krissya' },
    content: 'ok, vou mandar o link da anamnese pros responsáveis', created_at: '2026-10-03T18:30:12.975467+00:00' },
];

// Saídas REAIS do auditor nas duas passadas de 04/10 (achados 4fed6d4f/6cefd77b às 03:06 e
// 330a8708/1724d92d às 03:11 BRT) — a 2ª passada redigiu diferente a MESMA coisa.
const SAIDA_1 = JSON.stringify({ findings: [
  { category: 'dropped_request', severity: 'medio',
    summary: "Arthur pediu a lista de alunos sem anamnese duas vezes e o TOM só repetiu que 'já tá no painel', sem entregar os nomes",
    evidence: 'Pauta de hoje já tá aí no painel — são 14 alunos com aula hoje sem anamnese preenchida. Deixa eu confirmar quem ainda tá pendente:', occurred_at: null },
  { category: 'frustration', severity: 'baixo', summary: "Arthur demonstrou irritação ('cade') após não receber a lista pedida", evidence: 'cade', occurred_at: null },
] });
const SAIDA_2 = JSON.stringify({ findings: [
  { category: 'dropped_request', severity: 'medio',
    summary: "Arthur pediu a lista de alunos sem anamnese duas vezes e o TOM só respondeu 'deixa eu confirmar', sem nunca entregar os nomes",
    evidence: 'Arthur: tom, alunos de hoje sem anamnese\nTOM: Pauta de hoje já tá no painel — são 14 alunos com aula hoje. Deixa eu confirmar quem ainda falta:\n[...]\nArthur: cade\nTOM: Pauta de hoje já tá aí no painel — são 14 alunos com aula hoje sem anamnese preenchida. Deixa eu confirmar quem ainda tá pendente:',
    occurred_at: null },
  { category: 'frustration', severity: 'baixo', summary: "Arthur repetiu a mesma pergunta ('cade') por não receber a lista pedida", evidence: 'Arthur: cade', occurred_at: null },
] });

const ATE_0410 = '2026-10-04T06:06:00.000Z'; // o Dream das 03:06 BRT de 04/10

function chatQueDevolve(...saidas) {
  const chamadas = [];
  const fn = async (system, messages) => { chamadas.push(messages); return { text: saidas[Math.min(chamadas.length - 1, saidas.length - 1)], provider: 'claude' }; };
  fn.chamadas = chamadas;
  return fn;
}

// ── DEFEITO 1: a auditoria do grupo rodava 2× por noite ────────────────────────────────────
test('AUDIT-GRUPO-DUAS-VEZES (04/10): o 2º tick da mesma noite NÃO re-audita o grupo (caso Barra, 4 achados pra 1 episódio)', async () => {
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  const chat = chatQueDevolve(SAIDA_1, SAIDA_2);
  const tick1 = await A.auditarGrupoUmaVezPorDia(sb, chat, BARRA, '2026-10-04', { ateIso: ATE_0410 });
  const tick2 = await A.auditarGrupoUmaVezPorDia(sb, chat, BARRA, '2026-10-04', { ateIso: '2026-10-04T06:11:00.000Z' });
  assert.strictEqual(chat.chamadas.length, 1, 'o LLM só pode ser chamado uma vez por grupo por noite');
  assert.strictEqual(tick1.pulou, false);
  assert.strictEqual(tick2.pulou, true);
  assert.strictEqual(tick2.achados.length, 0);
  assert.strictEqual(sb.tabelas.tom_audit_findings.length, 2, 'os 2 achados da 1ª passada e nenhum da 2ª');
  const mk = sb.tabelas.marker_logs.filter((m) => m.marker_type === 'AUDIT_GROUP');
  assert.strictEqual(mk.length, 1);
  assert.match(mk[0].reason, new RegExp(`^audit_group:${BARRA.id}:2026-10-04 achados=2`));
});

test('AUDIT-GRUPO-DUAS-VEZES: a trava é por GRUPO e por DIA — outro grupo e o dia seguinte rodam', async () => {
  const outro = { id: '11111111-1111-1111-1111-111111111111', name: 'ADM CG' };
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })).concat(MSGS_0310.map((m) => ({ ...m, id: m.id + '-cg', group_id: outro.id }))) });
  const chat = chatQueDevolve('{"findings":[]}');
  await A.auditarGrupoUmaVezPorDia(sb, chat, BARRA, '2026-10-04', { ateIso: ATE_0410 });
  await A.auditarGrupoUmaVezPorDia(sb, chat, outro, '2026-10-04', { ateIso: ATE_0410 });
  await A.auditarGrupoUmaVezPorDia(sb, chat, BARRA, '2026-10-05', { ateIso: ATE_0410 });
  assert.strictEqual(chat.chamadas.length, 3);
});

test('AUDIT-GRUPO-DUAS-VEZES: force re-audita mesmo com a trava do dia', async () => {
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  const chat = chatQueDevolve('{"findings":[]}');
  await A.auditarGrupoUmaVezPorDia(sb, chat, BARRA, '2026-10-04', { ateIso: ATE_0410 });
  const r = await A.auditarGrupoUmaVezPorDia(sb, chat, BARRA, '2026-10-04', { ateIso: ATE_0410, force: true });
  assert.strictEqual(r.pulou, false);
  assert.strictEqual(chat.chamadas.length, 2);
});

test('AUDIT-GRUPO-DUAS-VEZES: grupo do Replay Lab segue fora das métricas (guard de QA lê full_name)', async () => {
  const qa = { id: '22222222-2222-2222-2222-222222222222', name: '[QA] Financeiro Replay' };
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m, group_id: qa.id })) });
  await A.auditarGrupoUmaVezPorDia(sb, chatQueDevolve(SAIDA_1), qa, '2026-10-04', { ateIso: ATE_0410 });
  assert.strictEqual((sb.tabelas.tom_audit_findings || []).length, 0);
});

// ── DEFEITO 2: achado de grupo nascia sem incident_at ──────────────────────────────────────
const iso = (s) => new Date(s).toISOString();

test('AUDIT-GRUPO-SEM-INCIDENT-AT: âncora vem da evidência casada no transcript, não do fim da janela (18:30Z)', async () => {
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  const [drop, frus] = await A.auditGroupConversation(sb, chatQueDevolve(SAIDA_2), BARRA, 24, ATE_0410);
  assert.strictEqual(iso(drop.incident_at), '2026-10-03T17:02:14.145Z', 'o pedido do Arthur, não 18:30');
  assert.strictEqual(drop.incident_confidence, 'high');
  assert.strictEqual(drop.incident_msg_id, '0f378293-c504-478e-9eb7-6ca4f4ea749a');
  assert.strictEqual(iso(drop.occurred_at), '2026-10-03T17:02:14.145Z', 'occurred_at deixa de ser o lastAt');
  assert.strictEqual(frus.incident_msg_id, 'fb05b1b2-088e-4617-bcf1-c16630d58067', '"Arthur: cade" casa a fala dele');
});

test('AUDIT-GRUPO-SEM-INCIDENT-AT: evidência SEM rótulo (1ª passada de 04/10) também ancora; "cade" exige igualdade', async () => {
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  const [drop, frus] = await A.auditGroupConversation(sb, chatQueDevolve(SAIDA_1), BARRA, 24, ATE_0410);
  assert.strictEqual(drop.incident_msg_id, '37f7ce87-c3bf-4642-a080-d5d89d8c619e', 'a 2ª resposta do TOM, citada sem o recibo ‹‹ACTIONS››');
  assert.strictEqual(frus.incident_msg_id, 'fb05b1b2-088e-4617-bcf1-c16630d58067');
  assert.strictEqual(A.resolveGroupIncident(MSGS_0310, 'ca'), null, 'trecho curto não casa por substring');
});

test('AUDIT-GRUPO-SEM-INCIDENT-AT: evidência que não está no transcript fica SEM âncora (nunca fabrica)', async () => {
  const saida = JSON.stringify({ findings: [{ category: 'dropped_request', severity: 'medio', summary: 's', evidence: 'Arthur: manda o boleto do mês', occurred_at: null }] });
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  const [f] = await A.auditGroupConversation(sb, chatQueDevolve(saida), BARRA, 24, ATE_0410);
  assert.strictEqual(f.incident_at, null);
  assert.strictEqual(f.incident_confidence, 'none');
});

test('AUDIT-GRUPO-SEM-INCIDENT-AT: rótulo "TOM:" só casa fala do TOM; rótulo de pessoa só casa fala de membro', () => {
  const rows = [
    { id: 'a', role: 'tom', content: 'cade', created_at: '2026-10-03T17:00:00Z' },
    { id: 'b', role: 'member', content: 'cade', created_at: '2026-10-03T17:01:00Z' },
  ];
  assert.strictEqual(A.resolveGroupIncident(rows, 'Arthur: cade').incident_msg_id, 'b');
  assert.strictEqual(A.resolveGroupIncident(rows, 'TOM: cade').incident_msg_id, 'a');
});

test('DEDUPE DE GRUPO: as duas redações de 04/10 colapsam em 2 achados com 2 ocorrências (não 4)', async () => {
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  await A.auditarGrupoUmaVezPorDia(sb, chatQueDevolve(SAIDA_1), BARRA, '2026-10-04', { ateIso: ATE_0410 });
  await A.auditarGrupoUmaVezPorDia(sb, chatQueDevolve(SAIDA_2), BARRA, '2026-10-04', { ateIso: '2026-10-04T06:11:00.000Z', force: true });
  const linhas = sb.tabelas.tom_audit_findings;
  assert.strictEqual(linhas.length, 2, linhas.map((l) => l.summary).join(' | '));
  assert.deepStrictEqual(linhas.map((l) => l.occurrences || 1).sort(), [2, 2]);
  assert.ok(linhas.every((l) => l.incident_confidence === 'high' && l.incident_at));
});

test('DEDUPE DE GRUPO: incidente de OUTRA troca (>15 min) ou outra categoria é achado novo', async () => {
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  await A.auditarGrupoUmaVezPorDia(sb, chatQueDevolve(SAIDA_2), BARRA, '2026-10-04', { ateIso: ATE_0410 });
  const outra = JSON.stringify({ findings: [{ category: 'dropped_request', severity: 'medio', summary: 'outro', evidence: 'Krissya: ok, vou mandar o link da anamnese pros responsáveis', occurred_at: null }] });
  await A.auditarGrupoUmaVezPorDia(sb, chatQueDevolve(outra), BARRA, '2026-10-04', { ateIso: ATE_0410, force: true });
  assert.strictEqual(sb.tabelas.tom_audit_findings.length, 3);
});

test('SOMBRA: fala de grupo rotulada com NOME conta como fala do usuário (só em achado de grupo)', () => {
  const { extrairFalasDoUsuario } = require('../governance/shadow-reproducibility');
  const ev = JSON.parse(SAIDA_2).findings[0].evidence;
  assert.deepStrictEqual(extrairFalasDoUsuario({ group_id: BARRA.id, evidence: ev }), ['tom, alunos de hoje sem anamnese', 'cade']);
  assert.deepStrictEqual(extrairFalasDoUsuario({ evidence: ev }), [], '1:1 segue exigindo USUÁRIO:/Pessoa:');
  assert.deepStrictEqual(extrairFalasDoUsuario({ group_id: BARRA.id, evidence: 'Maria: paguei o boleto\nSISTEMA: TASK_UPDATE executed\nalguém do grupo: e aí?' }), ['e aí?']);
  assert.deepStrictEqual(extrairFalasDoUsuario({ group_id: BARRA.id, evidence: '[03/10 (sáb) 14:02] Arthur: tom, alunos de hoje sem anamnese' }), ['tom, alunos de hoje sem anamnese']);
});

test('SOMBRA: com o incident_at certo a janela de 15 min acha a fala real do Arthur no banco', async () => {
  const { falasDoIncidente } = require('../governance/shadow-reproducibility');
  const sb = fakeSb({ group_chat_messages: MSGS_0310.map((m) => ({ ...m })) });
  const antes = await falasDoIncidente({ supabase: sb, finding: { group_id: BARRA.id, incident_at: null, occurred_at: '2026-10-03T18:30:12.975467+00:00' } });
  assert.deepStrictEqual(antes, ['ok, vou mandar o link da anamnese pros responsáveis'], 'janela errada: pega outra fala, não a do pedido');
  const [drop] = await A.auditGroupConversation(sb, chatQueDevolve(SAIDA_1), BARRA, 24, ATE_0410);
  const depois = await falasDoIncidente({ supabase: sb, finding: { group_id: BARRA.id, ...drop } });
  assert.deepStrictEqual(depois, ['tom, alunos de hoje sem anamnese', 'cade']);
});

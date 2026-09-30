// src/rituals/personal-recurrentes.test.js — CHECKLISTS-PESSOAIS-PARADOS (30/09/2026).
// dispatchPersonalRecurrentes pedia `personal_checklists.user_id` (e `archived_at`), colunas
// que a tabela nunca teve (é owner_collab_id / is_active). O select falhava em TODA rodada
// desde 11/06 (~1120 linhas em logs/rituals.log) e o cron nunca criou uma completion sequer.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const {
  PERSONAL_RECORRENTES_SELECT,
  planejarRecorrentesPessoais,
  MAX_CRIACOES_POR_RODADA,
} = require("./personal-recurrentes");

const L = (o) => ({ id: o.id || "L1", owner_collab_id: "C1", is_active: true, recurrence_type: "daily",
  days_of_week: null, day_of_month: null, name: "x", ...o });

test("o select usa as colunas REAIS (owner_collab_id, sem user_id/archived_at)", () => {
  assert.match(PERSONAL_RECORRENTES_SELECT, /\bowner_collab_id\b/);
  assert.doesNotMatch(PERSONAL_RECORRENTES_SELECT, /\buser_id\b/);
  assert.doesNotMatch(PERSONAL_RECORRENTES_SELECT, /\barchived_at\b/);
});

test("completion grava user_id = owner_collab_id da lista, na data de HOJE, canal cron", () => {
  const rows = planejarRecorrentesPessoais([L({ id: "A", owner_collab_id: "DONO" })], "2026-09-30");
  assert.deepStrictEqual(rows, [{ checklist_id: "A", user_id: "DONO", reference_date: "2026-09-30", channel: "cron" }]);
});

test("semanal só no dia marcado (1=Dom..7=Sáb); 30/09/2026 é quarta = 4", () => {
  const qua = L({ id: "W1", recurrence_type: "weekly", days_of_week: [2, 4] });
  const sex = L({ id: "W2", recurrence_type: "weekly", days_of_week: [6] });
  assert.deepStrictEqual(planejarRecorrentesPessoais([qua, sex], "2026-09-30").map((r) => r.checklist_id), ["W1"]);
});

test("mensal no dia 31 cai no último dia do mês curto (antes: nunca disparava em setembro)", () => {
  const m31 = L({ id: "M31", recurrence_type: "monthly", day_of_month: 31 });
  const m5 = L({ id: "M5", recurrence_type: "monthly", day_of_month: 5 });
  assert.deepStrictEqual(planejarRecorrentesPessoais([m31, m5], "2026-09-30").map((r) => r.checklist_id), ["M31"]);
  assert.deepStrictEqual(planejarRecorrentesPessoais([m31, m5], "2026-10-05").map((r) => r.checklist_id), ["M5"]);
});

test("lista inativa, sem dono ou de uso único não gera nada", () => {
  const rows = planejarRecorrentesPessoais([
    L({ id: "I", is_active: false }), L({ id: "N", owner_collab_id: null }), L({ id: "O", recurrence_type: "once" }),
  ], "2026-09-30");
  assert.deepStrictEqual(rows, []);
});

test("sem backfill: 3,5 meses parado NÃO vira fila de dias atrasados — só a data de hoje, 1 por lista", () => {
  const lists = [L({ id: "D1" }), L({ id: "D2" }), L({ id: "D1" })]; // id repetido não duplica
  const rows = planejarRecorrentesPessoais(lists, "2026-09-30");
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.reference_date === "2026-09-30"));
});

test("já existe completion de hoje (PWA/WhatsApp ou rodada anterior) → não recria", () => {
  const rows = planejarRecorrentesPessoais([L({ id: "A" }), L({ id: "B" })], "2026-09-30", { jaExistem: new Set(["A"]) });
  assert.deepStrictEqual(rows.map((r) => r.checklist_id), ["B"]);
});

test("data inválida não gera nada (nunca chuta data)", () => {
  assert.deepStrictEqual(planejarRecorrentesPessoais([L({})], "30/09/2026"), []);
  assert.deepStrictEqual(planejarRecorrentesPessoais([L({})], undefined), []);
});

test("teto de segurança por rodada existe e é pequeno", () => {
  assert.ok(Number.isInteger(MAX_CRIACOES_POR_RODADA) && MAX_CRIACOES_POR_RODADA > 0 && MAX_CRIACOES_POR_RODADA <= 200);
  const muitas = Array.from({ length: MAX_CRIACOES_POR_RODADA + 30 }, (_, i) => L({ id: "X" + i }));
  assert.strictEqual(planejarRecorrentesPessoais(muitas, "2026-09-30").length, MAX_CRIACOES_POR_RODADA);
});

// Contrato com o banco REAL (só leitura): o mesmo select do cron tem que passar no schema de hoje.
// Foi exatamente isto que quebrou calado por 3,5 meses.
test("schema real: o select do cron roda sem erro (read-only)", { skip: !process.env.SUPABASE_URL && "sem .env" }, async () => {
  const supabase = require("../supabase/client");
  const { error } = await supabase.from("personal_checklists").select(PERSONAL_RECORRENTES_SELECT).limit(1);
  assert.strictEqual(error, null, error && error.message);
});

// Decisão (30/09): lista recorrente SEM ITENS não gera completion — só viraria dia "0/0" no
// histórico. Ela aparece no log numa linha só, com a contagem (sem nome de ninguém).
const { planejarRecorrentesPessoaisDetalhado, linhaPuladasSemItens } = require("./personal-recurrentes");

test("lista ativa recorrente com 0 itens não gera completion e é contada como pulada", () => {
  const comItens = L({ id: "C", personal_checklist_items: [{ id: "i1" }] });
  const vazia = L({ id: "V", personal_checklist_items: [] });
  const r = planejarRecorrentesPessoaisDetalhado([comItens, vazia], "2026-09-30");
  assert.deepStrictEqual(r.rows.map((x) => x.checklist_id), ["C"]);
  assert.strictEqual(r.puladasSemItens, 1);
  assert.deepStrictEqual(planejarRecorrentesPessoais([comItens, vazia], "2026-09-30").map((x) => x.checklist_id), ["C"]);
});

test("vazia que nem vale hoje (semanal de outro dia) não conta como pulada", () => {
  const r = planejarRecorrentesPessoaisDetalhado(
    [L({ id: "S", recurrence_type: "weekly", days_of_week: [6], personal_checklist_items: [] })], "2026-09-30");
  assert.deepStrictEqual(r, { rows: [], puladasSemItens: 0 });
});

test("linha de log das puladas: 1 linha resumida só com a contagem; nada quando 0", () => {
  assert.strictEqual(linhaPuladasSemItens(0), null);
  const l = linhaPuladasSemItens(3);
  assert.strictEqual(l.split("\n").length, 1);
  assert.match(l, /^\[Rituals\] dispatchPersonalRecurrentes pulou 3 listas? sem itens/);
  assert.doesNotMatch(l, /\d{8,}/); // nada com cara de telefone
});

test("o select traz os itens pra saber se a lista está vazia", () => {
  assert.match(PERSONAL_RECORRENTES_SELECT, /personal_checklist_items\s*\(/);
});

// src/rituals/ritual-log-erros-banco.test.js — CHECKLISTS-PESSOAIS-PARADOS (30/09/2026).
// O cron das listas pessoais falhou ~1120 vezes em 3,5 meses com "column ... does not exist" e o
// laudo das 07h nunca viu: recurring_errors só lê tom-error.log (processo do TOM); o dispatcher
// roda por CRON e escreve em logs/rituals.log, que não tem timestamp por linha — só o marcador
// "[Dispatcher] now=YYYY-MM-DD HH:MM" (BRT) no começo de cada rodada.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { contarErrosDeBancoNoRitualLog } = require("./ritual-log-erros-banco");
const { formatarErrosDeBancoRituais } = require("./health-check-format");

// 30/09/2026 06:00 BRT = 09:00 UTC
const AGORA = Date.parse("2026-09-30T09:00:00Z");
const ERRO = "[Rituals] dispatchPersonalRecurrentes erro select: column personal_checklists.user_id does not exist";

test("conta erro de schema nas rodadas das últimas 24h, pela hora do marcador do dispatcher", () => {
  const linhas = [
    "[Dispatcher] now=2026-09-28 00:30 dow=2", ERRO,            // > 24h: fora
    "[Dispatcher] now=2026-09-30 00:30 dow=4", "[Sentinel] probe=ok", ERRO,
    "[Dispatcher] now=2026-09-30 00:35 dow=4", ERRO,
    "[Dispatcher] now=2026-09-30 00:40 dow=4", "[Rituals] tudo certo",
  ];
  assert.deepStrictEqual(contarErrosDeBancoNoRitualLog(linhas, AGORA), [[ERRO, 2]]);
});

test("pega as outras caras de erro de banco (tabela/função/coluna/RLS/constraint)", () => {
  const linhas = [
    "[Dispatcher] now=2026-09-30 01:00 dow=4",
    "[X] erro: relation \"public.foo\" does not exist",
    "[Y] erro: Could not find the \x27bar\x27 column of \x27baz\x27 in the schema cache",
    "[Z] erro: permission denied for table qux",
    "[W] erro: new row for relation \"t\" violates check constraint \"t_chk\"",
    "[V] erro: function public.fn(uuid) does not exist",
  ];
  assert.strictEqual(contarErrosDeBancoNoRitualLog(linhas, AGORA).length, 5);
});

test("linhas antes do primeiro marcador (hora desconhecida) e erro que não é de banco não contam", () => {
  const linhas = [ERRO, "[Dispatcher] now=2026-09-30 02:00 dow=4", "[Sentinel] erro: timeout 30000ms"];
  assert.deepStrictEqual(contarErrosDeBancoNoRitualLog(linhas, AGORA), []);
});

test("uuid e número viram placeholder pra agrupar o mesmo erro de listas diferentes", () => {
  const linhas = [
    "[Dispatcher] now=2026-09-30 03:00 dow=4",
    "[Rituals] erro insert pcc list=6f1c2a9e-1111-4222-8333-944455556666: column \"x\" of relation \"y\" does not exist",
    "[Rituals] erro insert pcc list=0a0b0c0d-1111-4222-8333-944455556666: column \"x\" of relation \"y\" does not exist",
  ];
  const r = contarErrosDeBancoNoRitualLog(linhas, AGORA);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0][1], 2);
  assert.match(r[0][0], /list=<uuid>/);
});

test("entrada torta não quebra", () => {
  assert.deepStrictEqual(contarErrosDeBancoNoRitualLog(null, AGORA), []);
  assert.deepStrictEqual(contarErrosDeBancoNoRitualLog(["[Dispatcher] now=lixo", ERRO], AGORA), []);
});

test("texto do laudo: título em negrito na 1ª linha e um item por linha com •", () => {
  assert.strictEqual(formatarErrosDeBancoRituais([]).status, "ok");
  const r = formatarErrosDeBancoRituais([[ERRO, 9]]);
  assert.strictEqual(r.status, "warning");
  const [titulo, ...itens] = r.detail.split("\n");
  assert.match(titulo, /^\S+ \*Erros de banco nos rituais \(24h\)\*$/);
  assert.ok(itens.length >= 1 && itens.every((l) => l.startsWith("• ")));
  assert.match(itens[0], /^• 9× .*personal_checklists\.user_id/);
});

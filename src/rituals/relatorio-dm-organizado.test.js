'use strict';
// relatorio-dm-organizado.test.js — o relatório das 07h na DM do Alf vem ORGANIZADO (Alf, 30/09).
// "Tenho recebido na minha DM um relatório, mas está vindo bagunçado." Cada check colava o seu
// texto corrido: itens separados por ";" e "|", cortes no meio da palavra ("prendendo a p",
// "Usuário confirmo"), "*—*" no lugar do grupo, e o título do bloco misturado com os itens.
// Regra da casa (28/09): fala no WhatsApp = título → resumo → seções → itens, sempre.
const { test } = require('node:test');
const assert = require('node:assert');
const { cortarNaPalavra } = require('../lib/texto-curto');
const { formatConvQuality } = require('./conv-quality-format');
const { formatarRegressoes } = require('../lib/regressao-format');
const { resumirLicoesPendentes, formatarErrosRecorrentes } = require('./health-check-format');
const { formatHealthReport } = require('../lib/relatorio-saude');

test('cortarNaPalavra: corta no fim de uma palavra e marca com "…"', () => {
  assert.strictEqual(cortarNaPalavra('curto', 20), 'curto');
  assert.strictEqual(cortarNaPalavra('o TOM voltou a perguntar antes de executar, prendendo a pessoa', 50), 'o TOM voltou a perguntar antes de executar,…');
  assert.strictEqual(cortarNaPalavra('Usuário confirmou a recriação', 16), 'Usuário…');
  assert.strictEqual(cortarNaPalavra(null, 10), '');
});

const F = (o) => ({ id: o.id || 'x', category: 'dropped_request', severity: 'medio', summary: 'resumo', occurrences: 1, collaborator_id: null, auto_triage: null, ...o });
test('conversas: título em negrito, pessoa com 👤, grupo com 👥 (nunca "*—*"), item "• 🟠 Pedido largado —"', () => {
  const r = formatConvQuality([
    F({ id: 'a', collaborator_id: 'k', collaborators: { full_name: 'Krissya Souza' }, severity: 'alto', summary: 'Loop de não travou' }),
    F({ id: 'b', grupo_nome: 'Administrativo e Comercial Barra', summary: 'Lembrete das 15h não saiu' }),
  ]);
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /^🗣️ \*Conversas: 2 falhas pra revisar\*/);
  assert.match(r.detail, /\n\n👤 \*Krissya\* \(1\)\n• 🔴 Pedido largado — Loop de não travou/);
  assert.match(r.detail, /\n\n👥 \*Administrativo e Comercial Barra\* \(1\)\n• 🟠 Pedido largado — Lembrete das 15h não saiu/);
  assert.ok(!/\*—\*/.test(r.detail));
});
test('conversas: resumo longo corta na palavra; regressão em bloco próprio', () => {
  const longo = 'Usuário confirmou o envio pra Krissya duas vezes e o TOM voltou a perguntar Confirma antes de executar, prendendo a pessoa num laço de confirmação que não acabava nunca mais';
  const r = formatConvQuality([F({ id: 'r', collaborator_id: 'k', collaborators: { full_name: 'Kailane' }, summary: longo, auto_triage: { decision: 'regression', matched_code: 'CONFIRM-REASK-SUPERSEDE' } })]);
  assert.ok(!/prendendo a p(?!e)/.test(r.detail), r.detail);
  assert.ok(/…/.test(r.detail));
});

test('sinais de KI: um por linha, com o título separado', () => {
  const r = formatarRegressoes([
    { codigo: 'DUPGUARD-SERIE', sinal_padrao: '%self_recent_skip%', ocorrencias_novas: 2, afetados: ['Krissya'], corrigido_em: '2026-09-10T12:00:00Z' },
    { codigo: 'B1', sinal_padrao: '%EVENT_UPDATE%schema_invalid%', ocorrencias_novas: 2, afetados: ['Quintela'], corrigido_em: '2026-05-29T12:00:00Z' },
  ]);
  const linhas = r.detail.split('\n');
  assert.match(linhas[0], /^🔁 \*2 sinais de KI corrigido dispararam nas últimas 24h\*/);
  assert.match(linhas[1], /CONFIRME o turno antes de tratar como regressão/);
  assert.match(r.detail, /\n• `%self_recent_skip%` disparou 2× · Krissya — DUPGUARD-SERIE \(corrigido 10\/09\)/);
  assert.ok(!/; /.test(r.detail), 'nada de itens colados por ";"');
});

test('erros repetidos: título e um erro por linha, cortado na palavra', () => {
  const r = formatarErrosRecorrentes([['[Realtime] canal instável: queda transitória, reconectando agora mesmo sem perder nada', 11]]);
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /^⚙️ \*Erros repetidos no log \(24h\)\*\n• 11× \[Realtime\] canal instável/);
  assert.strictEqual(formatarErrosRecorrentes([]).status, 'ok');
});

test('memórias esperando: uma por linha, o resto e o caminho na última', () => {
  const r = resumirLicoesPendentes([
    { conteudo: 'Lucas (estagiário) tem grade fixa no Campo Grande', grupo: 'ADM CG', dia: '2026-09-28', tipo: 'fact' },
    { conteudo: 'O auditor só lê a conversa', grupo: 'LA ORGANIZER - TOM', dia: '2026-09-29', tipo: 'lesson' },
  ], 6);
  assert.match(r.detail, /^⛔ \*6 memórias esperando seu ok\*\n• “Lucas \(estagiário\) tem grade fixa no Campo Grande” — ADM CG, 28\/09\n• “O auditor só lê a conversa” — LA ORGANIZER - TOM, 29\/09\n• \(\+4\) — a lista inteira/);
});

const RUN = {
  summary: { ok: 21, error: 0, fixed: 0, total: 25, warning: 4 },
  checks: [
    { name: 'recurring_errors', status: 'warning', detail: '⚙️ *Erros repetidos no log (24h)*\n• 11× x' },
    { name: 'known_issues_regression', status: 'warning', detail: '🔁 *4 sinais*\n• y' },
    { name: 'conversation_quality', status: 'warning', detail: '🗣️ *Conversas: 8 falhas pra revisar*\n• z' },
    { name: 'licoes_pendentes', status: 'warning', detail: '⛔ *6 memórias esperando seu ok*\n• w' },
    { name: 'git_paridade', status: 'ok', detail: 'ok' },
  ],
};
test('relatório: placar logo abaixo do título, blocos separados por linha em branco, conversas primeiro', () => {
  const t = formatHealthReport(RUN, '', { hojeBr: '30/09' });
  assert.match(t, /^🔍 \*Auditoria TOM — 30\/09\*\n✅ 21 de 25 checks OK · ⚠️ 4 alertas\n\n🗣️ \*Conversas/);
  const ordem = ['🗣️', '⛔', '🔁', '⚙️'].map((e) => t.indexOf(`\n\n${e} *`));
  assert.ok(ordem.every((i) => i > 0), t);
  assert.deepStrictEqual([...ordem].sort((a, b) => a - b), ordem);
  assert.match(t, /\n\n_Nenhum alerta exige ação obrigatória\._$/);
});
test('relatório: tudo verde continua curto', () => {
  const t = formatHealthReport({ summary: { ok: 25, error: 0, fixed: 0, total: 25, warning: 0 }, checks: [] }, '', { hojeBr: '30/09' });
  assert.strictEqual(t, '🔍 *Auditoria TOM — 30/09*\n✅ Sistema saudável — 25 de 25 checks OK');
});
test('relatório: erro vem na frente e o rodapé pede atenção', () => {
  const t = formatHealthReport({ summary: { ok: 20, error: 1, fixed: 0, total: 22, warning: 1 }, checks: [
    { name: 'recurring_errors', status: 'warning', detail: '⚙️ *Erros*\n• a' },
    { name: 'provider_health', status: 'error', detail: 'Claude fora do ar' },
  ] }, '', { hojeBr: '30/09' });
  assert.match(t, /✅ 20 de 22 checks OK · 🔴 1 erro · ⚠️ 1 alerta\n\n🔴 Claude fora do ar\n\n⚙️/);
  assert.match(t, /_Precisa de atenção: 1 check com erro\._$/);
});

'use strict';
// GOVAGENT-SEM-FALLBACK (13/08) — o canal de engenharia não tinha rede.
//
// Em 11 e 12/08 a cota semanal do Opus estourou: 62 e 33 quedas do TOM conversacional para o
// Codex. O TOM tinha rede; o `ops-agent` (canal de ops E agente de governança) não — ele spawna
// `claude --model claude-opus-5` e pronto. O ciclo das 08:00 dos dois dias só sobreviveu porque
// a cota caiu à noite. Se tivesse caído de manhã, morria e ninguém assumia.

const test = require('node:test');
const assert = require('node:assert');
const { deveTentarFallback, argsCodex, stdinCodex, selarModelo, MODELO_PADRAO } = require('./ops-fallback');

// ── QUANDO VALE GASTAR A SEGUNDA RODADA ──────────────────────────────────────────────────────
// Só falta de capacidade. Erro de USO repetiria igual no outro provedor e queimaria tempo e
// dinheiro por nada — o ciclo já leva minutos.
test('cota estourada e hang justificam o fallback', () => {
  assert.equal(deveTentarFallback({ kind: 'exit_rate_limit' }), true);
  assert.equal(deveTentarFallback({ kind: 'timeout' }), true);
  assert.equal(deveTentarFallback({ kind: 'exit_overloaded' }), true);
});

test('erro de uso NÃO justifica — repetiria igual no Codex', () => {
  for (const kind of ['exit_invalid_arg', 'exit_auth', 'exit_generic', 'ok', '']) {
    assert.equal(deveTentarFallback({ kind }), false, `kind=${kind} não devia cair pro fallback`);
  }
  assert.equal(deveTentarFallback(null), false);
  assert.equal(deveTentarFallback(undefined), false);
});

// ── OS ARGS ──────────────────────────────────────────────────────────────────────────────────
// "GPT-5.6 Sol High" = modelo `gpt-5.6-sol` + effort `high`. O nome `gpt-5.6-sol-high` devolve
// 400 (testado na VPS nas duas versões do CLI) — o "high" é o esforço, não parte do modelo.
test('o modelo é gpt-5.6-sol e o "high" vai no reasoning effort', () => {
  const a = argsCodex({ arquivoSaida: '/tmp/x' });
  assert.equal(a[a.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.ok(a.includes('-c'));
  assert.ok(a.some((x) => x === 'model_reasoning_effort=high'));
  assert.ok(!a.some((x) => String(x).includes('sol-high')), 'gpt-5.6-sol-high é 400');
});

// O prompt NUNCA vai por argv: o briefing da governança tem ~15KB e argv estoura o ARG_MAX,
// deixando o Codex preso em "Reading additional input from stdin" até o timeout (Sprint 27).
test('o prompt vai por stdin, nunca em argv', () => {
  const a = argsCodex({ arquivoSaida: '/tmp/x' });
  assert.equal(a[a.length - 1], '-', 'o último arg tem que ser o "-" que lê stdin');
  assert.ok(!a.some((x) => String(x).length > 200), 'nenhum arg pode carregar prompt');
});

test('sandbox é workspace-write — o ciclo precisa escrever teste e correção', () => {
  const a = argsCodex({ arquivoSaida: '/tmp/x' });
  assert.equal(a[a.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(!a.some((x) => String(x).includes('dangerously')), 'nunca sem sandbox');
});

// Sem -o, a resposta teria que ser recortada do stdout, que vem com telemetria ("tokens used",
// contadores) no meio — e um relatório de governança cortado errado é pior que nenhum.
test('a saída final sai por arquivo, não por recorte de stdout', () => {
  const a = argsCodex({ arquivoSaida: '/tmp/ops-123.txt' });
  assert.equal(a[a.indexOf('-o') + 1], '/tmp/ops-123.txt');
});

test('roda com o cwd no repositório', () => {
  const a = argsCodex({ repo: '/opt/LA-Organizer', arquivoSaida: '/tmp/x' });
  assert.equal(a[a.indexOf('-C') + 1], '/opt/LA-Organizer');
});

test('modelo e effort são configuráveis sem mexer no código', () => {
  const a = argsCodex({ modelo: 'gpt-9', effort: 'low', arquivoSaida: '/tmp/x' });
  assert.equal(a[a.indexOf('--model') + 1], 'gpt-9');
  assert.ok(a.includes('model_reasoning_effort=low'));
});

// ── O STDIN ──────────────────────────────────────────────────────────────────────────────────
// O Codex não tem --append-system-prompt: o briefing vira cabeçalho do próprio prompt. Sem ele,
// o ciclo rodaria SEM o protocolo — as etapas, os limites e a proibição de furar o freeze.
test('briefing entra antes do pedido, separado', () => {
  const s = stdinCodex('PROTOCOLO: refute antes de corrigir', 'Rode o ciclo de hoje');
  assert.ok(s.indexOf('PROTOCOLO') < s.indexOf('Rode o ciclo'));
  assert.match(s, /---/);
});

test('sem briefing manda só o pedido, sem separador órfão', () => {
  assert.equal(stdinCodex('', 'só o pedido'), 'só o pedido');
  assert.equal(stdinCodex(null, 'só o pedido'), 'só o pedido');
});

// ── A MARCA DO MOTOR ─────────────────────────────────────────────────────────────────────────
// Um ciclo do GPT chegando ao grupo com a mesma cara de um ciclo do Opus faz o Alf e o Hugo
// aplicarem a régua de confiança errada. Sob fallback o primeiro ciclo é suspeito por padrão.
test('o relatório diz em que motor rodou', () => {
  const s = selarModelo('Fechei 3 achados.', MODELO_PADRAO);
  assert.match(s, /Fechei 3 achados\./);
  assert.match(s, /gpt-5\.6-sol/);
  assert.match(s, /fora de cota/);
});

test('texto vazio não vira selo órfão', () => {
  assert.equal(selarModelo('', MODELO_PADRAO), '');
  assert.equal(selarModelo(null, MODELO_PADRAO), '');
});

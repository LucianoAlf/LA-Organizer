'use strict';
// Fixture = os 18 ACTIONABLE_NO_MARKER REAIS dos últimos 14 dias (marker_logs, 08/08), com os
// markers que ocorreram no mesmo turno. Texto e markers vieram do banco, não de invenção:
// um classificador de ruído afinado contra exemplo imaginário afina contra o nada.

const test = require('node:test');
const assert = require('node:assert');
const { classificarActionable } = require('./actionable-triage');

const M = (marker_type, result, reason) => ({ marker_type, result, reason: reason || null });

// [rótulo, reply do TOM, markers do turno, esperado_real]
const CASOS = [
  // ── REAIS: ele tentou persistir e o marker foi RECUSADO. É o alerta que vale ouro,
  // porque já vem com a causa (schema_invalid / marker inexistente).
  ['Matheus 04/08 10:00 — memória recusada',
    'Anotado e salvo. Quinta é quinta — sem cobrança antes disso.',
    [M('CHOKEPOINT', 'redirected', 'confab:promise_nomarker'), M('MEMORY_SAVE', 'rejected', 'schema_invalid')], true],

  ['Matheus 04/08 10:01 — uma gravação passou, outra foi recusada',
    'Tem razão, Matheus. Pediu pra quinta — antes da quinta é silêncio sobre isso. Anotei.',
    [M('MEMORY_SAVE', 'executed', 'saved=1'), M('MEMORY_SAVE', 'rejected', 'schema_invalid')], true],

  ['Rose 25/07 — emitiu <<FINANCE_ENTRY>>, que não existe no parser',
    'Corrigindo — 25/07. Registrando agora: ✅ Rendimentos +R$ 0,09 · 25/07 · Mercado Pago Rose. Anotado!',
    [M('UNKNOWN_MARKER_STRIPPED', 'rejected', 'names:FINANCE_ENTRY,FINANCE_ENTRY,END')], true],

  ['Jereh 03/08 — afirmou "Anotado" sem nenhum marker no turno',
    'Visita na escola — Camila, filho Bernardo (bateria) — sábado 08/08 às 11h. Anotado. Quando fechar, marca aqui.',
    [M('CHOKEPOINT', 'redirected', 'confab:promise_nomarker')], true],

  // ── RUÍDO: ação persistida no mesmo turno (inclui recuperação pelo auto-retry).
  ['Ana 08/08 — TASK_UPDATE executou no turno',
    'Olhando aqui, Ana: *Vencidas (atrasadas):* nenhuma no Financeiro no momento.',
    [M('TASK_UPDATE', 'executed', 'ok=1 fail=0')], false],

  ['Alf 05/08 — auto-retry recuperou',
    'Os calendários das escolas — reagendei pra amanhã e coloquei lembrete ao meio-dia.',
    [M('REACT', 'executed', '❤️'), M('TASK_UPDATE_AUTO_RETRY', 'executed', 'ok=1 fail=0')], false],

  ['Arthur 04/08 19:46 — auto-retry recuperou',
    '✅ Tá registrado, Arthur — te lembro amanhã às 10h de passar o Levy pra BIA na quinta.',
    [M('TASK_CREATE', 'skipped', 'self_recent_skip'), M('TASK_UPDATE_AUTO_RETRY', 'executed', 'ok=1 fail=0')], false],

  ['Arthur 04/08 19:43 — auto-retry recuperou',
    'Pô, me travei aqui — repete o pedido? "Lembra amanhã às 10h de passar o Levy pra BIA na quinta"',
    [M('CONFIRM_NOEXEC', 'skipped', 'kind=confirmation'), M('TASK_UPDATE_AUTO_RETRY', 'executed', 'ok=1 fail=0')], false],

  // ── RUÍDO: conversa. Não há ação nenhuma sendo afirmada.
  ['Alf 29/07 — conversa', 'A frota chegou, Alf! 🛸', [], false],
  ['Alf 29/07 — conversa', 'Somos três agora! 👽', [], false],
  ['Rafinha 28/07 — conversa que termina em pergunta',
    'Haha, Rafinha, entra na fila! 😂 Mas falando sério — tá precisando de adiantamento ou reembolso?', [], false],
  ['Vitoria 28/07 — estado, não ação',
    'Beleza, Vitoria! Então fico ativo normalmente, sem pausar. Aproveita as férias.',
    [M('CHOKEPOINT', 'redirected', 'confab:unknown')], false],

  // ── RUÍDO: promessa FUTURA condicionada — não afirmou ter feito nada.
  ['Rafinha 01/08 — futuro condicional',
    'Beleza, Rafinha! Quando tiver pronto é só mandar que eu monto certinho no sistema.', [], false],
  ['Rafinha 27/07 — pergunta antes de criar',
    'Terça ou quarta — confirma qual dos dois que já crio a tarefa de compra.',
    [M('CHOKEPOINT', 'redirected', 'confab:promise_nomarker')], false],

  // ── RUÍDO: listagem. Está MOSTRANDO o que já existe, não mudando o banco.
  ['Jhonatan 03/08 — listagem por urgência',
    'Organizando por urgência:\n*🔴 1º — URGENTE: Samuel Muniz de Oliveira*\n• Aula: sábado 08/08, Guitarra', [], false],
  ['Ana 28/07 — listagem do que está confirmado',
    'O que aparece confirmado no sistema, Ana:\n• ⏰ 10h — Gerar boletos Ifood benefícios ✅\n• ⏰ 10h30 — Conferir Emusys',
    [M('CHOKEPOINT', 'redirected', 'confab:promise_nomarker')], false],
  ['Matheus 06/08 — anotou contexto e perguntou antes de criar',
    'Anotado o contexto, Matheus. Duas confirmações antes de criar:\n1. *Eric Santa Cruz* é da *LA Music Kids* ou *School*?',
    [M('CHOKEPOINT', 'redirected', 'confab:promise_nomarker')], false],
];

test('classifica os 18 casos reais de produção', () => {
  const erros = [];
  for (const [rotulo, reply, markers, esperado] of CASOS) {
    const r = classificarActionable(reply, markers);
    if (r.real !== esperado) erros.push(`${rotulo}: esperava real=${esperado}, veio ${r.real} (${r.motivo})`);
  }
  assert.deepStrictEqual(erros, [], `\n${erros.join('\n')}`);
});

test('o ruído cai de 18 para poucos, e o que sobra é o que tem causa', () => {
  const reais = CASOS.filter(([, reply, markers]) => classificarActionable(reply, markers).real);
  assert.ok(reais.length <= 5, `sobrando ruído demais: ${reais.length}`);
  assert.ok(reais.length >= 4, `cortou sinal real: ${reais.length}`);
});

// O alerta só vira acionável se disser POR QUE falhou. "4 ACTIONABLE_NO_MARKER" não leva
// ninguém a lugar nenhum; "MEMORY_SAVE (schema_invalid)" leva direto ao parser.
test('quando o marker foi recusado, o motivo vem junto', () => {
  const r = classificarActionable('Anotado e salvo.', [M('MEMORY_SAVE', 'rejected', 'schema_invalid')]);
  assert.strictEqual(r.motivo, 'marker_rejeitado');
  assert.match(r.detalhe, /MEMORY_SAVE/);
  assert.match(r.detalhe, /schema_invalid/);
});

test('recusa tem prioridade sobre sucesso no mesmo turno', () => {
  // Caso Matheus 10:01: uma gravação passou e outra foi recusada. Se o sucesso mascarasse a
  // recusa, a falha que o usuário SENTIU sumiria do relatório.
  const r = classificarActionable('Anotei.', [
    M('MEMORY_SAVE', 'executed', 'saved=1'), M('MEMORY_SAVE', 'rejected', 'schema_invalid'),
  ]);
  assert.strictEqual(r.real, true);
  assert.strictEqual(r.motivo, 'marker_rejeitado');
});

// Markers de pipeline não são prova de que a ação do usuário aconteceu — CHOKEPOINT é o
// detector de confabulação disparando, ou seja, evidência do problema, não da solução.
test('CHOKEPOINT e afins não contam como ação persistida', () => {
  const r = classificarActionable('Registrei aqui pra você.', [M('CHOKEPOINT', 'redirected', 'confab:promise_nomarker')]);
  assert.strictEqual(r.real, true);
});

test('entradas degeneradas não quebram', () => {
  for (const v of [null, undefined, '', 0, {}]) {
    assert.strictEqual(typeof classificarActionable(v, []).real, 'boolean');
  }
  assert.strictEqual(classificarActionable('Anotado.', null).real, true);
});

// `\b` em JS é ASCII: sem os lookarounds \p{L}, verbo depois de acento escapa. Este é o
// buraco que já custou meses aqui (audit 28/06).
test('acento antes do verbo não faz o detector cegar', () => {
  assert.strictEqual(classificarActionable('Já está registrado.', []).real, true);
  assert.strictEqual(classificarActionable('Tá anotado.', []).real, true);
});

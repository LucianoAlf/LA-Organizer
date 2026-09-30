'use strict';
// DECISAO-PRAZO-ALVO (30/09) — o gestor responde "aprovar até DD/MM" / "negar" a um pedido de mais
// prazo e o engine (TASK_UPDATE extension_decision) precisa achar a tarefa pelo short id.
//
// Antes: busca GLOBAL em tasks (sem filtro de pessoa), só prazo dos últimos 60 dias, limit 500,
// sem ordem, e pegava o 1º match. Três defeitos:
//  1. pedido de prazo é justamente de tarefa VENCIDA — vencida há > 60 dias sumia (mesma raiz do
//     caso Peterson, bf173ead). Ex. real: c6b6878d "Preencher o LA Educa", pendente, prazo 20/07.
//  2. 4.243 tarefas elegíveis em 30/09 e o banco devolvia 500 quaisquer (12%) — achar ou não era sorte.
//  3. prefixo ambíguo pegava o 1º que viesse, sem perguntar.
// Agora: o alvo sai dos PEDIDOS de prazo endereçados a quem decide (notifications
// deadline_extension_request — é de lá que o [id=…] mostrado ao gestor vem), sem janela de data;
// prefixo que cai em 2+ tarefas → pergunta.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolverAlvoDecisaoPrazo } = require('./decisao-prazo-alvo');

const LA_EDUCA = 'c6b6878d-a837-42a6-ad3c-8213245e2f55'; // real, pendente, prazo 20/07/2026
// dois ids REAIS de tarefas abertas que dividem o prefixo de 4 hex "8c08"
const CORREIA = '8c085038-ba37-4c6b-9466-79f1d8bb2628';
const REPORT = '8c08a16b-5412-48d7-b28f-29a292c975d6';

const n = (id, reference_id, status, created_at) => ({ id, reference_id, status, created_at });

test('tarefa vencida há > 60 dias com pedido pendente → resolve (sem janela de data)', () => {
  const r = resolverAlvoDecisaoPrazo([n('n1', LA_EDUCA, 'sent', '2026-09-30T12:00:00Z')], 'c6b6878d');
  assert.deepStrictEqual(r, { status: 'ok', taskId: LA_EDUCA, notifId: 'n1', pendente: true });
});

test('uuid com cauda alucinada casa pelo head de 8 (tolerância do matchRowsByShortId)', () => {
  const r = resolverAlvoDecisaoPrazo([n('n1', LA_EDUCA, 'sent')], 'c6b6878d-0000-4000-8000-000000000000');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.taskId, LA_EDUCA);
});

test('prefixo que cai em 2 tarefas distintas → ambiguo (pergunta, não age)', () => {
  const r = resolverAlvoDecisaoPrazo([n('n1', CORREIA, 'sent'), n('n2', REPORT, 'sent')], '8c08');
  assert.strictEqual(r.status, 'ambiguo');
  assert.deepStrictEqual(r.taskIds.sort(), [CORREIA, REPORT].sort());
  // prefixo maior desempata
  assert.strictEqual(resolverAlvoDecisaoPrazo([n('n1', CORREIA, 'sent'), n('n2', REPORT, 'sent')], '8c085038').taskId, CORREIA);
});

test('2 pedidos pra MESMA tarefa não são ambiguidade — usa o mais recente', () => {
  const r = resolverAlvoDecisaoPrazo([
    n('novo', LA_EDUCA, 'sent', '2026-09-30T12:00:00Z'),
    n('velho', LA_EDUCA, 'sent', '2026-09-20T12:00:00Z'),
  ], 'c6b6878d');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.notifId, 'novo');
});

test('pendente tem prioridade: prefixo ambíguo só entre decididos não atrapalha o pendente', () => {
  const r = resolverAlvoDecisaoPrazo([n('p', CORREIA, 'sent'), n('lida', REPORT, 'read')], '8c08');
  assert.deepStrictEqual(r, { status: 'ok', taskId: CORREIA, notifId: 'p', pendente: true });
});

test('sem pedido pendente mas já decidido antes → resolve (correção "na verdade aprova até…")', () => {
  const r = resolverAlvoDecisaoPrazo([n('lida', LA_EDUCA, 'read')], 'c6b6878d');
  assert.deepStrictEqual(r, { status: 'ok', taskId: LA_EDUCA, notifId: 'lida', pendente: false });
});

test('tarefa sem pedido de prazo pra quem decide → nao_achou (não decide tarefa alheia)', () => {
  assert.deepStrictEqual(resolverAlvoDecisaoPrazo([n('n1', CORREIA, 'sent')], 'c6b6878d'), { status: 'nao_achou' });
  assert.deepStrictEqual(resolverAlvoDecisaoPrazo([], 'c6b6878d'), { status: 'nao_achou' });
  assert.deepStrictEqual(resolverAlvoDecisaoPrazo(null, 'c6b6878d'), { status: 'nao_achou' });
  assert.deepStrictEqual(resolverAlvoDecisaoPrazo([n('n1', LA_EDUCA, 'sent')], ''), { status: 'nao_achou' });
});

// ── contrato de fonte do engine ────────────────────────────────────────────────────────────
const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
function ramoDecisao() {
  const ini = ENG.indexOf("} else if (a.action === 'extension_decision') {\n        // Coordinator");
  assert.ok(ini > 0, 'ramo extension_decision do applyTaskActions');
  const fim = ENG.indexOf("} else if (a.action === 'delegate') {", ini);
  return ENG.slice(ini, fim);
}

test('engine: extension_decision resolve pelos pedidos de prazo de quem decide, sem janela nem busca global', () => {
  const r = ramoDecisao();
  assert.match(r, /resolverAlvoDecisaoPrazo\(/);
  assert.match(r, /\.eq\('collaborator_id', collaborator\.id\)[\s\S]*\.eq\('notification_type', 'deadline_extension_request'\)/);
  assert.doesNotMatch(r, /\.gte\('due_date'/);          // janela de 60 dias fora
  assert.doesNotMatch(r, /\.limit\(500\)/);              // busca global fora
  assert.match(r, /\.eq\('id', _alvoExt\.taskId\)/);      // tarefa por id exato
});

test('engine: prefixo ambíguo vira pergunta (failMessages) e não decide', () => {
  const r = ramoDecisao();
  const amb = r.slice(r.indexOf("_alvoExt.status === 'ambiguo'"));
  assert.match(amb, /failMessages\.push\(/);
  assert.match(amb.slice(0, amb.indexOf('continue;')), /failCount\+\+/);
});

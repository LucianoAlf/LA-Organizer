'use strict';
// Router determinístico v1/v2 — decisão de rota ANTES de qualquer LLM.
// Regra-mãe: cada inbound tem UM dono. Duas rotas = duas respostas = duas execuções.
const assert = require('node:assert');
const { test } = require('node:test');
const { decideRoute, ROUTE_REASONS } = require('./route-decision');

// facts = o que o adapter já leu do ledger; o router não faz I/O.
const F = (extra) => ({
  quotedOwner: null,      // dono do wa_message_id citado ('v1' | 'v2' | null)
  flowOwner: null,        // dono do fluxo aberto pra esse chat ('v1' | 'v2' | null)
  flowPhase: null,        // 'canary' | 'draining' | 'retired' | null
  ...extra,
});

// ---------- default: nada muda sem sinal explícito ----------
test('sem nenhum sinal, vai pro v1 (o legado é o default, não o novo)', () => {
  const r = decideRoute(F());
  assert.strictEqual(r.owner, 'v1');
  assert.strictEqual(r.reason, ROUTE_REASONS.DEFAULT_V1);
});

test('sem sinal, nem um fluxo retired muda o default', () => {
  assert.strictEqual(decideRoute(F({ flowOwner: 'v2', flowPhase: 'retired' })).owner, 'v1');
});

// ---------- quote: o sinal mais específico ----------
test('citação de mensagem do v1 → v1', () => {
  const r = decideRoute(F({ quotedOwner: 'v1' }));
  assert.strictEqual(r.owner, 'v1');
  assert.strictEqual(r.reason, ROUTE_REASONS.QUOTE_V1);
});

test('citação de mensagem do v2 → v2', () => {
  const r = decideRoute(F({ quotedOwner: 'v2' }));
  assert.strictEqual(r.owner, 'v2');
  assert.strictEqual(r.reason, ROUTE_REASONS.QUOTE_V2);
});

test('citação de mensagem do v2 vale mesmo em drenagem (rollback não sequestra conversa)', () => {
  const r = decideRoute(F({ quotedOwner: 'v2', flowOwner: 'v2', flowPhase: 'draining' }));
  assert.strictEqual(r.owner, 'v2');
});

// ---------- fluxo aberto ----------
test('fluxo v2 aberto, sem citação → v2', () => {
  const r = decideRoute(F({ flowOwner: 'v2', flowPhase: 'canary' }));
  assert.strictEqual(r.owner, 'v2');
  assert.strictEqual(r.reason, ROUTE_REASONS.OPEN_FLOW_V2);
});

test('fluxo v2 em DRENAGEM continua no v2 (rollback não abandona operação em andamento)', () => {
  const r = decideRoute(F({ flowOwner: 'v2', flowPhase: 'draining' }));
  assert.strictEqual(r.owner, 'v2');
});

test('fluxo marcado retired não segura mais nada → v1', () => {
  const r = decideRoute(F({ flowOwner: 'v2', flowPhase: 'retired' }));
  assert.strictEqual(r.owner, 'v1');
});

// ---------- conflito: quote x fluxo ----------
test('citação do v1 com fluxo v2 aberto: manda pro v1 e REGISTRA o conflito', () => {
  // A citação identifica a ENTIDADE, e quem pode mutar é o dono dela. Mandar pro v2
  // (dono do fluxo) faria ele receber algo que não pode tocar. O conflito vira telemetria,
  // não muda a rota — mas precisa ser visível, senão vira bug invisível.
  const r = decideRoute(F({ quotedOwner: 'v1', flowOwner: 'v2', flowPhase: 'canary' }));
  assert.strictEqual(r.owner, 'v1');
  assert.strictEqual(r.reason, ROUTE_REASONS.QUOTE_V1);
  assert.strictEqual(r.conflict, 'quote_v1_over_open_flow_v2');
});

test('citação do v2 com fluxo v1 aberto: v2, com conflito registrado', () => {
  const r = decideRoute(F({ quotedOwner: 'v2', flowOwner: 'v1' }));
  assert.strictEqual(r.owner, 'v2');
  assert.strictEqual(r.conflict, 'quote_v2_over_open_flow_v1');
});

test('sem conflito, o campo não aparece', () => {
  assert.strictEqual(decideRoute(F({ quotedOwner: 'v2', flowOwner: 'v2' })).conflict, undefined);
  assert.strictEqual(decideRoute(F()).conflict, undefined);
});

// ---------- robustez: entrada suja nunca vira v2 por acidente ----------
test('valores desconhecidos são ignorados — na dúvida, v1', () => {
  for (const lixo of ['v3', '', 'V2 ', 0, {}, [], true]) {
    assert.strictEqual(decideRoute(F({ quotedOwner: lixo })).owner, 'v1', `quotedOwner=${JSON.stringify(lixo)}`);
    assert.strictEqual(decideRoute(F({ flowOwner: lixo })).owner, 'v1', `flowOwner=${JSON.stringify(lixo)}`);
  }
});

test('facts ausente ou nulo não explode e cai no v1', () => {
  assert.strictEqual(decideRoute().owner, 'v1');
  assert.strictEqual(decideRoute(null).owner, 'v1');
  assert.strictEqual(decideRoute({}).owner, 'v1');
});

// ---------- a decisão é FECHADA: sempre exatamente um dono ----------
test('toda combinação possível devolve exatamente um dono válido e um motivo', () => {
  const vals = [null, 'v1', 'v2', 'lixo'];
  const fases = [null, 'canary', 'draining', 'retired'];
  let n = 0;
  for (const q of vals) {
    for (const f of vals) {
      for (const fase of fases) {
        const r = decideRoute({ quotedOwner: q, flowOwner: f, flowPhase: fase });
        assert.ok(r && (r.owner === 'v1' || r.owner === 'v2'), `owner inválido em ${q}/${f}/${fase}`);
        assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
        assert.ok(Object.values(ROUTE_REASONS).includes(r.reason), `motivo fora do enum: ${r.reason}`);
        n++;
      }
    }
  }
  assert.strictEqual(n, 4 * 4 * 4);
});

test('R3-B3: parâmetro morto não volta — a assinatura só tem sinais que decidem', () => {
  // canaryOpen alterava 0 das 64 decisões. Se alguém reintroduzir, este teste cai.
  const base = JSON.stringify(decideRoute(F({ quotedOwner: 'v2' })));
  assert.strictEqual(JSON.stringify(decideRoute({ quotedOwner: 'v2', canaryOpen: false })), base);
  assert.strictEqual(JSON.stringify(decideRoute({ quotedOwner: 'v2', canaryOpen: true })), base);
});

test('é determinístico: mesma entrada, mesma saída, sempre', () => {
  const f = F({ quotedOwner: 'v2', flowOwner: 'v1', flowPhase: 'canary' });
  const a = JSON.stringify(decideRoute(f));
  for (let i = 0; i < 50; i++) assert.strictEqual(JSON.stringify(decideRoute(f)), a);
});

test('não muta os fatos recebidos', () => {
  const f = F({ quotedOwner: 'v2', flowOwner: 'v1' });
  const antes = JSON.stringify(f);
  decideRoute(f);
  assert.strictEqual(JSON.stringify(f), antes);
});

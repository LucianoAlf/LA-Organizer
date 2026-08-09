'use strict';

const test = require('node:test');
const assert = require('node:assert');

// O gate lê env no require, então cada cenário precisa de um módulo novo.
function carregar(env) {
  const ANTES = { ...process.env };
  Object.assign(process.env, {
    TOM_OPS_ENABLED: '', TOM_OPS_GROUP_ID: '', TOM_OPS_ALLOWLIST: '', ...env,
  });
  delete require.cache[require.resolve('./ops-agent')];
  const mod = require('./ops-agent');
  process.env = ANTES;
  return mod;
}

const GRUPO = 'b3bd198a-c81a-40dc-addc-16838614cbae';   // LA ORGANIZER - TOM
const ALF   = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const HUGO  = 'e75929c3-6ec0-47a5-9d8f-9793e251263a';
const OUTRO = '11111111-2222-3333-4444-555555555555';
const LIGADO = { TOM_OPS_ENABLED: '1', TOM_OPS_GROUP_ID: GRUPO, TOM_OPS_ALLOWLIST: `${ALF},${HUGO}` };

test('libera os dois autorizados no grupo certo', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), true);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: HUGO }), true);
});

// AS DUAS CONDIÇÕES. "É membro do grupo" sozinho faria quem fosse adicionado um dia herdar a
// VPS; "está na allowlist" sozinho daria poder de engenharia no 1:1 e em qualquer outro grupo.
test('NEGA: pessoa autorizada FORA do grupo de ops', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.isOpsChannel({ groupId: 'outro-grupo-qualquer', senderCollabId: ALF }), false);
  assert.strictEqual(m.isOpsChannel({ groupId: null, senderCollabId: ALF }), false);
});

test('NEGA: pessoa NÃO autorizada dentro do grupo de ops', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: OUTRO }), false);
});

test('NEGA: remetente não identificado — sender_id NULL não vira comando', () => {
  const m = carregar(LIGADO);
  for (const s of [null, undefined, '', 0]) {
    assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: s }), false, String(s));
  }
});

// Kill switch e fail-closed de configuração.
test('NEGA: nasce desligado — sem TOM_OPS_ENABLED nada passa', () => {
  const m = carregar({ TOM_OPS_GROUP_ID: GRUPO, TOM_OPS_ALLOWLIST: `${ALF},${HUGO}` });
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false);
});

test('NEGA: flag em qualquer valor que não seja exatamente "1"', () => {
  for (const v of ['0', 'true', 'sim', 'yes', ' 1']) {
    const m = carregar({ ...LIGADO, TOM_OPS_ENABLED: v });
    assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false, `flag="${v}"`);
  }
});

test('NEGA: ligado mas sem grupo ou sem allowlist configurados', () => {
  const semGrupo = carregar({ TOM_OPS_ENABLED: '1', TOM_OPS_ALLOWLIST: ALF });
  assert.strictEqual(semGrupo.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false);
  const semLista = carregar({ TOM_OPS_ENABLED: '1', TOM_OPS_GROUP_ID: GRUPO });
  assert.strictEqual(semLista.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false);
});

test('allowlist tolera espaços na env sem perder a checagem', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_ALLOWLIST: ` ${ALF} , ${HUGO} ` });
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), true);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: OUTRO }), false);
});

// O briefing é o que impede o agente de redescobrir a casa a cada pedido — e o que fixa o
// que ele NÃO faz. Se alguém apagar isso, o agente perde os limites sem nada quebrar.
test('briefing carrega quem pediu e os limites', () => {
  const m = carregar(LIGADO);
  const b = m.buildBriefing('Hugo');
  assert.match(b, /Hugo/);
  assert.match(b, /N[ÃA]O apague dado de produ[çc][ãa]o/i);
  assert.match(b, /soul\/|skills\//);
  assert.match(b, /tom_known_issues/);
  assert.match(b, /tom-error\.log/);
});

// PEDIDO PERDIDO NO RESTART (Alf, 08/08 19:29) — o pior sintoma possível: silêncio.
// O CLI roda como processo FILHO do TOM. `pm2 restart` mata o pai, o filho morre junto e o
// `.then()` que postaria a resposta nunca roda. Não há erro, não há log, não há aviso: a
// pessoa fica olhando pro "Tô nisso" pra sempre. E o auto-deploy reinicia a CADA push, então
// isto não é exceção — é o caminho comum.
test('pedido em andamento fica registrado e some quando termina', () => {
  const m = carregar(LIGADO);
  assert.deepStrictEqual(m.pedidosEmAndamento(), []);
  const id = m._registrarPedido('Alf', 'roda a auditoria');
  assert.strictEqual(m.pedidosEmAndamento().length, 1);
  assert.strictEqual(m.pedidosEmAndamento()[0].quem, 'Alf');
  m._concluirPedido(id);
  assert.deepStrictEqual(m.pedidosEmAndamento(), []);
});

test('sem pedido em andamento não há aviso — reinício limpo é silencioso', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.textoDePedidosPerdidos(), null);
});

test('aviso nomeia quem pediu e diz o que fazer', () => {
  const m = carregar(LIGADO);
  m._registrarPedido('Hugo', 'me traz os erros de ontem do financeiro');
  const t = m.textoDePedidosPerdidos();
  assert.match(t, /Hugo/);
  assert.match(t, /me traz os erros/);
  assert.match(t, /manda de novo|pede de novo/i);
  assert.ok(!t.includes('**'), 'markdown não renderiza no zap');
});

test('aviso cobre TODOS os pedidos perdidos, não só o primeiro', () => {
  const m = carregar(LIGADO);
  m._registrarPedido('Alf', 'primeiro pedido');
  m._registrarPedido('Hugo', 'segundo pedido');
  const t = m.textoDePedidosPerdidos();
  assert.match(t, /primeiro pedido/);
  assert.match(t, /segundo pedido/);
});

test('pedido muito longo é cortado no aviso', () => {
  const m = carregar(LIGADO);
  m._registrarPedido('Alf', 'x'.repeat(400));
  assert.ok(m.textoDePedidosPerdidos().length < 400, 'aviso não pode virar parede');
});

// As regras de entrega vivem num .md editável sem deploy. Se o caminho quebrar, o agente
// volta a despejar parede de texto no WhatsApp sem nada falhar — daí o teste.
const FORMATO = require('path').join(__dirname, '../../docs/ops/FORMATO-GRUPO.md');

test('briefing embute as regras de formato do grupo', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_FORMATO: FORMATO });
  const b = m.buildBriefing('Alf');
  assert.match(b, /at[ée] 15 linhas/i);
  assert.match(b, /Exemplo bom/);
  assert.ok(b.length > 2000, `briefing curto demais (${b.length}) — o .md não entrou`);
});

test('arquivo de formato ausente não derruba o briefing', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_FORMATO: '/caminho/que/nao/existe.md' });
  const b = m.buildBriefing('Alf');
  assert.match(b, /Alf/);
  assert.match(b, /N[ÃA]O apague dado de produ[çc][ãa]o/i);
});

// O canal de ops JÁ ESTÁ EM PRODUÇÃO. Estes parâmetros existem para o agente de governança
// reusar o spawn sem herdar o briefing genérico — e não podem mudar nada do que já roda.
test('runOpsAgent aceita briefing próprio sem alterar o padrão', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(typeof m.resolverBriefing, 'function');
  assert.strictEqual(m.resolverBriefing('Alf', 'PROTOCOLO XYZ'), 'PROTOCOLO XYZ');
  assert.match(m.resolverBriefing('Alf', null), /Alf/);
  assert.match(m.resolverBriefing('Alf', '   '), /Alf/, 'briefing em branco cai no padrão');
});

test('runOpsAgent aceita timeout próprio, com o default intacto', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.resolverTimeout(1800000), 1800000);
  assert.strictEqual(m.resolverTimeout(undefined), m.OPS_TIMEOUT_MS);
  assert.strictEqual(m.resolverTimeout(0), m.OPS_TIMEOUT_MS, 'zero não pode virar timeout imediato');
  assert.strictEqual(m.resolverTimeout(-5), m.OPS_TIMEOUT_MS);
  assert.strictEqual(m.resolverTimeout('abc'), m.OPS_TIMEOUT_MS);
});

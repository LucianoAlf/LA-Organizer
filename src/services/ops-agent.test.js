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

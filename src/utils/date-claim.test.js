const test = require('node:test');
const assert = require('node:assert');
const { neutralizaDataAfirmada, detectaDataAfirmadaErrada } = require('./date-claim');

// GROUPCHAT-DATE-SELF-POISONING (Rose 06/08): o TOM errou a data uma vez, a frase virou linha
// no histórico e no resumo de longo prazo, e ele passou a reler e repetir. Medição retroativa:
// 11 erros em 26 afirmações (42%), sempre em RAJADA. Estes casos são falas reais dele.

test('neutraliza a data que ele gruda no rotulo relativo', () => {
  assert.equal(
    neutralizaDataAfirmada('Rose, aqui o que aparece na lista agora (hoje, 07/08):'),
    'Rose, aqui o que aparece na lista agora (hoje):',
  );
  assert.equal(neutralizaDataAfirmada('📅 *Pra hoje (07/08):*'), '📅 *Pra hoje:*');
  assert.equal(
    neutralizaDataAfirmada('- Faturamento Mensal — prazo era ontem, 06/08 (1 dia)'),
    '- Faturamento Mensal — prazo era ontem (1 dia)',
  );
  assert.equal(neutralizaDataAfirmada('Com base na lista de hoje (07/08):'), 'Com base na lista de hoje:');
});

test('neutraliza mesmo com tag HTML no meio (a memoria de longo prazo e HTML)', () => {
  // Texto REAL gravado em work_groups.tom_chat_memory do grupo Financeiro.
  const real = 'TOM se confundiu com a data — Rose corrigiu: hoje é <strong>06/08</strong>';
  assert.ok(!/06\/08/.test(neutralizaDataAfirmada(real)), 'a data tem que sair mesmo dentro de <strong>');
});

test('nao mexe em data que NAO e afirmacao de dia relativo', () => {
  const intocados = [
    'o que tem pra hoje? Vence 12/08',
    '- 09/08 — Depósito de Cheques: Venc 08 (prazo dia 09) (Rose)',
    '- Relatório Mensal Financeiro (Grupo) — prazo era 05/08 (2 dias)',
    'me manda o que tem pra hoje',
    'reunião dia 12/08 com a Barra',
  ];
  for (const t of intocados) assert.equal(neutralizaDataAfirmada(t), t, `nao podia mexer em: ${t}`);
});

test('detecta a afirmacao errada e diz qual era a certa', () => {
  const achados = detectaDataAfirmadaErrada('Rose, aqui o que aparece na lista agora (hoje, 07/08):', '2026-08-06');
  assert.equal(achados.length, 1);
  assert.equal(achados[0].rotulo, 'hoje');
  assert.equal(achados[0].disse, '07/08');
  assert.equal(achados[0].esperado, '06/08');
});

test('nao acusa quando a data bate', () => {
  assert.deepEqual(detectaDataAfirmadaErrada('lista de hoje (06/08):', '2026-08-06'), []);
  assert.deepEqual(detectaDataAfirmadaErrada('prazo era ontem, 05/08', '2026-08-06'), []);
  assert.deepEqual(detectaDataAfirmadaErrada('amanhã (07/08) tem a reunião', '2026-08-06'), []);
});

test('ontem/amanha atravessam a virada de mes', () => {
  assert.deepEqual(detectaDataAfirmadaErrada('ontem, 31/08', '2026-09-01'), []);
  assert.deepEqual(detectaDataAfirmadaErrada('amanhã, 01/09', '2026-08-31'), []);
  assert.equal(detectaDataAfirmadaErrada('ontem, 01/09', '2026-09-01')[0].esperado, '31/08');
});

test('detecta o caso real da Rose: ele contradiz o proprio rotulo do pool', () => {
  // O pool entregou "prazo 06/08 qui (HOJE)"; ele escreveu "prazo era ontem, 06/08".
  const achados = detectaDataAfirmadaErrada('- Faturamento Mensal — prazo era ontem, 06/08 (1 dia)', '2026-08-06');
  assert.equal(achados.length, 1);
  assert.equal(achados[0].esperado, '05/08');
});

test('texto vazio ou nulo nao quebra', () => {
  assert.equal(neutralizaDataAfirmada(null), '');
  assert.equal(neutralizaDataAfirmada(''), '');
  assert.deepEqual(detectaDataAfirmadaErrada(null, '2026-08-06'), []);
  assert.deepEqual(detectaDataAfirmadaErrada('hoje, 07/08', null), []);
});

'use strict';
// Check de paridade git↔produção. Nasceu de DOIS incidentes reais no mesmo dia (09/08):
//
// 1. O agente de governança commitou o fix da fatura (9a4dffd) e o commit ficou SÓ na VPS.
//    O próximo `git reset --hard origin/main` teria apagado o trabalho — descobri por acaso.
// 2. Meu deploy rodou `reset --hard` no meio da varredura dele e apagou do disco a correção
//    já testada que ainda não tinha sido commitada. Só o teste untracked denunciou.
//
// As duas falhas são silenciosas: nada quebra, nada loga, e o trabalho some. O check faz
// disso um alerta diário no relatório das 07h.

const test = require('node:test');
const assert = require('node:assert');
const { avaliarParidade } = require('./git-paridade');

test('tudo em paridade → ok', () => {
  const r = avaliarParidade({ sujos: [], commitsNaoEmpurrados: [] });
  assert.strictEqual(r.status, 'ok');
});

// O caso do agente: trabalho commitado que existe só aqui.
test('commit local não empurrado é ALERTA — o próximo reset --hard apaga', () => {
  const r = avaliarParidade({ sujos: [], commitsNaoEmpurrados: ['9a4dffd fix(fatura): ...'] });
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /9a4dffd|1 commit/i);
  assert.match(r.detail, /empurrad|push/i);
});

// O meu caso: código editado e não commitado.
test('código em src/ sem commit é ALERTA', () => {
  const r = avaliarParidade({ sujos: ['src/engine.js'], commitsNaoEmpurrados: [] });
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /src\/engine\.js/);
});

test('os dois juntos aparecem no mesmo detalhe', () => {
  const r = avaliarParidade({ sujos: ['src/engine.js'], commitsNaoEmpurrados: ['abc1234 x'] });
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /src\/engine\.js/);
  assert.match(r.detail, /abc1234|1 commit/i);
});

// Sem esta regra o check gritaria todo dia: a VPS tem .env, backups e HOME do CLI soltos.
test('lixo conhecido fora de src/ NÃO alerta', () => {
  const r = avaliarParidade({
    sujos: ['.env', '.env.bak-gov', '.claude-tom/', 'logs/gov-agent.log', 'docs/ops/rascunho.md'],
    commitsNaoEmpurrados: [],
  });
  assert.strictEqual(r.status, 'ok');
});

test('só conta .js de src/ — .bak e teste não são código em produção', () => {
  const r = avaliarParidade({ sujos: ['src/engine.js.bak-20260716', 'src/foo.test.js'], commitsNaoEmpurrados: [] });
  assert.strictEqual(r.status, 'ok');
});

test('skills/ e soul/ sujos são alerta — é a voz do TOM fora do git', () => {
  const r = avaliarParidade({ sujos: ['skills/lojinha.md'], commitsNaoEmpurrados: [] });
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /skills\/lojinha\.md/);
});

test('git indisponível não vira erro do sistema — degrada pra skipped', () => {
  const r = avaliarParidade(null);
  assert.strictEqual(r.status, 'ok');
  assert.match(r.detail, /skip|indispon/i);
});

test('lista longa é resumida, não despejada', () => {
  const sujos = Array.from({ length: 12 }, (_, i) => `src/a${i}.js`);
  const r = avaliarParidade({ sujos, commitsNaoEmpurrados: [] });
  assert.ok(r.detail.length < 300, `detalhe virou parede: ${r.detail.length} chars`);
  assert.match(r.detail, /12/);
});

'use strict';
// O ciclo diário. O que este teste protege: (a) não rodar duas vezes no mesmo dia — o cron
// bate a cada 5min dentro de uma janela de retry; (b) a família em parada chegar ao pedido,
// senão o agente reincide no mesmo fix que já falhou duas vezes; (c) nunca ficar em silêncio;
// (d) não rodar sem protocolo — agente com acesso à VPS e sem trava é pior que agente nenhum.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DONO = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const PROTOCOLO_REAL = path.join(__dirname, '../../docs/ops/PROTOCOLO-GOVERNANCA.md');

function carregar(env) {
  const ANTES = { ...process.env };
  Object.assign(process.env, { TOM_GOV_AGENT: '1', TOM_OPS_ALLOWLIST: DONO, ...env });
  delete require.cache[require.resolve('./governance-agent')];
  const mod = require('./governance-agent');
  process.env = ANTES;
  return mod;
}

function fakeSb({ jaRodou = false, kis = [], findings = [] } = {}) {
  const inserts = [];
  const mk = (resultado) => {
    const o = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'not', 'ilike']) o[m] = () => o;
    o.insert = (row) => { inserts.push(row); return mk({ data: null, error: null }); };
    o.then = (ok) => ok(resultado);
    return o;
  };
  return {
    inserts,
    from: (t) => {
      if (t === 'ritual_logs') return mk({ data: jaRodou ? [{ id: 'x' }] : [], error: null });
      if (t === 'tom_known_issues') return mk({ data: kis, error: null });
      return mk({ data: findings, error: null });
    },
  };
}

test('não roda duas vezes no mesmo dia', async () => {
  const m = carregar();
  const chamadas = [];
  const r = await m.rodarCicloGovernanca(fakeSb({ jaRodou: true }), {
    postar: () => {}, ymd: '2026-08-09', rodar: () => { chamadas.push(1); return Promise.resolve({ ok: true, text: 'x' }); },
  });
  assert.strictEqual(r.rodou, false);
  assert.strictEqual(chamadas.length, 0, 'gastou uma rodada de Opus 5 à toa');
});

test('force ignora o gate do dia', async () => {
  const m = carregar();
  let chamou = 0;
  const r = await m.rodarCicloGovernanca(fakeSb({ jaRodou: true }), {
    postar: () => {}, ymd: '2026-08-09', force: true,
    rodar: () => { chamou++; return Promise.resolve({ ok: true, text: 'feito' }); },
  });
  assert.strictEqual(r.rodou, true);
  assert.strictEqual(chamou, 1);
});

test('desligado por env não roda', async () => {
  const m = carregar({ TOM_GOV_AGENT: '0' });
  const r = await m.rodarCicloGovernanca(fakeSb(), { postar: () => {}, ymd: '2026-08-09', rodar: () => Promise.resolve({ ok: true, text: 'x' }) });
  assert.strictEqual(r.rodou, false);
});

test('grava o log do dia só DEPOIS de postar', async () => {
  const m = carregar();
  const sb = fakeSb();
  const postadas = [];
  await m.rodarCicloGovernanca(sb, {
    postar: (t) => postadas.push(t), ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: true, text: 'relatório do ciclo' }),
  });
  assert.strictEqual(postadas.length, 1);
  assert.strictEqual(postadas[0], 'relatório do ciclo', 'postou outra coisa: verde pelo motivo errado');
  assert.strictEqual(sb.inserts.length, 1);
  assert.strictEqual(sb.inserts[0].ritual_type, 'gov_agent');
});

test('se postar falhar, NÃO grava o log — o próximo tick retenta', async () => {
  const m = carregar();
  const sb = fakeSb();
  await assert.rejects(() => m.rodarCicloGovernanca(sb, {
    postar: () => { throw new Error('uazapi 503'); }, ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: true, text: 'x' }),
  }));
  assert.strictEqual(sb.inserts.length, 0);
});

test('agente que volta sem texto vira aviso, não silêncio', async () => {
  const m = carregar();
  const postadas = [];
  await m.rodarCicloGovernanca(fakeSb(), {
    postar: (t) => postadas.push(t), ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: false, text: '' }),
  });
  assert.strictEqual(postadas.length, 1);
  assert.match(postadas[0], /n[ãa]o/i);
});

test('o pedido carrega a família em parada — senão ele reincide no mesmo fix', () => {
  const m = carregar();
  const pedido = m.montarPedido({ fechados: 3, reincidentes: [{ codigo: 'FOO-BAR', vezes: 2 }], emParada: ['FOO-BAR'], taxa: 0.33 });
  assert.match(pedido, /FOO-BAR/);
  assert.match(pedido, /parada|n[ãa]o corrij/i);
});

test('o pedido cita o protocolo e o placar mesmo quando está tudo limpo', () => {
  const m = carregar();
  const pedido = m.montarPedido({ fechados: 0, reincidentes: [], emParada: [], taxa: 0 });
  assert.match(pedido, /ETAPA 1|placar/i);
  assert.ok(pedido.length > 100);
});

// ── SEM PROTOCOLO, NÃO RODA ────────────────────────────────────────────────────────────────
// Se o .md não for encontrado (scp esquecido, caminho errado), o briefing cai no do canal de
// ops e o ciclo roda SEM as etapas: sem placar, sem etapa 2.5, sem "reproduza antes de
// corrigir". Um agente com Bash na VPS e sem as travas é pior que agente nenhum — e a falha
// seria invisível, porque ele responderia normalmente.
test('sem o arquivo de protocolo, o ciclo NÃO roda e avisa', async () => {
  const m = carregar({ TOM_GOV_PROTOCOLO: '/caminho/que/nao/existe.md' });
  const sb = fakeSb();
  const postadas = [];
  let chamou = 0;
  const r = await m.rodarCicloGovernanca(sb, {
    postar: (t) => postadas.push(t), ymd: '2026-08-09',
    rodar: () => { chamou++; return Promise.resolve({ ok: true, text: 'x' }); },
  });
  assert.strictEqual(r.rodou, false);
  assert.strictEqual(chamou, 0, 'rodou o agente sem as travas do protocolo');
  assert.strictEqual(postadas.length, 1, 'falhar em silêncio é o pior desfecho');
  assert.match(postadas[0], /protocolo/i);
});

test('o protocolo de verdade é encontrado e entra no briefing', () => {
  const m = carregar({ TOM_GOV_PROTOCOLO: PROTOCOLO_REAL });
  const b = m.montarBriefing();
  assert.match(b, /ETAPA 1/);
  assert.match(b, /ETAPA 2\.5/);
  assert.match(b, /gov-agent/);
  assert.ok(b.length > 2000, `briefing curto demais (${b.length}) — o .md não entrou`);
});

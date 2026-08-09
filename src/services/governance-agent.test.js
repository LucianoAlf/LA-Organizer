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

// O dublê de `postar` devolve comprovante porque é o que o postOpsResult devolve quando a
// mensagem entra — sem isso o ciclo trata como entrega não confirmada (ver o bloco no fim).
test('force ignora o gate do dia', async () => {
  const m = carregar();
  let chamou = 0;
  const r = await m.rodarCicloGovernanca(fakeSb({ jaRodou: true }), {
    postar: () => ({ id: 'msg1' }), ymd: '2026-08-09', force: true,
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

// ── ENTREGA QUE "RESOLVE" SEM TER ENTREGADO ────────────────────────────────────────────────
// O teste acima passava por injetar um `postar` que LANÇA. O `postar` de produção é o
// postOpsResult, e ele nunca lançava: devolvia null quando o insert falhava. Então o invariante
// declarado ("só grava o log depois de postar") era verdadeiro no teste e falso em produção —
// o dia fechava sem o relatório ter chegado e o gate bloqueava o retry (GOVLOG-SEM-ENTREGA).
// O contrato agora é explícito: `postar` PROVA a entrega resolvendo com valor truthy.
// Não provou — falsy, undefined, ou exceção — conta como não entregue.
test('postar que resolve com null não fecha o dia — senão o gate de idempotência vira mordaça', async () => {
  const m = carregar();
  const sb = fakeSb();
  await assert.rejects(() => m.rodarCicloGovernanca(sb, {
    postar: async () => null,   // exatamente o que o postOpsResult devolvia com o insert falhando
    ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: true, text: 'relatório do ciclo' }),
  }), /entrega/i);
  assert.strictEqual(sb.inserts.length, 0, 'marcou o dia como entregue sem ter entregue nada');
});

test('postar que não devolve nada também não conta como entrega', async () => {
  const m = carregar();
  const sb = fakeSb();
  await assert.rejects(() => m.rodarCicloGovernanca(sb, {
    postar: () => {}, ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: true, text: 'x' }),
  }));
  assert.strictEqual(sb.inserts.length, 0);
});

// O aviso de protocolo ausente grava o log de propósito (senão o grupo leva ~48 avisos iguais).
// Mas isso só vale se o aviso TIVER CHEGADO: sem entrega, gravar significa que ninguém nunca
// fica sabendo que o agente está parado.
test('aviso de protocolo ausente que não entrega também não fecha o dia', async () => {
  const m = carregar({ TOM_GOV_PROTOCOLO: '/caminho/que/nao/existe.md' });
  const sb = fakeSb();
  await assert.rejects(() => m.rodarCicloGovernanca(sb, {
    postar: async () => null, ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: true, text: 'x' }),
  }), /entrega/i);
  assert.strictEqual(sb.inserts.length, 0, 'fechou o dia com o aviso preso na garganta');
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

// ── TETO SEPARADO: 1 CORREÇÃO por rodada, refutação sem limite ──────────────────────────────
// Medido em 09/08: 206 achados abertos e só 1 na janela de 2 dias (106 com +30 dias, 83 com
// 8-30). O agente ia rodar a seco enquanto o acervo apodrecia. O "um por rodada" foi decidido
// porque ninguém revisa cinco mudanças de engine por dia — a restrição real é banda de revisão
// de CÓDIGO. Refutar não muda código, então não consome revisão.
const ACERVO = { total: 206, alto: 8, ate2d: 1, ate7d: 17, mais30d: 106 };

test('o pedido separa o teto: UMA correção, refutação sem limite', () => {
  const m = carregar();
  const p = m.montarPedido({ fechados: 0, reincidentes: [], emParada: [], taxa: 0 }, ACERVO);
  assert.match(p, /UMA? corre[çc][ãa]o/i, 'tem que dizer que o teto de correção é 1');
  assert.match(p, /sem limite|quantos conseguir|o quanto conseguir/i, 'refutação não pode herdar o teto de 1');
});

test('o pedido mostra o tamanho do acervo — senão ele só olha a janela curta', () => {
  const m = carregar();
  const p = m.montarPedido({ fechados: 0, reincidentes: [], emParada: [], taxa: 0 }, ACERVO);
  assert.match(p, /206/);
  assert.match(p, /106/, 'o volume antigo é o que justifica a varredura');
});

// Sem esta trava a varredura vira uma faxina de 8 achados graves sem ninguém olhar.
test('severidade ALTA fica fora da varredura em massa', () => {
  const m = carregar();
  const p = m.montarPedido({ fechados: 0, reincidentes: [], emParada: [], taxa: 0 }, ACERVO);
  assert.match(p, /alt[ao]/i);
  assert.match(p, /n[ãa]o feche|fora da varredura|nunca em massa/i);
});

test('sem acervo (falha na consulta) o pedido não quebra nem inventa número', () => {
  const m = carregar();
  const p = m.montarPedido({ fechados: 0, reincidentes: [], emParada: [], taxa: 0 }, null);
  assert.ok(p.length > 100);
  assert.doesNotMatch(p, /undefined|NaN|null/);
});

test('carregarAcervo devolve as contagens que o pedido usa', async () => {
  const m = carregar();
  const linhas = [
    { severity: 'alto',  incident_at: new Date(Date.now() - 40 * 86400000).toISOString() },
    { severity: 'medio', incident_at: new Date(Date.now() - 40 * 86400000).toISOString() },
    { severity: 'medio', incident_at: new Date(Date.now() - 1 * 86400000).toISOString() },
    { severity: 'baixo', incident_at: null },
  ];
  const sb = { from: () => { const o = {}; for (const k of ['select','not','in','gte','eq','order','limit']) o[k] = () => o; o.then = (ok) => ok({ data: linhas, error: null }); return o; } };
  const a = await m.carregarAcervo(sb);
  assert.strictEqual(a.total, 4);
  assert.strictEqual(a.alto, 1);
  assert.strictEqual(a.ate2d, 1);
  assert.strictEqual(a.mais30d, 2);
});

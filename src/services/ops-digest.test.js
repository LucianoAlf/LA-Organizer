'use strict';
// Testes do digest de auditoria que o TOM leva ao grupo sem ninguém pedir.
//
// O digest é DETERMINÍSTICO de propósito: número e lista vêm de SQL, não de LLM. Um agente
// resumindo contagem é exatamente onde nasce confabulação — e um alarme que mente uma vez
// deixa de ser lido. O agente Opus 5 continua disponível sob demanda pra aprofundar.

const test = require('node:test');
const assert = require('node:assert');
const { formatarDigest, extrairLiteral, extrairFala, traduzCategoria } = require('./ops-digest');

const achado = (over = {}) => ({
  categoria: 'confabulation', severidade: 'medio', pessoa: 'Rose',
  quando: '06/08 14:06', literal: 'Fechando a tarefa dela.',
  regressao: false, codigo: null, ...over,
});

// ── Dia limpo ───────────────────────────────────────────────────────────────────
test('sem achado nenhum manda uma linha curta, não silêncio', () => {
  const t = formatarDigest({ dataLabel: '07/08', achados: [], suprimidos: 0 });
  assert.match(t, /✅/);
  assert.ok(t.split('\n').length <= 2, 'dia limpo tem que caber em uma linha');
});

test('dia sem achado mas com suprimidos conta os suprimidos', () => {
  const t = formatarDigest({ dataLabel: '07/08', achados: [], suprimidos: 3 });
  assert.match(t, /3/);
});

// ── Ordem: o que quebrou de novo vem primeiro ───────────────────────────────────
test('regressão aparece antes de achado novo, com marcador próprio', () => {
  const t = formatarDigest({
    dataLabel: '07/08',
    achados: [achado({ pessoa: 'Ana' }), achado({ pessoa: 'Bia', regressao: true })],
    suprimidos: 0,
  });
  assert.ok(t.indexOf('Bia') < t.indexOf('Ana'), 'regressão tem que vir primeiro');
  assert.match(t, /🔴/);
  assert.match(t, /🆕/);
});

test('dentro do mesmo grupo, severidade alta vem antes da baixa', () => {
  const t = formatarDigest({
    dataLabel: '07/08',
    achados: [achado({ pessoa: 'Baixa', severidade: 'baixo' }), achado({ pessoa: 'Alta', severidade: 'alto' })],
    suprimidos: 0,
  });
  assert.ok(t.indexOf('Alta') < t.indexOf('Baixa'));
});

// ── Cabeçalho conta o que existe ────────────────────────────────────────────────
test('cabeçalho traz a data e o total, e destaca quantas regressões', () => {
  const t = formatarDigest({
    dataLabel: '07/08',
    achados: [achado(), achado({ regressao: true }), achado({ regressao: true })],
    suprimidos: 0,
  });
  const head = t.split('\n')[0];
  assert.match(head, /07\/08/);
  assert.match(head, /3/);
  assert.match(head, /2 regress/i);
});

// ── Teto: cortar é aceitável, cortar CALADO não ─────────────────────────────────
test('acima do teto lista o teto e DIZ quantos ficaram de fora', () => {
  const achados = Array.from({ length: 9 }, (_, i) => achado({ pessoa: `P${i}` }));
  const t = formatarDigest({ dataLabel: '07/08', achados, suprimidos: 0, teto: 4 });
  assert.match(t, /P0/);
  assert.ok(!t.includes('P8'), 'não devia listar além do teto');
  assert.match(t, /5/, 'tem que dizer que 5 ficaram de fora');
});

test('regressão nunca é cortada pelo teto', () => {
  const achados = [
    ...Array.from({ length: 8 }, (_, i) => achado({ pessoa: `N${i}` })),
    achado({ pessoa: 'RegressaoImportante', regressao: true }),
  ];
  const t = formatarDigest({ dataLabel: '07/08', achados, suprimidos: 0, teto: 3 });
  assert.match(t, /RegressaoImportante/);
});

// ── Conteúdo por achado ─────────────────────────────────────────────────────────
test('mostra pessoa, hora, literal entre aspas e categoria em português', () => {
  const t = formatarDigest({ dataLabel: '07/08', achados: [achado()], suprimidos: 0 });
  assert.match(t, /Rose/);
  assert.match(t, /06\/08 14:06/);
  assert.match(t, /"Fechando a tarefa dela\."/);
  assert.match(t, /confabula/i);
  assert.ok(!t.includes('confabulation'), 'categoria crua em inglês não vai pro grupo');
});

test('código de known-issue aparece quando o achado já virou KI', () => {
  const t = formatarDigest({ dataLabel: '07/08', achados: [achado({ codigo: 'TASK-X-Y' })], suprimidos: 0 });
  assert.match(t, /TASK-X-Y/);
});

test('pessoa sem nome não quebra nem imprime null', () => {
  const t = formatarDigest({ dataLabel: '07/08', achados: [achado({ pessoa: null })], suprimidos: 0 });
  assert.ok(!/null|undefined/.test(t), t);
});

test('suprimidos só contam no rodapé — não viram item', () => {
  const t = formatarDigest({ dataLabel: '07/08', achados: [achado()], suprimidos: 2 });
  assert.match(t, /_.*2.*_/, 'rodapé em itálico com a contagem');
});

// ── Não pode emitir o que o WhatsApp não renderiza ──────────────────────────────
test('a saída não contém markdown que chega literal no zap', () => {
  const t = formatarDigest({
    dataLabel: '07/08',
    achados: [achado({ codigo: 'A-B', regressao: true }), achado()],
    suprimidos: 1,
  });
  assert.ok(!t.includes('**'), 'negrito markdown');
  assert.ok(!/^#{1,6} /m.test(t), 'título markdown');
  assert.ok(!/^\s*\|.*\|/m.test(t), 'tabela');
});

// ── extrairLiteral: a fala real, não o resumo ───────────────────────────────────
test('extrai a fala do USUÁRIO quando a evidência vem com timestamp', () => {
  const ev = '[06/08 (qui) 14:14] USUÁRIO: Essa limpeza barra, coloca a partir de terça.\n[06/08 (qui) 14:15] TOM: pra terça (12/08)';
  assert.strictEqual(extrairLiteral(ev), 'Essa limpeza barra, coloca a partir de terça.');
});

test('sem marcação de USUÁRIO usa a primeira linha com conteúdo', () => {
  assert.strictEqual(extrairLiteral('\n\nJa te disse q continuarei no sabado\nmais coisa'), 'Ja te disse q continuarei no sabado');
});

test('tira marcação markdown que vem grudada na evidência', () => {
  assert.strictEqual(extrairLiteral('reagendei a *Limpeza AC* pra `terça`'), 'reagendei a Limpeza AC pra terça');
});

test('literal longo é truncado com reticência', () => {
  const out = extrairLiteral('x'.repeat(300));
  assert.ok(out.length <= 121, `ficou com ${out.length}`);
  assert.match(out, /…$/);
});

test('evidência vazia ou nula devolve string vazia', () => {
  for (const v of [null, undefined, '', '   \n  ']) assert.strictEqual(extrairLiteral(v), '');
});

// Casos vistos na produção ao rodar o digest com dado real: a evidência chega crua da
// transcrição, com timestamp e rótulo grudados na fala.
test('tira o timestamp cru e separa quem falou', () => {
  const f = extrairFala('[05/08 (qua) 13:15] TOM: Fechou, reagendei pra amanhã.');
  assert.strictEqual(f.quem, 'TOM');
  assert.strictEqual(f.texto, 'Fechou, reagendei pra amanhã.');
});

test('rótulo TOM sem timestamp também é separado', () => {
  assert.deepStrictEqual(extrairFala('TOM: 📨 Recado enviado!'), { quem: 'TOM', texto: '📨 Recado enviado!' });
});

test('fala da pessoa não ganha rótulo', () => {
  assert.strictEqual(extrairFala('USUÁRIO: Vc precisa falar').quem, null);
});

test('reticência de recorte no começo da evidência some', () => {
  assert.strictEqual(extrairLiteral('... Essa limpeza barra, coloca a partir de terça.'),
    'Essa limpeza barra, coloca a partir de terça.');
});

test('quando é fala do TOM, o digest deixa isso explícito', () => {
  const t = formatarDigest({
    dataLabel: '07/08',
    achados: [achado({ falaDe: 'TOM', literal: 'Fechou, reagendei.' })],
    suprimidos: 0,
  });
  assert.match(t, /TOM: "Fechou, reagendei\."/);
});

test('achado sem literal não imprime aspas vazias', () => {
  const t = formatarDigest({ dataLabel: '07/08', achados: [achado({ literal: '' })], suprimidos: 0 });
  assert.ok(!t.includes('""'), t);
});

// ── Entrega: idempotência e ordem das operações ─────────────────────────────────
// Um cron que roda a cada 5min numa janela de retry duplica a mensagem se o gate falhar,
// e some com o dia se gravar o log antes de postar.
const { enviarOpsDigest, labelDia } = require('./ops-digest');

function fakeSb({ jaEnviado = false, findings = [], falhaAoPostar = false } = {}) {
  const inserts = [];
  const mk = (resultado) => {
    const o = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit']) o[m] = () => o;
    o.insert = (row) => { inserts.push(row); return mk({ data: null, error: null }); };
    o.then = (ok) => ok(resultado);
    return o;
  };
  return {
    inserts,
    falhaAoPostar,
    from: (t) => (t === 'ritual_logs'
      ? mk({ data: jaEnviado ? [{ id: 'x' }] : [], error: null })
      : mk({ data: findings, error: null })),
  };
}

const DONO = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';

const LINHA_DB = {
  category: 'confabulation', severity: 'medio', evidence: 'TOM: Fechou, reagendei.',
  incident_at: '2026-08-07T17:06:00Z', last_seen: '2026-08-08T06:00:00Z',
  promoted_code: null, auto_triage: { decision: 'keep' },
  collaborators: { preferred_name: 'Rose', full_name: 'Rose Silva' },
};

test('entrega o digest e só então grava o log do dia', async () => {
  const sb = fakeSb({ findings: [LINHA_DB] });
  const postadas = [];
  const r = await enviarOpsDigest(sb, { postar: (t) => postadas.push(t), ymd: '2026-08-08', ownerId: DONO });
  assert.strictEqual(r.enviado, true);
  assert.strictEqual(postadas.length, 1);
  assert.match(postadas[0], /Rose/);
  assert.strictEqual(sb.inserts.length, 1);
  assert.strictEqual(sb.inserts[0].ritual_type, 'ops_digest');
  assert.strictEqual(sb.inserts[0].reference_date, '2026-08-08');
});

test('não reenvia quando já entregou hoje', async () => {
  const sb = fakeSb({ jaEnviado: true, findings: [LINHA_DB] });
  const postadas = [];
  const r = await enviarOpsDigest(sb, { postar: (t) => postadas.push(t), ymd: '2026-08-08', ownerId: DONO });
  assert.strictEqual(r.enviado, false);
  assert.strictEqual(postadas.length, 0, 'mensagem duplicada no grupo');
  assert.strictEqual(sb.inserts.length, 0);
});

test('force ignora o gate — é como o dispatcher testa na mão', async () => {
  const sb = fakeSb({ jaEnviado: true, findings: [LINHA_DB] });
  const postadas = [];
  const r = await enviarOpsDigest(sb, { postar: (t) => postadas.push(t), ymd: '2026-08-08', ownerId: DONO, force: true });
  assert.strictEqual(r.enviado, true);
  assert.strictEqual(postadas.length, 1);
});

test('se o envio falhar, NÃO grava o log — o próximo tick tem que retentar', async () => {
  const sb = fakeSb({ findings: [LINHA_DB] });
  await assert.rejects(() => enviarOpsDigest(sb, {
    postar: () => { throw new Error('uazapi 503'); }, ymd: '2026-08-08', ownerId: DONO,
  }));
  assert.strictEqual(sb.inserts.length, 0, 'gravou entrega que não aconteceu');
});

// O teste acima só provava o caso em que o `postar` LANÇA. O `postar` de produção é o
// postOpsResult, e ele nunca lançava: devolvia null quando o insert em group_chat_messages
// falhava. Então o invariante do cabeçalho ("só grava o log DEPOIS de postar") era verdadeiro
// no teste e falso em produção — o dia fechava sem o digest ter chegado e o gate bloqueava o
// retry até as 11h (GOVLOG-SEM-ENTREGA, 09/08).
test('postar que resolve sem confirmar entrega não fecha o dia', async () => {
  const sb = fakeSb({ findings: [LINHA_DB] });
  await assert.rejects(() => enviarOpsDigest(sb, {
    postar: async () => null, ymd: '2026-08-08', ownerId: DONO,
  }), /entrega/i);
  assert.strictEqual(sb.inserts.length, 0, 'marcou o digest como entregue sem ter entregue');
});

test('sem função de envio não finge que entregou', async () => {
  const r = await enviarOpsDigest(fakeSb(), { ymd: '2026-08-08', ownerId: DONO });
  assert.strictEqual(r.enviado, false);
});

test('suprimido do banco não vira item, só contagem', async () => {
  const sb = fakeSb({ findings: [LINHA_DB, { ...LINHA_DB, auto_triage: { decision: 'suppress' } }] });
  const postadas = [];
  await enviarOpsDigest(sb, { postar: (t) => postadas.push(t), ymd: '2026-08-08', ownerId: DONO });
  assert.match(postadas[0], /1 achado/);
  assert.match(postadas[0], /1 suprimido/);
});

test('labelDia fatia a string — nunca monta Date (deslocaria o dia)', () => {
  assert.strictEqual(labelDia('2026-08-08'), '08/08');
  assert.strictEqual(labelDia('2026-01-01'), '01/01');
  assert.strictEqual(typeof labelDia(null), 'string');
});

// ── traduzCategoria cobre as 6 que existem no banco ─────────────────────────────
test('as 6 categorias reais têm tradução, e categoria nova não vira crash', () => {
  for (const c of ['dropped_request', 'frustration', 'confabulation', 'wrong_refusal', 'proactive_overreach', 'media_fail']) {
    const pt = traduzCategoria(c);
    assert.ok(pt && pt !== c, `${c} sem tradução`);
    assert.ok(!/_/.test(pt), `${c} → "${pt}" ainda parece chave de código`);
  }
  assert.strictEqual(traduzCategoria('categoria_futura'), 'categoria futura');
  assert.strictEqual(typeof traduzCategoria(null), 'string');
});

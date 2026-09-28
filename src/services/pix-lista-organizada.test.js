'use strict';
// pix-lista-organizada.test.js — a lista do PIX pedida no grupo sai ORGANIZADA (Alf, 28/09).
//
// O CASO: Arthur (Barra) perguntou "consigo ver o nome desses 53 alunos?" depois do relatório de
// segunda. A lista de quem falta saía como 43 linhas corridas — Pix avulso, cartão falhando,
// cadastrado sem cobrança e 🔒 tudo misturado — e sem dizer quantos já tinham ido. Ordem do dono:
// resposta do TOM no WhatsApp vem SEMPRE organizada, com hierarquia (título → resumo → seções →
// nomes), nunca parede.
//
// O QUE MUDA: cada seção (a forma de pagamento, igual à pauta das 9h) ganha cabeçalho com a
// contagem, os 🔒 vão pra uma seção própria no fim, e o topo diz "X de Y já migraram · faltam Z" e
// quantos dias faltam pra meta. Listas de anamnese/contrato e itens sem seção saem como antes.
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('./pix-consulta');
const f = require('./pix-consulta-fontes');
const { resolverUnidade } = require('./situacao-aluno');

const BARRA = resolverUnidade('barra');
const semRetry = (fn) => fn();
const ok = (data) => async () => ({ data, error: null });
const L = (o) => ({ pagador_chave: `k-${o.pagador_nome}`, alunos: [], matriculas: [1], categoria: 'migrar', fatia: 'pix_avulso', dado_atualizado_em: '2026-09-28T09:00:00Z', ...o });
const semInterruptor = async (fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  delete process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  try { return await fn(); } finally { if (antes !== undefined) process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

// ── resumoDaMigracao (puro) ────────────────────────────────────────────────────────────────────
test('resumo: "X de Y já migraram · faltam Z" e a contagem regressiva da meta', () => {
  assert.strictEqual(c.resumoDaMigracao({ migrados: 10, total: 53, hojeYmd: '2026-09-28' }),
    '✅ *10 de 53 já migraram* · faltam 43\n⏰ Faltam 33 dias pra meta de 31/10');
});
test('resumo: singular, dia da meta e meta vencida', () => {
  assert.match(c.resumoDaMigracao({ migrados: 1, total: 2, hojeYmd: '2026-10-30' }), /⏰ Falta 1 dia pra meta de 31\/10$/);
  assert.match(c.resumoDaMigracao({ migrados: 1, total: 2, hojeYmd: '2026-10-31' }), /⏰ A meta é hoje \(31\/10\)$/);
  assert.match(c.resumoDaMigracao({ migrados: 1, total: 2, hojeYmd: '2026-11-02' }), /⏰ Meta de 31\/10 vencida$/);
});
test('resumo: sem hoje válido não inventa contagem (só a linha dos números)', () => {
  assert.strictEqual(c.resumoDaMigracao({ migrados: 0, total: 5, hojeYmd: null }), '✅ *0 de 5 já migraram* · faltam 5');
});

// ── mensagensDeVariasListas com seções (puro) ─────────────────────────────────────────────────
const it = (pagador, secao, alunos = []) => ({ pagador, alunos, secao });
test('seções: cabeçalho em negrito, linha em branco entre seções, nome recuado com alunos entre parênteses', () => {
  const ms = c.mensagensDeVariasListas({
    unidadeNome: 'Barra',
    blocos: [{ titulo: 'PIX automático — quem falta migrar', substantivo: 'clientes', resumo: '✅ *1 de 4 já migraram* · faltam 3',
      itens: [it('Ana', '🔵 *Cadastrados sem cobrança* (1) — resolver primeiro', ['Rafa']), it('Bia', '🔴 *Pix avulso* (2)', ['B1', 'B2']), it('Caio', '🔴 *Pix avulso* (2)')] }],
  });
  assert.strictEqual(ms.length, 1);
  assert.strictEqual(ms[0], [
    '💠 *PIX automático — quem falta migrar — Barra* (3 clientes) — parte 1/1',
    '✅ *1 de 4 já migraram* · faltam 3',
    '',
    '🔵 *Cadastrados sem cobrança* (1) — resolver primeiro',
    '   • Ana (Rafa)',
    '',
    '🔴 *Pix avulso* (2)',
    '   • Bia (B1, B2)',
    '   • Caio',
  ].join('\n'));
});
test('seções: parte que começa no meio de uma seção repete o cabeçalho com "(continuação)"; resumo só na parte 1', () => {
  const itens = [1, 2, 3].map((i) => it(`P${i}`, '🔴 *Pix avulso* (3)'));
  const ms = c.mensagensDeVariasListas({ unidadeNome: 'Barra', limitePorMensagem: 2,
    blocos: [{ titulo: 'Pix avulso', substantivo: 'clientes', resumo: 'RESUMO', itens }] });
  assert.strictEqual(ms.length, 2);
  assert.match(ms[0], /RESUMO/);
  assert.ok(!/RESUMO/.test(ms[1]));
  assert.match(ms[1], /\n🔴 \*Pix avulso\* \(3\) _\(continuação\)_\n   • P3$/);
});
test('sem seção e sem resumo: formato IDÊNTICO ao de antes (anamnese, contrato, já migraram)', () => {
  const ms = c.mensagensDaLista({ unidadeNome: 'Barra', titulo: 'Anamnese — quem falta preencher', substantivo: 'alunos', itens: [{ pagador: 'Ana', alunos: ['Rafa'] }] });
  assert.strictEqual(ms[0], '💠 *Anamnese — quem falta preencher — Barra* (1 alunos) — parte 1/1\n• Ana — Rafa');
});

// ── mensagensDaListaPix com a fonte (integração, sem rede) ────────────────────────────────────
const FONTE = [
  L({ pagador_nome: 'Presa', fatia: 'pix_avulso', matriculas: [1, 2], alunos: ['P1', 'P2'] }),
  L({ pagador_nome: 'Zé Avulso', fatia: 'pix_avulso', alunos: ['Z1'] }),
  L({ pagador_nome: 'Cartão', fatia: 'cartao_com_falha' }),
  L({ pagador_nome: 'Cadastrada', categoria: 'autorizacao_pendente', fatia: null }),
  L({ pagador_nome: 'Já Foi', categoria: 'ja_migrou', fatia: null, migrou_em: '2026-09-20' }),
  L({ pagador_nome: 'Fora', categoria: 'nao_mexe', fatia: null }),
];
const deps = { rpcPix: ok(FONTE), rpcSituacao: ok([]), retry: semRetry, hoje: '2026-09-28' };

test('quem falta: seções na ordem da pauta (🔵 primeiro, 🔒 no fim), contagem por seção e resumo no topo', () => semInterruptor(async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix'], deps });
  const t = r.msgs.join('\n');
  assert.strictEqual(r.total, 4);
  assert.match(t, /^💠 \*PIX automático — quem falta migrar — Barra\* \(4 clientes\) — parte 1\/1\n✅ \*1 de 5 já migraram\* · faltam 4\n⏰ Faltam 33 dias pra meta de 31\/10\n/);
  const ordem = ['🔵 *Cadastrados sem cobrança* (1) — resolver primeiro', '🔴 *Pix avulso* (1)', '🟣 *Cartão falhando* (1)', '🔒 *Aguardando o Emusys* (1)'].map((h) => t.indexOf(`\n${h}`));
  assert.ok(ordem.every((i) => i > 0), `seções: ${ordem} em\n${t}`);
  assert.deepStrictEqual([...ordem].sort((a, b) => a - b), ordem);
  assert.match(t, /🔒 \*Aguardando o Emusys\* \(1\) — 2\+ cursos ou família, o Emusys ainda não libera\n   • Presa \(P1, P2\)/);
  assert.ok(!/Já Foi|Fora/.test(t));
}));
test('já migraram: mesmo resumo no topo e o MESMO formato da lista de quem falta', () => semInterruptor(async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['ja_migrou'], deps });
  assert.strictEqual(r.msgs[0], '💠 *Já migraram — Barra* (1 clientes) — parte 1/1\n✅ *1 de 5 já migraram* · faltam 4\n⏰ Faltam 33 dias pra meta de 31/10\n\n✅ *Já no PIX automático* (1)\n   • Já Foi');
}));
test('"quem já foi e quem falta": as duas listas no mesmo pedido, cada uma organizada', () => semInterruptor(async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['ja_migrou', 'pix'], deps });
  assert.strictEqual(r.msgs.length, 2);
  assert.match(r.msgs[0], /Já migraram — Barra/);
  assert.match(r.msgs[1], /quem falta migrar — Barra[\s\S]*🔴 \*Pix avulso\* \(1\)/);
}));
test('uma forma só (pix avulso): seção da forma + 🔒 separado', () => semInterruptor(async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix_avulso'], deps });
  const t = r.msgs.join('\n');
  assert.match(t, /\n🔴 \*Pix avulso\* \(1\)\n   • Zé Avulso \(Z1\)\n\n🔒 \*Aguardando o Emusys\* \(1\)/);
}));
test('itensDaLista (API pública) continua só com pagador+alunos', () => semInterruptor(async () => {
  for (const x of await f.itensDaLista({ unidadeId: BARRA, alvo: 'pix', deps })) assert.deepStrictEqual(Object.keys(x).sort(), ['alunos', 'pagador']);
}));

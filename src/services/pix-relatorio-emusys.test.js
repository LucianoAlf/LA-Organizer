'use strict';
// pix-relatorio-emusys.test.js — o relatório semanal (segunda 10h, grupo PIX AUTOMÁTICO L.A) passa
// a dizer quantos clientes estão "aguardando o Emusys" (2+ matrículas: o Emusys só liga o PIX
// automático a uma fatura). Pedido do Alf, 19/09: "sem essa linha, a meta de 31/10 parece atraso
// do time". Regra de contagem = a MESMA da pauta diária (pix-migracao.bloqueadoNoEmusys).
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('./pix-migracao');

const lr = (categoria, extra = {}) => ({ categoria, matriculas: [1], ...extra });
const preso = (extra = {}) => lr('migrar', { matriculas: [1, 2], ...extra });
const comInterruptor = async (valor, fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  process.env.TOM_PIX_BLOQUEIO_EMUSYS = valor;
  try { return await fn(); } finally { if (antes === undefined) delete process.env.TOM_PIX_BLOQUEIO_EMUSYS; else process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

// ── dadosDaUnidadeParaRelatorio ───────────────────────────────────────────────────────────────
test('dados da unidade: conta os bloqueados (só `migrar` com 2+ matrículas)', () => {
  const linhas = [
    lr('ja_migrou', { matriculas: [1, 2] }), // já migrou: não é barreira
    lr('autorizacao_pendente', { matriculas: [1, 2] }), // já cadastrado: não é barreira
    lr('migrar'), preso(), preso(), preso(),
  ];
  const d = p.dadosDaUnidadeParaRelatorio(linhas, { nome: 'Barra', hojeYmd: '2026-09-21' });
  assert.strictEqual(d.aguardandoEmusys, 3);
  assert.strictEqual(d.total, 6, 'os bloqueados continuam dentro do total — ninguém sai da conta');
  assert.strictEqual(d.migrados, 1);
});

test('dados da unidade: sem bloqueado, aguardandoEmusys = 0', () => {
  const d = p.dadosDaUnidadeParaRelatorio([lr('migrar'), lr('ja_migrou')], { nome: 'Barra', hojeYmd: '2026-09-21' });
  assert.strictEqual(d.aguardandoEmusys, 0);
});

test('dados da unidade: interruptor off zera a contagem', async () => {
  await comInterruptor('off', () => {
    const d = p.dadosDaUnidadeParaRelatorio([preso(), preso()], { nome: 'Barra', hojeYmd: '2026-09-21' });
    assert.strictEqual(d.aguardandoEmusys, 0);
  });
});

// ── relatorioSemanal ──────────────────────────────────────────────────────────────────────────
const base = (unidades) => ({ periodoBr: '14 a 20/09', hojeYmd: '2026-09-21', unidades });
const CG = { nome: 'Campo Grande', total: 226, migrados: 93, migradosNaSemana: 12, pendentesAutorizacao: 4, aguardandoEmusys: 41 };
const RE = { nome: 'Recreio', total: 76, migrados: 58, migradosNaSemana: 9, pendentesAutorizacao: 3, aguardandoEmusys: 26 };

test('relatório: linha própria com o total de bloqueados e o motivo', () => {
  const txt = p.relatorioSemanal(base([CG, RE]));
  assert.match(txt, /🔒 Aguardando o Emusys: 67 \(2\+ cursos ou família/);
  assert.match(txt, /uma fatura/);
});

test('relatório: cada unidade mostra o próprio 🔒 quando tem', () => {
  const txt = p.relatorioSemanal(base([CG, { ...RE, aguardandoEmusys: 0 }]));
  assert.match(txt, /Campo Grande .*\(93\/226\) — 12 nesta semana · 🔒 41/);
  assert.ok(!/Recreio .*🔒/.test(txt), 'unidade sem bloqueado não leva 🔒');
});

test('relatório: o "faltam" e o percentual NÃO mudam com os bloqueados (a meta é honesta)', () => {
  const com = p.relatorioSemanal(base([CG, RE]));
  const sem = p.relatorioSemanal(base([{ ...CG, aguardandoEmusys: 0 }, { ...RE, aguardandoEmusys: 0 }]));
  assert.match(com, /Geral\s+▓+░*\s+50%\s+\(151 de 302\)/);
  assert.match(com, /Ritmo: faltam 6 semanas e 151 clientes → 26 por semana\./);
  assert.strictEqual(com.match(/Ritmo:[^\n]*/)[0], sem.match(/Ritmo:[^\n]*/)[0]);
});

test('relatório: segunda linha de ritmo SEM os bloqueados — o que a equipe consegue fazer de fato', () => {
  const txt = p.relatorioSemanal(base([CG, RE]));
  assert.match(txt, /Sem os 🔒: faltam 84 clientes → 14 por semana\./);
});

test('relatório: sem nenhum bloqueado o texto é IDÊNTICO ao de antes (nada de linha nova)', () => {
  const txt = p.relatorioSemanal(base([{ ...CG, aguardandoEmusys: 0 }, { ...RE, aguardandoEmusys: undefined }]));
  assert.ok(!/🔒|Emusys|Sem os/.test(txt));
});

test('relatório: unidade sem o campo (dado antigo) não quebra nem vira NaN', () => {
  const txt = p.relatorioSemanal(base([{ nome: 'Barra', total: 100, migrados: 88, migradosNaSemana: 3, pendentesAutorizacao: 2 }]));
  assert.ok(!/NaN|undefined/.test(txt));
});

test('relatório depois da meta: a linha 🔒 continua (é justamente quando mais importa) e o texto não fala "0 semanas"', () => {
  const txt = p.relatorioSemanal({ periodoBr: '26/10 a 01/11', hojeYmd: '2026-11-02', unidades: [{ nome: 'Barra', total: 100, migrados: 88, migradosNaSemana: 3, pendentesAutorizacao: 2, aguardandoEmusys: 9 }] });
  assert.match(txt, /🔒 Aguardando o Emusys: 9/);
  assert.match(txt, /Meta de 31\/10 vencida — faltam 12 clientes\./);
  assert.ok(!txt.includes('0 semanas'));
});

test('relatório: nunca lista nomes (é placar)', () => {
  assert.ok(!/•/.test(p.relatorioSemanal(base([CG, RE]))));
});

// ── ritmoDaEquipe: o alerta de ritmo compara a equipe com o que ELA controla ─────────────────
test('ritmoDaEquipe: usa "faltam" sem os bloqueados', () => {
  // faltam 151 no geral, 67 bloqueados -> 84 livres; 6 semanas até 31/10 -> 14 por semana
  assert.strictEqual(p.ritmoDaEquipe({ unidades: [CG, RE], hojeYmd: '2026-09-21' }).porSemana, 14);
});

test('ritmoDaEquipe: sem bloqueado é idêntico ao ritmo de sempre', () => {
  const us = [{ ...CG, aguardandoEmusys: 0 }, { ...RE, aguardandoEmusys: 0 }];
  assert.strictEqual(p.ritmoDaEquipe({ unidades: us, hojeYmd: '2026-09-21' }).porSemana,
    p.ritmoNecessario({ faltam: 151, hojeYmd: '2026-09-21' }).porSemana);
});

test('ritmoDaEquipe: bloqueado maior que o faltam (dado torto) nunca dá ritmo negativo', () => {
  const r = p.ritmoDaEquipe({ unidades: [{ nome: 'X', total: 10, migrados: 8, migradosNaSemana: 0, pendentesAutorizacao: 0, aguardandoEmusys: 99 }], hojeYmd: '2026-09-21' });
  assert.ok(r.porSemana >= 0);
});

// ── ligação no dispatcher (âncora de código) ──────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const disp = fs.readFileSync(path.join(__dirname, '..', 'rituals', 'dispatcher.js'), 'utf8');
test('dispatcher: o ritmo do alerta e do marcador sai de ritmoDaEquipe (não do faltam bruto)', () => {
  assert.match(disp, /const ritmoAtual = _pixPura\.ritmoDaEquipe\(\{ unidades, hojeYmd: now\.ymd \}\)\.porSemana;/);
  assert.ok(!/const ritmoAtual = _pixPura\.ritmoNecessario\(/.test(disp));
});

'use strict';
// Segunda seção do relatório das 07h: "o que foi FEITO e o que REINCIDIU".
//
// Por que existe: até 09/08 o relatório só dizia o que está QUEBRADO. Com o agente de
// governança no ar, metade da história passou a ser o que já foi consertado — e, mais
// importante, o que voltou depois de consertado. Sem a segunda metade, o Alf e o Hugo leem
// "3 alertas" todo dia e não têm como saber se o sistema está melhorando ou andando em círculo.
//
// A linha que mais importa é a de reincidência: ela é o velocímetro do próprio agente.

const test = require('node:test');
const assert = require('node:assert');
const { formatarResumoGovernanca } = require('./governanca-resumo');

const PLACAR_LIMPO = { fechados: 2, reincidentes: [], emParada: [], taxa: 0 };

test('rodada com correção e varredura mostra as duas coisas', () => {
  const s = formatarResumoGovernanca({
    cicloRodou: true,
    correcoes: [{ codigo: 'FATURA-ACK-FORA-DO-HISTORICO' }],
    achadosFechados: 47,
    placar: PLACAR_LIMPO,
  });
  assert.match(s, /FATURA-ACK-FORA-DO-HISTORICO/);
  assert.match(s, /47/);
  assert.match(s, /reincid/i);
});

// O caso mais valioso do relatório: o agente parou de rodar e ninguém percebeu.
test('ciclo que NÃO rodou vira alerta explícito, não omissão', () => {
  const s = formatarResumoGovernanca({ cicloRodou: false, correcoes: [], achadosFechados: 0, placar: PLACAR_LIMPO });
  assert.match(s, /n[ãa]o rodou/i);
  assert.match(s, /⚠️|🔴/);
});

test('reincidência aparece em DESTAQUE, com o código e as vezes', () => {
  const s = formatarResumoGovernanca({
    cicloRodou: true, correcoes: [], achadosFechados: 3,
    placar: { fechados: 5, reincidentes: [{ codigo: 'FOO-BAR', vezes: 2 }], emParada: ['FOO-BAR'], taxa: 0.2 },
  });
  assert.match(s, /FOO-BAR/);
  assert.match(s, /2x/);
  assert.match(s, /parada/i);
});

// Refutar é entrega — o relatório não pode fazer parecer que o dia foi perdido.
test('rodada só de refutação não é relatada como fracasso', () => {
  const s = formatarResumoGovernanca({ cicloRodou: true, correcoes: [], achadosFechados: 12, placar: PLACAR_LIMPO });
  assert.match(s, /12/);
  assert.doesNotMatch(s, /nada foi feito|sem resultado|falhou/i);
});

test('rodou e realmente não fez nada: diz isso sem inventar número', () => {
  const s = formatarResumoGovernanca({ cicloRodou: true, correcoes: [], achadosFechados: 0, placar: PLACAR_LIMPO });
  assert.ok(s.length > 0);
  assert.doesNotMatch(s, /undefined|NaN|null/);
  assert.doesNotMatch(s, /\b0 achados? antigos? fechados?/i, 'não poluir com zero');
});

test('sem dados (consulta falhou) a seção some — nunca quebra o relatório', () => {
  assert.strictEqual(formatarResumoGovernanca(null), '');
  assert.strictEqual(formatarResumoGovernanca(undefined), '');
});

test('entrada degenerada não imprime lixo', () => {
  const s = formatarResumoGovernanca({ cicloRodou: true, correcoes: null, achadosFechados: null, placar: null });
  assert.doesNotMatch(s, /undefined|NaN|null/);
});

test('mais de 2 correções não vira parede — resume', () => {
  const s = formatarResumoGovernanca({
    cicloRodou: true,
    correcoes: [{ codigo: 'A-UM' }, { codigo: 'B-DOIS' }, { codigo: 'C-TRES' }, { codigo: 'D-QUATRO' }],
    achadosFechados: 0, placar: PLACAR_LIMPO,
  });
  assert.ok(s.split('\n').length <= 6, `seção longa demais:\n${s}`);
  assert.match(s, /A-UM/);
});

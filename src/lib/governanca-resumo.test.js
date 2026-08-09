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

// ── SÓ CONTA O QUE É DO AGENTE (bug meu, pego na verificação contra produção) ───────────────
// A 1ª versão contava TODO finding com verified_at nas últimas 24h. No banco real isso deu 83
// — mas 35 eram fechamentos MEUS, à mão, na auditoria de 08/08. A seção creditava ao agente o
// trabalho do humano, que é exatamente o que a marca de autoria existe pra impedir (o placar
// já filtrava os KIs; eu não apliquei o mesmo aos findings).
const { carregarResumoGovernanca } = require('./governanca-resumo');

function sbFalso({ kis = [], findings24h = [], kis90 = [], findings90 = [], rodou = true } = {}) {
  const mk = (data) => {
    const o = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'not', 'ilike']) o[m] = () => o;
    o.then = (ok) => ok({ data, error: null });
    return o;
  };
  let chamadaFindings = 0;
  return {
    from: (t) => {
      if (t === 'ritual_logs') return mk(rodou ? [{ id: 'x' }] : []);
      if (t === 'tom_known_issues') return mk(chamadaKis++ === 0 ? kis : kis90);
      chamadaFindings += 1;
      return mk(chamadaFindings === 1 ? findings24h : findings90);
    },
  };
  function chamadaKisInit() {}
}
let chamadaKis = 0;

test('a varredura conta SÓ o que tem a marca do agente', async () => {
  chamadaKis = 0;
  const sb = sbFalso({
    kis: [],
    kis90: [],
    findings24h: [
      { id: 1, verified_note: '[gov-agent 09/08] refutado por execução' },
      { id: 2, verified_note: '[gov-agent] já corrigido' },
      { id: 3, verified_note: 'fechei na mão durante a auditoria' },   // meu
      { id: 4, verified_note: null },                                   // sem nota
    ],
    findings90: [],
  });
  const d = await carregarResumoGovernanca(sb, { ymd: '2026-08-09' });
  assert.strictEqual(d.achadosFechados, 2, 'contou fechamento humano como se fosse do agente');
});

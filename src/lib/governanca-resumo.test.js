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
  assert.match(s, /n[ãa]o rod/i);
  assert.match(s, /⚠️|🔴/);
});

// ── GOVRESUMO-CICLO-ALARME-FALSO (10/08) ───────────────────────────────────────────────────
// O relatório sai às 07:00; o ciclo dispara às 08:00 (dispatcher, GOV_AGENT_TIME). A 1ª versão
// perguntava "rodou HOJE?" — pergunta que às 07:00 é impossível responder sim. Estreou em
// 10/08 gritando "não rodou" com o ciclo de ontem tendo rodado às 08:21, e ia repetir todo dia.
// Alarme falso diário não é um bug pequeno: ele treina quem lê a ignorar a linha que existe
// justamente pro dia em que o ciclo REALMENTE parar.
//
// A pergunta certa é "está rodando?", medida em dia civil: hoje ou ontem = saudável.
// Dia civil, e não "últimas N horas", porque a janela de retry vai até 12h — com limite em
// horas o mesmo ciclo saudável passa ou não dependendo da hora em que o relatório sair.
test('ciclo que rodou ONTEM não vira alarme (o relatório das 07h é anterior ao ciclo das 08h)', () => {
  const s = formatarResumoGovernanca({
    cicloRodou: true, correcoes: [], achadosFechados: 5, placar: PLACAR_LIMPO,
  });
  assert.doesNotMatch(s, /n[ãa]o rod/i);
  assert.match(s, /5/);
});

test('parada real diz DESDE QUANDO — número, não adjetivo', () => {
  const s = formatarResumoGovernanca({
    cicloRodou: false, ultimoCicloYmd: '2026-08-07', hojeYmd: '2026-08-10',
    correcoes: [], achadosFechados: 0, placar: PLACAR_LIMPO,
  });
  assert.match(s, /07\/08/, 'sem a data, ninguém sabe se é de hoje ou de um mês atrás');
  assert.match(s, /3 dias/);
  assert.match(s, /⚠️|🔴/);
});

test('agente que nunca rodou não vira "há NaN dias"', () => {
  const s = formatarResumoGovernanca({
    cicloRodou: false, ultimoCicloYmd: null, hojeYmd: '2026-08-10',
    correcoes: [], achadosFechados: 0, placar: PLACAR_LIMPO,
  });
  assert.doesNotMatch(s, /undefined|NaN|null|Invalid/);
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

// `ciclos` = reference_date das rodadas do gov_agent, da mais recente pra mais antiga
// (é o que a consulta real devolve: order by created_at desc).
function sbFalso({ kis = [], findings24h = [], kis90 = [], findings90 = [], ciclos = ['2026-08-09'] } = {}) {
  const mk = (data) => {
    const o = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'not', 'ilike']) o[m] = () => o;
    o.then = (ok) => ok({ data, error: null });
    return o;
  };
  let chamadaFindings = 0;
  return {
    from: (t) => {
      if (t === 'ritual_logs') return mk(ciclos.map((d) => ({ reference_date: d })));
      if (t === 'tom_known_issues') return mk(chamadaKis++ === 0 ? kis : kis90);
      chamadaFindings += 1;
      return mk(chamadaFindings === 1 ? findings24h : findings90);
    },
  };
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

// A raiz do GOVRESUMO-CICLO-ALARME-FALSO mora AQUI, não na formatação: a consulta filtrava por
// reference_date = hoje. Cenário real de 10/08 07:00 — último ciclo em 09/08 08:21, nenhum hoje.
test('ciclo de ontem conta como saudável — o de hoje ainda nem tinha hora de rodar', async () => {
  chamadaKis = 0;
  const d = await carregarResumoGovernanca(sbFalso({ ciclos: ['2026-08-09'] }), { ymd: '2026-08-10' });
  assert.strictEqual(d.cicloRodou, true, 'alarme falso: acusou parada com o ciclo de ontem no lugar');
  assert.strictEqual(d.ultimoCicloYmd, '2026-08-09');
});

test('dois dias sem rodar é parada de verdade — e aí o alarme TEM que soar', async () => {
  chamadaKis = 0;
  const d = await carregarResumoGovernanca(sbFalso({ ciclos: ['2026-08-08'] }), { ymd: '2026-08-10' });
  assert.strictEqual(d.cicloRodou, false);
  assert.strictEqual(d.ultimoCicloYmd, '2026-08-08');
});

test('rodou hoje também é saudável (relatório relido depois das 08h)', async () => {
  chamadaKis = 0;
  const d = await carregarResumoGovernanca(sbFalso({ ciclos: ['2026-08-10', '2026-08-09'] }), { ymd: '2026-08-10' });
  assert.strictEqual(d.cicloRodou, true);
  assert.strictEqual(d.ultimoCicloYmd, '2026-08-10');
});

test('sem nenhuma rodada registrada: para, sem data e sem lixo', async () => {
  chamadaKis = 0;
  const d = await carregarResumoGovernanca(sbFalso({ ciclos: [] }), { ymd: '2026-08-10' });
  assert.strictEqual(d.cicloRodou, false);
  assert.strictEqual(d.ultimoCicloYmd, null);
});

// ── GOVRESUMO-JANELA-ROTULO-ENGANA (14/08/2026) ──────────────────────────────────────
// A DM das 07h dizia "Governança (24h)" e o Alf leu como "o ciclo de hoje". Mas a janela é
// ROLANTE: às 07:00 ela cobre ontem-07:00 → hoje-07:00, e o ciclo de hoje só roda às 08:00.
// Resultado: o relatório das 07h de 14/08 anunciou `TASK-COMPLETE-ALVO-NAO-ACHADO` como
// correção do dia — era a de 13/08 — enquanto o grupo, às 08:00, anunciou a de verdade
// (`SKILL-ROUTER-QUOTE-CONTAMINATION`). Dois relatórios do mesmo sistema se contradizendo.
//
// Irmão do GOVRESUMO-CICLO-ALARME-FALSO: lá a janela do produtor não era a do consumidor na
// hora de dizer "não rodou"; aqui é na hora de dizer "o que rodou". Mesma raiz, outro lado.
//
// A correção é o RÓTULO, não a janela: datar o que está sendo mostrado. Quem lê descobre
// sozinho que é o ciclo de ontem.
test('cabeçalho leva a DATA do ciclo mostrado, não "24h"', () => {
  const txt = formatarResumoGovernanca({
    cicloRodou: true, hojeYmd: '2026-08-14', ultimoCicloYmd: '2026-08-13',
    correcoes: [{ codigo: 'TASK-COMPLETE-ALVO-NAO-ACHADO', corrigido_em: '2026-08-13T11:20:00Z' }],
    achadosFechados: 7,
  });
  assert.match(txt, /Governança — ciclo de 13\/08/);
  assert.doesNotMatch(txt, /\(24h\)/);
});

test('sem correções, o rótulo não inventa data', () => {
  const txt = formatarResumoGovernanca({
    cicloRodou: true, hojeYmd: '2026-08-14', ultimoCicloYmd: '2026-08-14',
    correcoes: [], achadosFechados: 0,
  });
  assert.match(txt, /Governança/);
  assert.doesNotMatch(txt, /ciclo de undefined|ciclo de NaN/);
});

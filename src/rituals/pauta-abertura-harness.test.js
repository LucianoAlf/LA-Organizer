'use strict';
// Harness da AMARRA DE HORARIO da fala de abertura, dentro do dispatcher.
//
// POR QUE ELE EXISTE. A tabela de horarios e testavel sozinha (services/anamnese-pauta.test.js).
// O que ela NAO alcanca e a fiacao: se o dispatcher continuar lendo um mapa fixo de dia util, a
// tabela nova pode estar perfeita e o sabado continuar quebrado — o teste da tabela fica verde e
// a Barra recebe a pauta as 09:00 com a equipe em pe desde as 08:00.
//
// COMO ELE FUNCIONA. Le o dispatcher instalado e recorta VERBATIM as linhas que decidem (1) se o
// slot de agora e hora de alguma unidade falar e (2) qual e a hora daquela unidade. Roda esse
// mesmo texto contra o modulo puro REAL — nenhum horario e redigitado aqui.
//
// NAO TOCA O BANCO: nada alem da tabela pura entra nesta rodada.
//
// RODAR SO ELE:  node --test src/rituals/pauta-abertura-harness.test.js

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test } = require('node:test');

const DISPATCHER = path.join(__dirname, 'dispatcher.js');
const FONTE = fs.readFileSync(DISPATCHER, 'utf8');
const LINHAS = FONTE.split('\n');

function acharUnica(pred, nome) {
  const casos = [];
  for (let i = 0; i < LINHAS.length; i += 1) if (pred(LINHAS[i], i)) casos.push(i);
  if (!casos.length) throw new Error(`[harness] nao achei "${nome}" em dispatcher.js`);
  if (casos.length > 1) {
    throw new Error(`[harness] a ancora "${nome}" casou ${casos.length} vezes `
      + `(linhas ${casos.map((i) => i + 1).join(', ')}) — ancora ambigua nao prova nada`);
  }
  return casos[0];
}

function recortarFuncao(nome) {
  const ini = acharUnica((l) => l === `function ${nome}(t) {`, nome);
  const fim = LINHAS.findIndex((l, i) => i > ini && l === '}');
  return LINHAS.slice(ini, fim + 1).join('\n');
}

const fnTimeToSlot = recortarFuncao('timeToSlot');

// As TRES linhas que preparam a decisao, verbatim do arquivo que roda em producao.
const iRequire = acharUnica((l) => l.startsWith('  const _pautaAbertura = require('), 'require do modulo puro');
const iDia = acharUnica((l) => l.startsWith('  const _pautaDiaSemana ='), 'dia da semana do dia de hoje');
const iHoras = acharUnica((l) => l.startsWith('  const _pautaHorasAbertura ='), 'horarios de abertura do dia');
const PREPARO = [LINHAS[iRequire], LINHAS[iDia], LINHAS[iHoras]].join('\n');

// A CONDICAO do `if` da fala, verbatim: e ela que decide se o bloco abre neste slot.
const iGate = acharUnica((l) => l.startsWith("  if (opts.force === 'pauta_anamnese_fala'"), 'gate do bloco da fala');
const GATE = LINHAS.slice(iGate, iGate + 2).join('\n').trim();
if (!GATE.startsWith('if (') || !GATE.endsWith(') {')) {
  throw new Error(`[harness] o gate da fala mudou de forma e o recorte deixou de valer: ${GATE}`);
}
const CONDICAO = GATE.slice('if ('.length, -') {'.length);

// A linha que escolhe a hora DAQUELA unidade, verbatim.
const iHora = acharUnica((l) => l.startsWith('        const horaDaFala ='), 'hora da fala da unidade');
const LINHA_HORA = LINHAS[iHora].trim();

const NOMES = { 'u-recreio': 'Recreio', 'u-barra': 'Barra', 'u-cg': 'Campo Grande' };
const situAl = { nomeDaUnidade: (id) => NOMES[id] || id };
// O `require` que o trecho enxerga devolve o modulo puro REAL — a tabela sob teste e a de verdade.
const requireFake = (nome) => {
  if (nome === '../services/anamnese-pauta') return require('../services/anamnese-pauta');
  throw new Error(`[harness] o trecho pediu um modulo que o harness nao conhece: ${nome}`);
};

// eslint-disable-next-line no-new-func
const rodar = new Function('opts', 'now', 'slotNow', 'require', 'situAl', `
${fnTimeToSlot}
${PREPARO}
const abre = (${CONDICAO});
const porUnidade = {};
for (const unidadeId of ['u-recreio', 'u-barra', 'u-cg']) {
  ${LINHA_HORA}
  porUnidade[situAl.nomeDaUnidade(unidadeId)] = horaDaFala;
}
return { abre, diaSemana: _pautaDiaSemana, horas: _pautaHorasAbertura, porUnidade };
`);

const slot = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + Math.floor(m / 15) * 15; };
const tick = (ymd, hhmm) => rodar({ force: null }, { ymd }, slot(hhmm), requireFake, situAl);

// 2026-09-04 e uma SEXTA; 2026-09-05 um SABADO; 2026-09-06 um DOMINGO.
const SEXTA = '2026-09-04';
const SABADO = '2026-09-05';
const DOMINGO = '2026-09-06';

test('abertura no dispatcher: DIA UTIL segue como antes — Recreio 08, Barra 09, Campo Grande 10', () => {
  assert.deepStrictEqual(tick(SEXTA, '08:00').porUnidade,
    { Recreio: '08:00', Barra: '09:00', 'Campo Grande': '10:00' });
  for (const h of ['08:00', '09:00', '10:00']) {
    assert.strictEqual(tick(SEXTA, h).abre, true, `o bloco tem que abrir as ${h} numa sexta`);
  }
  assert.strictEqual(tick(SEXTA, '07:30').abre, false, '07:30 era hora de ninguem — e continua nao sendo');
  assert.strictEqual(tick(SEXTA, '11:00').abre, false);
});

test('abertura no dispatcher: no SABADO as tres unidades abrem as 08:00', () => {
  assert.deepStrictEqual(tick(SABADO, '08:00').porUnidade,
    { Recreio: '08:00', Barra: '08:00', 'Campo Grande': '08:00' },
    'a equipe inteira chega as 08:00 no sabado');
  assert.strictEqual(tick(SABADO, '08:00').abre, true);
  assert.strictEqual(tick(SABADO, '09:00').abre, false,
    'no sabado as 09:00 nao pode abrir de novo: a Barra ja falou as 08:00');
  assert.strictEqual(tick(SABADO, '10:00').abre, false,
    'e o Campo Grande as 10:00 seria duas horas depois de a equipe chegar');
});

test('abertura no dispatcher: DOMINGO nao abre em nenhum slot do dia', () => {
  const r = tick(DOMINGO, '08:00');
  assert.deepStrictEqual(r.horas, [], 'domingo nao tem aula — conferido na fonte, zero aulas nas tres unidades');
  assert.deepStrictEqual(r.porUnidade, { Recreio: null, Barra: null, 'Campo Grande': null });
  for (let h = 0; h < 24; h += 1) {
    assert.strictEqual(tick(DOMINGO, `${String(h).padStart(2, '0')}:00`).abre, false, `abriu as ${h}h de um domingo`);
  }
});

test('abertura no dispatcher: o dia da semana sai em BRT, nunca da hora local do processo', () => {
  const tzOriginal = process.env.TZ;
  try {
    process.env.TZ = 'America/Sao_Paulo';
    assert.strictEqual(new Date(SABADO).getDay(), 5,
      'a forma proibida le o sabado como sexta — e por isso que ela e proibida (LOCALYMD-UTC-SHIFT)');
    const r = tick(SABADO, '08:00');
    assert.strictEqual(r.diaSemana, 6, 'o dispatcher continua vendo sabado');
    assert.strictEqual(r.porUnidade.Barra, '08:00',
      'num processo em BRT a forma proibida devolveria 09:00 e a Barra falaria uma hora atrasada');
  } finally {
    if (tzOriginal === undefined) delete process.env.TZ; else process.env.TZ = tzOriginal;
  }
  // So linhas de CODIGO: o comentario do bloco cita a forma proibida justamente pra ensinar por
  // que ela e proibida, e um grep cru transformaria essa explicacao em falha eterna.
  const codigoComDataCrua = LINHAS.filter((l) => !l.trim().startsWith('//') && /new Date\(now\.ymd\)/.test(l));
  assert.deepStrictEqual(codigoComDataCrua, [],
    'ninguem pode ler o dia da semana com new Date(ymd).getDay() neste arquivo');
});

test('abertura no dispatcher: o mapa fixo de dia util NAO existe mais no arquivo', () => {
  assert.ok(!FONTE.includes('PAUTA_ANAMNESE_FALA_POR_UNIDADE'),
    'uma constante morta e pior que nenhuma: alguem le o valor errado e acha que sabe o horario');
});

test('abertura no dispatcher: sob --force a fala sai fora do slot, como nos outros blocos', () => {
  const r = rodar({ force: 'pauta_anamnese_fala' }, { ymd: SEXTA }, slot('14:00'), requireFake, situAl);
  assert.strictEqual(r.abre, true);
});

test('abertura no dispatcher: o harness nao toca o banco — nenhum node_modules foi carregado', () => {
  const deFora = Object.keys(require.cache).filter((k) => k.includes('node_modules'));
  assert.deepStrictEqual(deFora, [],
    `qualquer client aqui vira conexao com PRODUCAO a cada rodada de teste (${deFora.join(', ')})`);
});

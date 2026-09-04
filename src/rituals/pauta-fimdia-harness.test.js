'use strict';
// Harness da AMARRA DE HORARIO do relatorio de FIM DE DIA, dentro do dispatcher.
//
// POR QUE ELE EXISTE. Mesmo motivo do irmao dele (pauta-abertura-harness.test.js): a tabela de
// horarios e testavel sozinha em services/anamnese-pauta.test.js, mas o que ela NAO alcanca e a
// fiacao. Se o dispatcher continuar lendo um mapa fixo de dia util, a tabela nova pode estar
// perfeita e o sabado continuar quebrado — o teste da tabela fica verde e o relatorio da Barra
// sai as 19:30 de um sabado, quatro horas depois de a escola fechar.
//
// COMO ELE FUNCIONA. Le o dispatcher instalado e recorta VERBATIM as linhas que decidem (1) se o
// slot de agora e hora de alguma unidade relatar e (2) qual e a hora daquela unidade. Roda esse
// mesmo texto contra o modulo puro REAL — nenhum horario e redigitado aqui.
//
// NAO TOCA O BANCO: nada alem da tabela pura entra nesta rodada.
//
// RODAR SO ELE:  node --test src/rituals/pauta-fimdia-harness.test.js

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

// As linhas que preparam a decisao, verbatim do arquivo que roda em producao. O `require` do
// modulo puro e o dia da semana sao os MESMOS da abertura — o relatorio da noite nao pode ler um
// dia da semana diferente do que a fala da manha leu, no mesmo tick. As constantes de teto moram
// no topo do modulo (fora do bloco) e entram aqui pelo mesmo motivo: verbatim, nunca redigitadas.
const iRequire = acharUnica((l) => l.startsWith('  const _pautaAbertura = require('), 'require do modulo puro');
const iDia = acharUnica((l) => l.startsWith('  const _pautaDiaSemana ='), 'dia da semana do dia de hoje');
const iHoras = acharUnica((l) => l.startsWith('  const _pautaHorasFimDia ='), 'horarios de fim de dia do dia');
const LINHAS_TETO = LINHAS.filter((l) => /^const PAUTA_ANAMNESE_FIMDIA_(JANELA_MIN|TETO) = /.test(l));
const PREPARO = [...LINHAS_TETO, LINHAS[iRequire], LINHAS[iDia], LINHAS[iHoras]].join('\n');

// A CONDICAO do `if` do fim de dia, verbatim: e ela que decide se o bloco abre neste slot. O
// recorte vai ate a linha que FECHA o `if` — a condicao virou multi-linha quando o bloco deixou de
// abrir num instante e passou a abrir numa janela, e um recorte de tamanho fixo (`iGate + 2`)
// provaria meia condicao.
const iGate = acharUnica((l) => l.startsWith("  if (opts.force === 'pauta_anamnese_fimdia'"), 'gate do bloco de fim de dia');
const iGateFim = LINHAS.findIndex((l, i) => i >= iGate && l.endsWith(') {'));
if (iGateFim < 0 || iGateFim - iGate > 8) {
  throw new Error('[harness] nao achei o fecho do `if` do fim de dia perto da abertura dele');
}
const GATE = LINHAS.slice(iGate, iGateFim + 1).join('\n').trim();
if (!GATE.startsWith('if (') || !GATE.endsWith(') {')) {
  throw new Error(`[harness] o gate do fim de dia mudou de forma e o recorte deixou de valer: ${GATE}`);
}
const CONDICAO = GATE.slice('if ('.length, -') {'.length);

// A linha que escolhe a hora DAQUELA unidade, verbatim.
const iHora = acharUnica((l) => l.startsWith('        const horaDoFecho ='), 'hora do fecho da unidade');
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
  porUnidade[situAl.nomeDaUnidade(unidadeId)] = horaDoFecho;
}
return { abre, diaSemana: _pautaDiaSemana, horas: _pautaHorasFimDia, porUnidade };
`);

const slot = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + Math.floor(m / 15) * 15; };
const tick = (ymd, hhmm) => rodar({ force: null }, { ymd }, slot(hhmm), requireFake, situAl);

// 2026-09-04 e uma SEXTA; 2026-09-05 um SABADO; 2026-09-06 um DOMINGO.
const SEXTA = '2026-09-04';
const SABADO = '2026-09-05';
const DOMINGO = '2026-09-06';

test('fim de dia no dispatcher: DIA UTIL segue como antes — Barra 19:30, Recreio e CG 20:30', () => {
  assert.deepStrictEqual(tick(SEXTA, '19:30').porUnidade,
    { Recreio: '20:30', Barra: '19:30', 'Campo Grande': '20:30' });
  for (const h of ['19:30', '20:30']) {
    assert.strictEqual(tick(SEXTA, h).abre, true, `o bloco tem que abrir as ${h} numa sexta`);
  }
  assert.strictEqual(tick(SEXTA, '14:30').abre, false, 'o horario de sabado nao vale na sexta');
  assert.strictEqual(tick(SEXTA, '15:30').abre, false);
  assert.strictEqual(tick(SEXTA, '23:00').abre, false, 'as 23:00 e o fechamento, outro bloco');
});

test('fim de dia no dispatcher: no SABADO sai cedo — Barra 15:30, Recreio e CG 14:30', () => {
  assert.deepStrictEqual(tick(SABADO, '14:30').porUnidade,
    { Recreio: '14:30', Barra: '15:30', 'Campo Grande': '14:30' },
    'meia hora depois da ultima aula de sabado, com a equipe ainda na casa');
  assert.strictEqual(tick(SABADO, '14:30').abre, true);
  assert.strictEqual(tick(SABADO, '15:30').abre, true, 'a Barra fala no slot dela');
  assert.strictEqual(tick(SABADO, '19:30').abre, false,
    'no sabado as 19:30 a escola esta fechada ha horas — o relatorio nao pode sair');
  assert.strictEqual(tick(SABADO, '20:30').abre, false);
});

test('fim de dia no dispatcher: DOMINGO nao relata em nenhum slot do dia', () => {
  const r = tick(DOMINGO, '19:30');
  assert.deepStrictEqual(r.horas, [], 'domingo nao tem aula — conferido na fonte, zero aulas nas tres unidades');
  assert.deepStrictEqual(r.porUnidade, { Recreio: null, Barra: null, 'Campo Grande': null });
  for (let h = 0; h < 24; h += 1) {
    for (const mm of ['00', '30']) {
      assert.strictEqual(tick(DOMINGO, `${String(h).padStart(2, '0')}:${mm}`).abre, false,
        `abriu as ${h}:${mm} de um domingo`);
    }
  }
});

test('fim de dia no dispatcher: o dia da semana sai em BRT, nunca da hora local do processo', () => {
  const tzOriginal = process.env.TZ;
  try {
    process.env.TZ = 'America/Sao_Paulo';
    assert.strictEqual(new Date(SABADO).getDay(), 5,
      'a forma proibida le o sabado como sexta — e por isso que ela e proibida (LOCALYMD-UTC-SHIFT)');
    const r = tick(SABADO, '15:30');
    assert.strictEqual(r.diaSemana, 6, 'o dispatcher continua vendo sabado');
    assert.strictEqual(r.porUnidade.Barra, '15:30',
      'num processo em BRT a forma proibida devolveria 19:30 e a Barra relataria pra casa vazia');
  } finally {
    if (tzOriginal === undefined) delete process.env.TZ; else process.env.TZ = tzOriginal;
  }
});

test('fim de dia no dispatcher: o mapa fixo de dia util NAO existe mais no arquivo', () => {
  assert.ok(!FONTE.includes('PAUTA_ANAMNESE_FIMDIA_POR_UNIDADE'),
    'uma constante morta e pior que nenhuma: alguem le o valor errado e acha que sabe o horario');
});

test('fim de dia no dispatcher: sob --force o relatorio sai fora do slot, como nos outros blocos', () => {
  const r = rodar({ force: 'pauta_anamnese_fimdia' }, { ymd: SEXTA }, slot('14:00'), requireFake, situAl);
  assert.strictEqual(r.abre, true);
});

test('fim de dia no dispatcher: o harness nao toca o banco — nenhum node_modules foi carregado', () => {
  const deFora = Object.keys(require.cache).filter((k) => k.includes('node_modules'));
  assert.deepStrictEqual(deFora, [],
    `qualquer client aqui vira conexao com PRODUCAO a cada rodada de teste (${deFora.join(', ')})`);
});

test('fim de dia no dispatcher: o bloco fica ABERTO depois da hora da unidade, ate o teto', () => {
  // Conserto 04/09 a noite. Antes, o bloco abria em UM slot: a fonte caiu dentro do slot da Barra,
  // saiu o "nao consegui conferir", e quando ela voltou dez minutos depois nao havia mais tick
  // nenhum olhando. Quem decide se ainda ha o que fazer passou a ser a guarda de conteudo la
  // dentro; o relogio so define ate quando vale a pena perguntar.
  for (const h of ['19:30', '19:45', '20:00', '21:00', '21:30']) {
    assert.strictEqual(tick(SEXTA, h).abre, true, `o bloco tem que continuar aberto as ${h} (Barra insistindo)`);
  }
  // 21:45 ja passou da janela da Barra (19:30 + 2h), mas o Recreio (20:30) ainda esta dentro da
  // dele — o bloco abre por causa dele, e e a amarra POR UNIDADE (testada no harness de envio) que
  // impede a Barra de falar fora de hora.
  assert.strictEqual(tick(SEXTA, '22:00').abre, true, 'ultimo slot do teto absoluto');
  assert.strictEqual(tick(SEXTA, '22:15').abre, false, 'passou do teto: ninguem mais tenta hoje');
  assert.strictEqual(tick(SEXTA, '22:45').abre, false);
  assert.strictEqual(tick(SEXTA, '23:00').abre, false,
    'as 23:00 e o fechamento, que rele a fonte e decide o dia — o relatorio nao pode atropela-lo');
  // No sabado a janela anda com a hora de sabado: a Barra para as 17:30, nao as 22:00.
  assert.strictEqual(tick(SABADO, '16:30').abre, true);
  assert.strictEqual(tick(SABADO, '17:30').abre, true, 'ultimo slot da janela da Barra no sabado');
  assert.strictEqual(tick(SABADO, '17:45').abre, false,
    'depois disso a escola esta vazia — o teto relativo existe pra isso, o absoluto sozinho deixaria passar');
});

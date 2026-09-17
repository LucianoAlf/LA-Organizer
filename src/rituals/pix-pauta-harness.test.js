'use strict';
// Harness da PAUTA DO PIX AUTOMATICO dentro do dispatcher (Tarefa 5 do plano de migracao para o
// PIX automatico).
//
// POR QUE ELE EXISTE. horaDaPautaPix (services/pix-migracao.js) e testavel sozinha, mas isso nao
// alcanca a FIACAO: se o dispatcher continuar lendo o mapa errado, ou esquecer
// LEMBRETE_UNICO_POR_UNIDADE, ou recalcular o dia da semana por conta propria, a funcao pura pode
// estar perfeita e a Barra receber a pauta do PIX na hora errada mesmo assim — o teste da funcao
// fica verde e o grupo real recebe a mensagem fora de hora.
//
// COMO ELE FUNCIONA. Le o dispatcher instalado e recorta VERBATIM as linhas que decidem (1) se o
// slot de agora e hora de alguma unidade publicar e (2) qual e a hora daquela unidade. Roda esse
// mesmo texto contra os modulos puros REAIS (anamnese-pauta.js e pix-migracao.js) — nenhum
// horario e redigitado aqui.
//
// TAMBEM PROVA, lendo o texto instalado (nao reimplementando): que a idempotencia usa marcador
// PROPRIO (PAUTA_PIX, nunca PAUTA_ANAMNESE, e vice-versa); que a publicacao vai por
// group_chat_messages e nunca por whatsapp.sendMessage; que a guarda de duplicata por cabecalho
// esta no bloco; que 'pauta_pix' entrou na whitelist do --force; e que o bloco mora ENTRE a fala
// de abertura e o lembrete horario, como o plano pediu.
//
// NAO TOCA O BANCO nem manda WhatsApp: so le texto e roda a decisao pura.
//
// RODAR SO ELE:  node --test src/rituals/pix-pauta-harness.test.js

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

// _pautaAbertura e _pautaDiaSemana sao declarados UMA vez no dispatcher, antes do bloco da fala
// de abertura da anamnese, e reaproveitados pelo bloco do pix — o plano manda reaproveitar, nao
// redigitar. Recorta as mesmas duas linhas que o harness da abertura recorta.
const iRequireAnamnese = acharUnica((l) => l.startsWith('  const _pautaAbertura = require('), 'require do modulo puro da anamnese');
const iDiaSemana = acharUnica((l) => l.startsWith('  const _pautaDiaSemana ='), 'dia da semana do dia de hoje');
const PREPARO_ANAMNESE = [LINHAS[iRequireAnamnese], LINHAS[iDiaSemana]].join('\n');

// As linhas do bloco do pix que decidem O SLOT, verbatim.
const iPixRequire = acharUnica((l) => l.startsWith('  const _pixPura = require('), 'require do modulo puro do pix');
const iPixNomes = acharUnica((l) => l.startsWith('  const _pixNomesDeUnidade ='), 'nomes das unidades do pix');
const iPixHoraFnIni = acharUnica((l) => l.startsWith('  const _pixHoraDaUnidadeNome ='), 'funcao da hora por unidade');
const iPixHoraFnFim = LINHAS.findIndex((l, i) => i > iPixHoraFnIni && l.trim() === '});');
if (iPixHoraFnFim === -1) throw new Error('[harness] nao achei o fechamento de _pixHoraDaUnidadeNome');
const iPixHorasDoDia = acharUnica((l) => l.startsWith('  const _pixHorasDoDia ='), 'horas do dia do pix');
const iGatePix = acharUnica((l) => l.startsWith("  if (opts.force === 'pauta_pix' ||"), 'gate do bloco do pix');
if (!LINHAS[iGatePix].trim().endsWith('{')) {
  throw new Error(`[harness] o gate do pix mudou de forma e o recorte deixou de valer: ${LINHAS[iGatePix]}`);
}
const CONDICAO_PIX = LINHAS[iGatePix].trim().slice('if ('.length, -') {'.length);
const PIX_GATE_LINES = [
  LINHAS[iPixRequire],
  LINHAS[iPixNomes],
  ...LINHAS.slice(iPixHoraFnIni, iPixHoraFnFim + 1),
  LINHAS[iPixHorasDoDia],
].join('\n');

// A linha que calcula a hora de UMA unidade dentro do laco por unidade, verbatim.
const iHoraUnidade = acharUnica((l) => l.trim() === 'const horaDaPauta = _pixHoraDaUnidadeNome(unidadeNome);', 'hora da unidade dentro do laco');
const LINHA_HORA_UNIDADE = LINHAS[iHoraUnidade].trim();
// A linha que pula quem nao e da vez agora, verbatim.
const iSkipUnidade = acharUnica((l) => l.trim() === "if (opts.force !== 'pauta_pix' && timeToSlot(horaDaPauta) !== slotNow) continue;", 'pula unidade fora do slot');
const LINHA_SKIP_UNIDADE = LINHAS[iSkipUnidade].trim();

// ── Posicionamento e trecho do bloco inteiro, pra provar catracas por TEXTO (nao reimplementar).
const iInicioPix = FONTE.indexOf('PAUTA DO PIX AUTOMATICO');
const iInicioLembrete = FONTE.indexOf('09:00-19:00, de HORA em HORA');
const iInicioFalaTxt = FONTE.indexOf(LINHAS[iRequireAnamnese]);
const iFimFalaTxt = FONTE.indexOf("} catch (e) { console.error('[Pauta] fala erro (fora do loop por unidade):', e.message); }");
if (iInicioPix === -1 || iInicioLembrete === -1 || iInicioFalaTxt === -1 || iFimFalaTxt === -1) {
  throw new Error('[harness] alguma ancora de posicao sumiu do dispatcher.js');
}
const TRECHO_FALA = FONTE.slice(iInicioFalaTxt, iInicioPix);
const TRECHO_PIX = FONTE.slice(iInicioPix, iInicioLembrete);

const NOMES = { 'u-recreio': 'Recreio', 'u-barra': 'Barra', 'u-cg': 'Campo Grande' };
const situAl = { nomeDaUnidade: (id) => NOMES[id] || id, UNIDADES_IDS: Object.keys(NOMES) };
// O `require` que o trecho enxerga devolve os modulos puros REAIS — as tabelas sob teste sao as
// de verdade, nunca uma copia redigitada aqui.
const requireFake = (nome) => {
  if (nome === '../services/anamnese-pauta') return require('../services/anamnese-pauta');
  if (nome === '../services/pix-migracao') return require('../services/pix-migracao');
  throw new Error(`[harness] o trecho pediu um modulo que o harness nao conhece: ${nome}`);
};

// eslint-disable-next-line no-new-func
const rodar = new Function('opts', 'now', 'slotNow', 'require', 'situAl', `
${fnTimeToSlot}
${PREPARO_ANAMNESE}
${PIX_GATE_LINES}
const abre = (${CONDICAO_PIX});
const porUnidade = {};
for (const unidadeId of situAl.UNIDADES_IDS) {
  const unidadeNome = situAl.nomeDaUnidade(unidadeId);
  ${LINHA_HORA_UNIDADE}
  if (!horaDaPauta) { continue; }
  ${LINHA_SKIP_UNIDADE}
  porUnidade[unidadeNome] = horaDaPauta;
}
return { abre, diaSemana: _pautaDiaSemana, porUnidade };
`);

const slot = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + Math.floor(m / 15) * 15; };
const tick = (ymd, hhmm, force = null) => rodar({ force }, { ymd }, slot(hhmm), requireFake, situAl);

// 2026-09-04 e uma SEXTA (dia util); 2026-09-05 um SABADO; 2026-09-06 um DOMINGO — mesmas datas
// que o harness da abertura usa, de propósito: a mesma semana prova as duas fiacoes.
const SEXTA = '2026-09-04';
const SABADO = '2026-09-05';
const DOMINGO = '2026-09-06';

test('pix no dispatcher: dia util — Recreio publica as 08:00 (abertura), Barra as 09:00 e Campo Grande as 13:00 (lembrete unico)', () => {
  assert.deepStrictEqual(tick(SEXTA, '08:00').porUnidade, { Recreio: '08:00' });
  assert.deepStrictEqual(tick(SEXTA, '09:00').porUnidade, { Barra: '09:00' });
  assert.deepStrictEqual(tick(SEXTA, '13:00').porUnidade, { 'Campo Grande': '13:00' });
  for (const h of ['08:00', '09:00', '13:00']) {
    assert.strictEqual(tick(SEXTA, h).abre, true, `o bloco tem que abrir as ${h} numa sexta`);
  }
  assert.strictEqual(tick(SEXTA, '10:00').abre, false, '10:00 e a abertura da Barra/CG na anamnese, mas nao e slot de ninguem no pix');
});

test('pix no dispatcher: sabado — Recreio segue a abertura de sabado (08:00), Barra e Campo Grande NAO mudam (09:00/13:00 fixos)', () => {
  assert.deepStrictEqual(tick(SABADO, '08:00').porUnidade, { Recreio: '08:00' });
  assert.deepStrictEqual(tick(SABADO, '09:00').porUnidade, { Barra: '09:00' });
  assert.deepStrictEqual(tick(SABADO, '13:00').porUnidade, { 'Campo Grande': '13:00' });
});

test('pix no dispatcher: domingo nao publica em NENHUMA unidade, nem as que tem lembrete unico fixo', () => {
  for (const h of ['08:00', '09:00', '13:00']) {
    const r = tick(DOMINGO, h);
    assert.deepStrictEqual(r.porUnidade, {}, `domingo as ${h} nao pode publicar pra ninguem`);
    assert.strictEqual(r.abre, false);
  }
});

test('pix no dispatcher: sob --force pauta_pix as tres unidades publicam fora do slot, mas domingo continua fechado', () => {
  const r = tick(SEXTA, '20:00', 'pauta_pix');
  assert.strictEqual(r.abre, true);
  assert.deepStrictEqual(r.porUnidade, { Recreio: '08:00', Barra: '09:00', 'Campo Grande': '13:00' });
  const rDomingo = tick(DOMINGO, '20:00', 'pauta_pix');
  assert.deepStrictEqual(rDomingo.porUnidade, {}, 'forcar nao pode furar a regra de domingo');
});

test('pix no dispatcher: o bloco reaproveita _pautaDiaSemana — nao existe um diaSemanaBrt() proprio dentro dele', () => {
  assert.ok(!TRECHO_PIX.includes('diaSemanaBrt('),
    'o bloco do pix tem que reaproveitar _pautaDiaSemana, nunca chamar diaSemanaBrt() de novo');
});

test('idempotencia do pix usa marcador PROPRIO (PAUTA_PIX) com a chave pauta_pix:<unidade>:<dia>, e nunca cruza com o marcador da anamnese', () => {
  assert.ok(TRECHO_PIX.includes("const _pixChave = `pauta_pix:${unidadeId}:${now.ymd}`;"),
    'a chave da idempotencia tem que ser pauta_pix:<unidade>:<dia>');
  assert.ok(TRECHO_PIX.includes(".eq('marker_type', 'PAUTA_PIX')"),
    'a checagem de idempotencia tem que LER marker_type PAUTA_PIX');
  assert.ok(TRECHO_PIX.includes("marker_type: 'PAUTA_PIX'"),
    'os inserts de marcador do pix tem que gravar marker_type PAUTA_PIX');
  assert.ok(!TRECHO_PIX.includes('PAUTA_ANAMNESE'),
    'o bloco do pix nao pode ler nem escrever o marcador da anamnese');
  assert.ok(!TRECHO_FALA.includes('PAUTA_PIX'),
    'o bloco da fala de abertura da anamnese nao pode saber que o pix existe');
});

test('pix no dispatcher: RPC falhou nunca fica em silencio — publica o aviso de fonte que nao respondeu, nunca um numero', () => {
  assert.ok(TRECHO_PIX.includes('const rpcFalhou = r.texto === null;'),
    'a decisao de "RPC falhou" tem que vir do texto nulo devolvido pelo ritual (pautaPixDaUnidade)');
  assert.ok(TRECHO_PIX.includes('? _pixPura.mensagemDaUnidade({ unidadeNome, linhas: [], lote: [], fonteVelha: true })'),
    'quando a RPC falha, o pix tem que publicar o MESMO aviso da fonte velha — nunca ficar quieto nem inventar numero');
});

test('pix no dispatcher: publica por group_chat_messages, nunca por whatsapp.sendMessage', () => {
  assert.ok(TRECHO_PIX.includes(".from('group_chat_messages').insert("),
    'a pauta do pix precisa publicar pelo mesmo caminho da anamnese (group_chat_messages)');
  assert.ok(!TRECHO_PIX.includes('whatsapp.sendMessage'),
    'envio cru no ritual quebra a trava de quiet gates');
});

test('pix no dispatcher: guarda de duplicata por cabecalho presente, igual a fala de abertura', () => {
  assert.ok(TRECHO_PIX.includes('const cabecalhoMsg = String(texto).split('),
    'a chave da guarda tem que ser a primeira linha do texto publicado');
  assert.ok(TRECHO_PIX.includes("like('content', `${cabecalhoMsg}%`)"),
    'a guarda de duplicata tem que casar por PREFIXO do conteudo, desde o inicio do dia');
});

test("'pauta_pix' entrou na whitelist do --force (senao --force pauta_pix cai no caminho de ritual antigo)", () => {
  const linhaWhitelist = LINHAS.find((l) => l.trim().startsWith("if (opts.force && opts.force !== 'aderencia'"));
  assert.ok(linhaWhitelist, 'nao achei a linha da whitelist de --force');
  assert.ok(linhaWhitelist.includes("opts.force !== 'pauta_pix'"),
    'pauta_pix precisa estar na whitelist de forces aceitos');
});

test('pix no dispatcher: o bloco mora ENTRE a fala de abertura e o lembrete horario', () => {
  assert.ok(iFimFalaTxt < iInicioPix, 'o bloco do pix tem que vir DEPOIS da fala de abertura da anamnese');
  assert.ok(iInicioPix < iInicioLembrete, 'o bloco do pix tem que vir ANTES do lembrete horario');
});

test('pix no dispatcher: o harness nao toca o banco — nenhum node_modules foi carregado', () => {
  const deFora = Object.keys(require.cache).filter((k) => k.includes('node_modules'));
  assert.deepStrictEqual(deFora, [],
    `qualquer client aqui vira conexao com PRODUCAO a cada rodada de teste (${deFora.join(', ')})`);
});

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

// ── RELATORIO SEMANAL DO PIX (Tarefa 6) — recorte SO do bloco novo, pra nao confundir uma
// asserção específica dele com o bloco diário que já mora dentro de TRECHO_PIX (o relatório mora
// DEPOIS do diário, mas ainda ANTES do lembrete — os dois cabem dentro de TRECHO_PIX).
const iFimPixDiario = FONTE.indexOf("} catch (e) { console.error('[PautaPix] erro (fora do loop por unidade):', e.message); }");
const iInicioRelatorio = FONTE.indexOf('RELATORIO SEMANAL DO PIX');
if (iFimPixDiario === -1 || iInicioRelatorio === -1) {
  throw new Error('[harness] alguma ancora do relatorio semanal sumiu do dispatcher.js');
}
if (!(iFimPixDiario < iInicioRelatorio && iInicioRelatorio < iInicioLembrete)) {
  throw new Error('[harness] o relatorio semanal saiu do lugar: tem que ficar ENTRE o bloco diario do pix e o lembrete horario');
}
const TRECHO_RELATORIO = FONTE.slice(iInicioRelatorio, iInicioLembrete);

// Gate do relatorio semanal — mesmo padrao do gate diario acima: recorta a linha do slot e a
// condicao do `if`, verbatim, e roda os dois via `new Function` contra o `timeToSlot` REAL.
const iSlotRelatorio = acharUnica((l) => l.trim() === "const _pixRelatorioSlot = timeToSlot('10:00');", 'slot do relatorio semanal (10:00)');
const LINHA_SLOT_RELATORIO = LINHAS[iSlotRelatorio].trim();
const iGateRelatorio = acharUnica((l) => l.trim().startsWith("if (opts.force === 'pix_relatorio' ||"), 'gate do relatorio semanal do pix');
if (!LINHAS[iGateRelatorio].trim().endsWith('{')) {
  throw new Error(`[harness] o gate do relatorio semanal mudou de forma e o recorte deixou de valer: ${LINHAS[iGateRelatorio]}`);
}
const CONDICAO_RELATORIO = LINHAS[iGateRelatorio].trim().slice('if ('.length, -') {'.length);

// eslint-disable-next-line no-new-func
const rodarRelatorio = new Function('opts', 'now', 'slotNow', `
${fnTimeToSlot}
${LINHA_SLOT_RELATORIO}
return (${CONDICAO_RELATORIO});
`);
const slotRel = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + Math.floor(m / 15) * 15; };
const tickRelatorio = (dow, hhmm, force = null) => rodarRelatorio({ force }, { dow }, slotRel(hhmm));

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

test('pix no dispatcher (fix round 1, Critical): a decisao do que publicar vem da funcao PURA decisaoDaPublicacaoPix — nunca mais um "r.texto === null" solto decidindo sozinho no bloco', () => {
  assert.ok(TRECHO_PIX.includes('_pixPura.decisaoDaPublicacaoPix(r, { unidadeNome })'),
    'o bloco tem que decidir o texto e o result via decisaoDaPublicacaoPix, nao reimplementar a logica');
  assert.ok(!TRECHO_PIX.includes('r.texto === null'),
    'checar "r.texto === null" direto no dispatcher foi o bug do round 1 (Critical): tratava RPC '
    + 'caida, fila vazia e falha do painel como se fossem a mesma coisa — a decisao agora mora so '
    + 'na funcao pura, que le fonteFalhou/fonteVelha/semCliente');
});

test('pix no dispatcher (fix round 1): quando a decisao pura nao devolve texto (fila vazia ou falha do painel), so grava o marcador — sem guarda de cabecalho, sem INSERT em group_chat_messages', () => {
  const iDesvio = TRECHO_PIX.indexOf('if (texto === null) {');
  const iGuarda = TRECHO_PIX.indexOf('const cabecalhoMsg = String(texto).split(');
  const iInsertMsg = TRECHO_PIX.indexOf(".from('group_chat_messages').insert(");
  assert.notStrictEqual(iDesvio, -1, 'tem que existir um desvio explicito pra quando nao ha texto pra publicar');
  assert.notStrictEqual(iGuarda, -1);
  assert.notStrictEqual(iInsertMsg, -1);
  assert.ok(iDesvio < iGuarda, 'o desvio de texto nulo tem que vir ANTES da guarda de cabecalho');
  assert.ok(iDesvio < iInsertMsg, 'o desvio de texto nulo tem que vir ANTES do insert em group_chat_messages');
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// RELATORIO SEMANAL DO PIX (Tarefa 6 do plano de migracao) — segunda as 10h, grupo pix-automatico
// ══════════════════════════════════════════════════════════════════════════════════════════════

test('relatorio semanal do pix: gatilho e segunda as 10h em ponto (BRT), no trecho REAL do dispatcher', () => {
  assert.strictEqual(tickRelatorio(1, '10:00'), true, 'segunda as 10:00 tem que abrir');
  assert.strictEqual(tickRelatorio(1, '10:15'), false, '10:15 ja e outro slot');
  assert.strictEqual(tickRelatorio(1, '09:45'), false, '09:45 ainda nao e a hora');
  for (const dow of [0, 2, 3, 4, 5, 6]) {
    assert.strictEqual(tickRelatorio(dow, '10:00'), false, `dow=${dow} as 10h nao pode abrir — so segunda (dow 1)`);
  }
});

test('relatorio semanal do pix: --force pix_relatorio abre em qualquer dia/hora', () => {
  assert.strictEqual(tickRelatorio(3, '15:00', 'pix_relatorio'), true);
  assert.strictEqual(tickRelatorio(0, '03:00', 'pix_relatorio'), true);
});

test("relatorio semanal do pix: busca o grupo pelo slug 'pix-automatico' (nao por la_report_unidade_id, como o bloco diario)", () => {
  assert.ok(TRECHO_RELATORIO.includes("eq('slug', 'pix-automatico')"),
    'a busca do grupo tem que filtrar por slug pix-automatico');
  assert.ok(TRECHO_RELATORIO.includes(".not('wa_group_jid', 'is', null)"),
    'so vale grupo com wa_group_jid preenchido');
});

test('relatorio semanal do pix: idempotencia usa marcador PAUTA_PIX com chave pix_relatorio:<ymd> (marcador PROPRIO, nunca cruza com pauta_pix:<unidade>:<ymd>)', () => {
  assert.ok(TRECHO_RELATORIO.includes('const _pixRelChave = `pix_relatorio:${now.ymd}`;'),
    'a chave da idempotencia do relatorio tem que ser pix_relatorio:<ymd>, sem unidade (e um relatorio agregado)');
  assert.ok(TRECHO_RELATORIO.includes(".eq('marker_type', 'PAUTA_PIX')"),
    'a checagem de idempotencia tem que ler marker_type PAUTA_PIX (mesma familia do bloco diario)');
  assert.ok(TRECHO_RELATORIO.includes("marker_type: 'PAUTA_PIX'"),
    'os inserts de marcador do relatorio tem que gravar marker_type PAUTA_PIX');
});

test('relatorio semanal do pix: publica por group_chat_messages, nunca por whatsapp.sendMessage', () => {
  assert.ok(TRECHO_RELATORIO.includes(".from('group_chat_messages').insert("),
    'o relatorio semanal precisa publicar pelo mesmo caminho da pauta diaria (group_chat_messages)');
  assert.ok(!TRECHO_RELATORIO.includes('whatsapp.sendMessage'),
    'envio cru no ritual quebra a trava de quiet gates');
});

test('relatorio semanal do pix: guarda de duplicata por cabecalho presente, igual aos blocos acima', () => {
  assert.ok(TRECHO_RELATORIO.includes('const cabecalhoMsg = String(texto).split('),
    'a chave da guarda tem que ser a primeira linha do texto publicado');
  assert.ok(TRECHO_RELATORIO.includes("like('content', `${cabecalhoMsg}%`)"),
    'a guarda de duplicata tem que casar por PREFIXO do conteudo, desde o inicio do dia');
});

test('relatorio semanal do pix: falha de QUALQUER unidade desiste do relatorio inteiro — o return do erro vem ANTES do push do resultado bom e ANTES do INSERT em group_chat_messages', () => {
  const iLoop = TRECHO_RELATORIO.indexOf('for (const unidadeId of situAl.UNIDADES_IDS)');
  const iErroUnidade = TRECHO_RELATORIO.indexOf('if (error) {', iLoop);
  const iReturnUnidade = TRECHO_RELATORIO.indexOf('return;', iErroUnidade);
  const iPush = TRECHO_RELATORIO.indexOf('unidades.push(', iLoop);
  const iInsertRelatorio = TRECHO_RELATORIO.indexOf(".from('group_chat_messages').insert(");
  assert.notStrictEqual(iLoop, -1, 'nao achei o loop por unidade (situAl.UNIDADES_IDS)');
  assert.notStrictEqual(iErroUnidade, -1, 'nao achei o if(error) do fetch por unidade');
  assert.notStrictEqual(iReturnUnidade, -1, 'o tratamento de erro por unidade tem que desistir (return) — senao publica com unidade faltando');
  assert.notStrictEqual(iPush, -1, 'nao achei o push do resultado bom no array unidades[]');
  assert.notStrictEqual(iInsertRelatorio, -1, 'nao achei o INSERT em group_chat_messages do relatorio');
  assert.ok(iErroUnidade < iReturnUnidade, 'o return tem que estar DENTRO do if(error)');
  assert.ok(iReturnUnidade < iPush,
    'o return do erro tem que vir ANTES do push do resultado bom no array unidades[] — senao a unidade que falhou entra no relatorio como zero, mentindo');
  assert.ok(iReturnUnidade < iInsertRelatorio,
    'o return do erro tem que vir ANTES do INSERT — senao publica um relatorio parcial mesmo com uma unidade fora do ar');
});

test('relatorio semanal do pix: usa a RPC get_pix_migracao_v1 SEM p_fatia (quer todas as categorias) e via consultaComRetry', () => {
  assert.ok(TRECHO_RELATORIO.includes("laReportClient.rpc('get_pix_migracao_v1',"),
    'a fonte tem que ser a mesma RPC do bloco diario');
  assert.ok(TRECHO_RELATORIO.includes('p_fatia: null'),
    'sem p_fatia — o relatorio quer TODAS as categorias (ja_migrou, migrar, autorizacao_pendente), nao so quem falta migrar');
  assert.ok(TRECHO_RELATORIO.includes('consultaComRetry('),
    'a consulta por unidade tem que ir por consultaComRetry, igual ao resto do dispatcher');
});

test('relatorio semanal do pix: usa motivoDoRelatorio pra escrever o marcador final e lerSemanaDoMotivo pra ler a semana anterior', () => {
  assert.ok(TRECHO_RELATORIO.includes('_pixPura.motivoDoRelatorio('),
    'o marcador final tem que ser escrito com motivoDoRelatorio (a mesma funcao pura que o proximo relatorio vai ler de volta)');
  assert.ok(TRECHO_RELATORIO.includes('_pixPura.lerSemanaDoMotivo('),
    'a leitura da semana anterior tem que usar lerSemanaDoMotivo, nunca parsear o reason na mao de novo');
  assert.ok(TRECHO_RELATORIO.includes('_pixPura.precisaAlertaRitmo('),
    'o alerta de ritmo tem que vir da funcao pura precisaAlertaRitmo, nao de um if solto no bloco');
  assert.ok(!TRECHO_RELATORIO.includes("require('../services/pix-migracao')"),
    'o bloco do relatorio tem que REAPROVEITAR _pixPura (ja requerido antes, pro bloco diario), nunca re-requerer o modulo');
});

test("'pix_relatorio' entrou na whitelist do --force (senao --force pix_relatorio cai no caminho de ritual antigo)", () => {
  const linhaWhitelist = LINHAS.find((l) => l.trim().startsWith("if (opts.force && opts.force !== 'aderencia'"));
  assert.ok(linhaWhitelist, 'nao achei a linha da whitelist de --force');
  assert.ok(linhaWhitelist.includes("opts.force !== 'pix_relatorio'"),
    'pix_relatorio precisa estar na whitelist de forces aceitos');
});

test('relatorio semanal do pix: o bloco mora ENTRE o bloco diario do pix e o lembrete horario', () => {
  assert.ok(iFimPixDiario < iInicioRelatorio, 'o relatorio tem que vir DEPOIS do bloco diario do pix');
  assert.ok(iInicioRelatorio < iInicioLembrete, 'o relatorio tem que vir ANTES do lembrete horario');
});

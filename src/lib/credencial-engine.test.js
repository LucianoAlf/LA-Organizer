'use strict';
// PROVA DETERMINISTICA dos dois blocos de credencial do engine.js.
//
// Estes dois blocos sao a unica escrita de credencial do TOM e nao tem outra cobertura:
// `engine.js` nao e importavel num teste (precisa de UAZAPI_URL e do client Supabase), e
// os modulos puros (credencial-action, credencial-duplicata, services/credenciais) passam
// 100% verdes com o engine intacto — foi assim que o FIN-RECEIPT-CONFIRM-NOOP (25/06)
// ficou vivo por semanas com o detector pronto e orfao.
//
// Entao aqui o CODIGO REAL e extraido de src/engine.js por marcador de comentario e
// executado num closure com as dependencias stubadas. Nao e uma copia: se alguem apagar,
// reordenar ou renomear os blocos, a extracao falha e o teste fica vermelho — que e o ponto.
// Mesmo padrao de habit-sem-edicao.engine.test.js.
//
// O que estas provas protegem (achados de review ja corrigidos, cada um com dano medido):
//   C-1  escolha numerica no menu de alvo ambiguo APAGAVA sem dizer o que ia apagar
//   A    escolha numerica no menu de duplicata SOBRESCREVIA campos e RENOMEAVA a existente
//   C-2  update parcial com lista vazia apagava todos os campos (coalesce da RPC)
//   B    update parcial com lista nao-vazia apagava os campos nao citados (idem)
//   C    resumo devolvia senha em claro quando o modelo esquecia a flag `sensivel`
//   E    confirmacao casava em intent de credencial que nao era a mais recente
//   I-2  marker truncado deixava o payload na tela e no marker_logs
//   I-3  update sem alvo_id virava create silencioso dizendo "Atualizei"
//   I-4  falha de resolveIntent era muda (segundo "confirma" gravaria de novo)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8').split('\n');
const ENGINE_SRC_LINES = lines;

function idx(pred, from = 0) {
  for (let i = from; i < lines.length; i++) if (pred(lines[i], i)) return i;
  return -1;
}
function exigir(i, oque) {
  assert.notStrictEqual(i, -1, `${oque} sumiu de engine.js — bloco de credencial removido ou renomeado`);
  return i;
}

const iHelper = exigir(idx((l) => l.startsWith('const { LABEL_SENSIVEL_RE: _LABEL_SENSIVEL_RE }')), 'helpers de credencial');
const iEfetivo = exigir(idx((l) => l.startsWith('function _resumoCredencialEfetivo(')), 'helper _resumoCredencialEfetivo');
const iHelperEnd = exigir(idx((l) => l === '}', iEfetivo), 'fim de _resumoCredencialEfetivo');
const iTwoPass = exigir(idx((l) => l.includes('TWO-PASS <<PEDIR_CREDENCIAIS>>')), 'bloco TWO-PASS');
const iConfirm = exigir(idx((l) => l.includes('---- CONFIRMACAO de escrita de credencial pendente')), 'bloco CredencialConfirm');
const iRetry = exigir(idx((l) => l.includes('---- RETRY DE CREDENCIAL SEM MARKER')), 'bloco CredencialRetry');
const iExec = exigir(idx((l) => l.includes('---- EXECUTOR DETERMINISTICO <<CREDENCIAL_ACTION>>')), 'bloco EXECUTOR');
const iExecEnd = exigir(idx((l) => l.includes("console.warn('[CredencialAction] falhou:"), iExec), 'catch do EXECUTOR');

test('ORDEM: TWO-PASS vem antes da confirmacao, que vem antes do executor', () => {
  // Se o executor rodasse antes, um "confirma" abriria uma intent NOVA em vez de resolver
  // a pendente — e a escrita nunca aconteceria.
  assert.ok(iTwoPass < iConfirm, `TWO-PASS (${iTwoPass}) tem de vir antes da confirmacao (${iConfirm})`);
  assert.ok(iConfirm < iRetry, `confirmacao (${iConfirm}) tem de vir antes do retry (${iRetry})`);
  // O retry ANEXA o marker na resposta; se rodasse depois do executor, o executor nao veria
  // marker nenhum e o turno seguiria com a fala do modelo — senha em claro na tela e nada
  // gravado, que e exatamente o bug que ele conserta.
  assert.ok(iRetry < iExec, `retry (${iRetry}) tem de vir antes do executor (${iExec})`);
});

const helperSrc = lines.slice(iHelper, iHelperEnd + 1).join('\n');
const confirmSrc = lines.slice(iConfirm, iRetry).join('\n');
const retrySrc = lines.slice(iRetry, iExec).join('\n');
const execSrc = lines.slice(iExec, iExecEnd + 2).join('\n');

const body = `
${helperSrc}
return async function run(ctx) {
  const { collab, logMarker, withinConfirmWindow, FRESH_WINDOW_MIN, stripReplyScaffold, _metrics, inboundVerbatimText, _inboundWaId, ai, raw } = ctx;
  let reply = ctx.reply;
  let _credenciaisNoTurno = ctx._credenciaisNoTurno === true;
  let _pendingIntentToResolve = ctx._pendingIntentToResolve;
${confirmSrc}
${retrySrc}
${execSrc}
  return { reply, _credenciaisNoTurno, _pendingIntentToResolve };
};`;

// ---- stubs ----
let calls;
function reset() {
  calls = { markers: [], upsert: [], del: [], open: [], resolve: [], apagar: [] };
}
reset();

const stubs = {
  './services/pending-intents': null,     // por cenario
  './services/credenciais': null,         // por cenario
  './services/user-confirmation': require(path.join(ROOT, 'services/user-confirmation.js')),
  './lib/credencial-action': require(path.join(ROOT, 'lib/credencial-action.js')),
  './lib/credencial-duplicata': require(path.join(ROOT, 'lib/credencial-duplicata.js')),
  './lib/credencial-retry-gate': require(path.join(ROOT, 'lib/credencial-retry-gate.js')),
};
const stubRequire = (m) => {
  if (!(m in stubs) || stubs[m] === null) throw new Error('require nao stubado: ' + m);
  return stubs[m];
};
const run = new Function('require', body)(stubRequire);

const { withinConfirmWindow, FRESH_WINDOW_MIN } = require(path.join(ROOT, 'utils/dates.js'));
const { stripReplyScaffold } = require(path.join(ROOT, 'events/detect-approval-reply.js'));

function ctxBase(over) {
  return Object.assign({
    collab: { id: 'collab-1' },
    reply: '',
    inboundVerbatimText: '',
    _inboundWaId: 'WA-TURNO',
    _metrics: {},
    _pendingIntentToResolve: null,
    raw: {},
    // Default: o retry NUNCA chama o modelo. Cada cenario que quiser exercita-lo passa o seu.
    ai: { chat: async () => { throw new Error('ai.chat chamado sem cenario de retry'); } },
    withinConfirmWindow,
    FRESH_WINDOW_MIN,
    stripReplyScaffold,
    logMarker: async (cid, type, result, reason, raw) => { calls.markers.push({ type, result, reason, raw }); },
  }, over);
}
function piStub(intents) {
  return {
    listOpenIntents: async () => intents,
    resolveIntent: async (id, res, note) => { calls.resolve.push({ id, res, note }); return true; },
    openIntent: async (cid, kind, payload, q) => { calls.open.push({ kind, payload, q }); return 'intent-novo'; },
  };
}
function credStub(over) {
  return Object.assign({
    getCredenciaisPara: async () => ({ isAdmin: true, creds: [] }),
    upsertCredencial: async (cid, d) => { calls.upsert.push(d); return { ok: true, id: 'cred-novo', erro: null }; },
    deleteCredencial: async (cid, id) => { calls.del.push(id); return { ok: true, erro: null }; },
    apagarInboundDeCredencial: async (cid, wa) => { calls.apagar.push({ cid, wa }); return { ok: true, erro: null }; },
  }, over);
}
// So os markers da ACAO. CREDENCIAL_INBOUND_APAGADA e faxina de historico e entra em
// todo turno que carrega o marker — nao deve poluir as asseracoes de comportamento.
const markersAcao = () => calls.markers.filter((m) => m.type === 'CREDENCIAL_ACTION');
const agora = () => new Date().toISOString();
const minAtras = (m) => new Date(Date.now() - m * 60000).toISOString();
const MARKER = (o) => `Beleza!\n<<CREDENCIAL_ACTION>>${JSON.stringify(o)}<<END>>`;
const intentCred = (payload, asked) => ({ id: 'i1', kind: 'credencial_write', asked_at: asked || agora(), payload });

function cenario(pending, cred) {
  reset();
  stubs['./services/pending-intents'] = pending;
  stubs['./services/credenciais'] = cred;
}

// =====================================================================
// EXECUTOR — propoe, nunca grava
// =====================================================================

test('executor: create sem duplicata abre intent e nao escreve nada', async () => {
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'Canva LA', categoria: 'plataforma', servico: 'Canva', campos: [{ label: 'senha', valor: 'hunter2', sensivel: true }] }) }));
  assert.match(r.reply, /Confirma\?/);
  assert.strictEqual(calls.upsert.length, 0, 'gravou antes de confirmar');
  assert.strictEqual(calls.open.length, 1);
  assert.strictEqual(calls.open[0].kind, 'credencial_write');
  assert.strictEqual(calls.open[0].payload.modo, 'create');
  assert.ok(!/hunter2/.test(r.reply), 'valor sensivel vazou no resumo');
  assert.match(r.reply, /●●●●●●/);
  assert.match(r.reply, /Categoria: plataforma/);
  assert.strictEqual(r._credenciaisNoTurno, true);
});

test('executor: nao-admin recebe negativa que nao revela a funcionalidade', async () => {
  cenario(piStub([]), credStub({ getCredenciaisPara: async () => ({ isAdmin: false, creds: [] }) }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'X' }) }));
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.open.length, 0);
  assert.ok(!/credenci/i.test(r.reply), 'a negativa revelou a funcionalidade: ' + r.reply);
  assert.deepStrictEqual(markersAcao().map((m) => m.result + ':' + m.reason), ['rejected:nao_admin']);
});

test('executor: alvo ambiguo pergunta qual e guarda {id, nome}', async () => {
  cenario(piStub([]), credStub({
    getCredenciaisPara: async () => ({ isAdmin: true, creds: [
      { id: 'a', nome: 'Instagram LA Music', campos: [] },
      { id: 'b', nome: 'Instagram LA Educa', campos: [] },
    ] }),
  }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'update', alvo: 'Instagram', campos: [{ label: 'senha', valor: 'nova', sensivel: true }] }) }));
  assert.match(r.reply, /Qual delas/);
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.open[0].payload.modo, 'alvo_ambiguo');
  assert.deepStrictEqual(calls.open[0].payload.candidatos,
    [{ id: 'a', nome: 'Instagram LA Music' }, { id: 'b', nome: 'Instagram LA Educa' }]);
});

test('executor: alvo inexistente pergunta o nome e NAO abre intent', async () => {
  cenario(piStub([]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [{ id: 'a', nome: 'Canva', campos: [] }] }) }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'update', alvo: 'Notion' }) }));
  assert.match(r.reply, /Não achei/);
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.open.length, 0);
  assert.deepStrictEqual(markersAcao().map((m) => m.reason), ['alvo_nao_encontrado']);
});

test('executor: duplicata oferece merge, guarda {id, nome} e nao escreve', async () => {
  cenario(piStub([]), credStub({
    getCredenciaisPara: async () => ({ isAdmin: true, creds: [{ id: 'dup1', nome: 'Canva Antigo', campos: [{ label: 'E-mail', valor: 'la@la.com' }] }] }),
  }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'Canva Novo', campos: [{ label: 'E-mail', valor: 'la@la.com' }] }) }));
  assert.match(r.reply, /já existe algo parecido/);
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.open[0].payload.modo, 'duplicata');
  assert.deepStrictEqual(calls.open[0].payload.candidatos, [{ id: 'dup1', nome: 'Canva Antigo' }]);
});

test('executor: openIntent falhando nao promete pendencia', async () => {
  cenario(Object.assign(piStub([]), { openIntent: async () => null }), credStub());
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'X' }) }));
  assert.ok(!/Confirma\?/.test(r.reply), 'prometeu confirmacao sem intent aberta');
  assert.ok(calls.markers.some((m) => m.reason === 'intent_nao_aberta'));
  assert.strictEqual(calls.upsert.length, 0);
});

test('I-2: marker truncado (sem <<END>>) e cortado — segredo nao chega na tela', async () => {
  cenario(piStub([]), credStub());
  const truncado = 'Fechou, vou cadastrar!\n<<CREDENCIAL_ACTION>>{"action":"create","nome":"Canva","campos":[{"label":"senha","valor":"hunter2","sensiv';
  const r = await run(ctxBase({ reply: truncado }));
  assert.ok(!/hunter2/.test(r.reply), 'segredo ficou na tela: ' + r.reply);
  assert.ok(!/CREDENCIAL_ACTION/.test(r.reply));
  assert.strictEqual(r.reply, 'Fechou, vou cadastrar!');
  assert.deepStrictEqual(markersAcao().map((m) => m.result + ':' + m.reason), ['rejected:payload_invalido']);
  assert.strictEqual(markersAcao()[0].raw, null, 'raw do logMarker tem de ser null');
  assert.strictEqual(calls.upsert.length, 0);
});

test('I-2: marker truncado sozinho vira resposta neutra, sem sobra do payload', async () => {
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: '<<CREDENCIAL_ACTION>>{"action":"create","campos":[{"valor":"hunter2"' }));
  assert.ok(!/hunter2|CREDENCIAL_ACTION/.test(r.reply), 'sobrou payload: ' + r.reply);
  assert.ok(r.reply.length > 0, 'mensagem vazia');
});

test('executor: payload invalido COM <<END>> tambem registra e limpa', async () => {
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: 'Ok!\n<<CREDENCIAL_ACTION>>{isso nao e json}<<END>>' }));
  assert.ok(!/CREDENCIAL_ACTION/.test(r.reply), 'marker cru na tela: ' + r.reply);
  assert.deepStrictEqual(markersAcao().map((m) => m.result + ':' + m.reason), ['rejected:payload_invalido']);
  assert.strictEqual(calls.upsert.length, 0);
});

// =====================================================================
// CONFIRMACAO — unico ponto que grava
// =====================================================================

test('confirmacao: "confirma" em create fresco grava, repassa categoria e resolve confirmed', async () => {
  const proposta = { action: 'create', nome: 'Canva LA', categoria: 'plataforma', servico: 'Canva', projeto: null, url_ref: null, observacoes: null, campos: [{ label: 'senha', valor: 'x', sensivel: true }] };
  cenario(piStub([intentCred({ modo: 'create', proposta })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'confirma' }));
  assert.strictEqual(calls.upsert.length, 1);
  assert.strictEqual(calls.upsert[0].categoria, 'plataforma', 'categoria nao repassada');
  assert.strictEqual(calls.upsert[0].id, null);
  assert.deepStrictEqual(calls.resolve, [{ id: 'i1', res: 'confirmed', note: null }]);
  assert.match(r.reply, /Cadastrei/);
  assert.deepStrictEqual(calls.markers.map((m) => m.result), ['executed']);
});

test('confirmacao: e lida do inboundVerbatimText, atravessando o scaffold de reply', async () => {
  // `text` e reatribuido com blocos de CONTEXTO INTERNO ao longo do processMessage; no
  // texto inchado o detector devolve null e a confirmacao viraria NOOP silencioso.
  cenario(piStub([intentCred({ modo: 'create', proposta: { action: 'create', nome: 'X', categoria: null, campos: [] } })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: '[O usuário está RESPONDENDO a esta mensagem anterior do TOM: "Vou cadastrar assim: Canva ... Confirma?"]\nsim' }));
  assert.strictEqual(calls.upsert.length, 1, 'scaffold impediu a deteccao: ' + r.reply);
});

test('confirmacao: "nao" resolve denied e nao grava', async () => {
  cenario(piStub([intentCred({ modo: 'create', proposta: { nome: 'X' } })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'não' }));
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.resolve[0].res, 'denied');
  assert.match(r.reply, /não gravei nada/);
  assert.deepStrictEqual(calls.markers.map((m) => m.result), ['skipped']);
});

test('janela: PARIDADE com o auto-resolve generico — a constante, nunca um numero solto', () => {
  // CONFIRM-STAGED-DEADBAND (Vitoria 03/09): um `15` literal aqui contra FRESH_WINDOW_MIN=20
  // no auto-resolve generico abre uma banda morta de 5min em que o "sim" e consumido por
  // quem nao tem payload. Este teste afirma a PARIDADE: afirmar "15" (ou "20") perpetuaria
  // o problema, porque um numero solto volta a divergir na proxima mudanca da constante.
  const mGuarda = confirmSrc.match(/withinConfirmWindow\(intent\.asked_at,\s*([A-Za-z_$][\w$]*|\d+)\s*\)/);
  assert.ok(mGuarda, 'a guarda de janela sumiu do bloco de confirmacao de credencial');
  assert.strictEqual(mGuarda[1], 'FRESH_WINDOW_MIN',
    `a guarda usa "${mGuarda[1]}" em vez da constante compartilhada — banda morta de volta`);

  // E a constante tem de ser mesmo a que o auto-resolve generico usa: se alguem mudar um
  // dos dois lados, isto quebra. (O generico ainda carrega o literal; o que importa e o
  // VALOR ser o mesmo, entao a comparacao e por valor, aceitando literal ou constante.)
  const linhaGenerico = ENGINE_SRC_LINES.find((l) => l.includes('const fresh = target ? withinConfirmWindow(target.asked_at,'));
  assert.ok(linhaGenerico, 'guarda do auto-resolve generico nao encontrada em engine.js');
  const mGen = linhaGenerico.match(/withinConfirmWindow\(target\.asked_at,\s*([A-Za-z_$][\w$]*|\d+)\s*\)/);
  assert.ok(mGen, 'janela do auto-resolve generico nao encontrada');
  const janelaGenerica = /^\d+$/.test(mGen[1]) ? Number(mGen[1]) : FRESH_WINDOW_MIN;
  assert.strictEqual(FRESH_WINDOW_MIN, janelaGenerica,
    `credencial usa ${FRESH_WINDOW_MIN}min e o auto-resolve generico ${janelaGenerica}min — banda morta entre os dois`);
});

test('janela: dentro de FRESH_WINDOW_MIN a confirmacao ainda grava (banda morta fechada)', async () => {
  // O ponto que antes caia no buraco: mais de 15min, menos de 20.
  cenario(piStub([intentCred({ modo: 'create', proposta: { nome: 'X', campos: [] } }, minAtras(FRESH_WINDOW_MIN - 2))]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'confirma' }));
  assert.strictEqual(calls.upsert.length, 1, `"sim" a ${FRESH_WINDOW_MIN - 2}min caiu no vazio — banda morta`);
  assert.match(r.reply, /Cadastrei/);
});

test('janela: passado FRESH_WINDOW_MIN nao grava e expira a intent', async () => {
  cenario(piStub([intentCred({ modo: 'create', proposta: { nome: 'X' } }, minAtras(FRESH_WINDOW_MIN + 5))]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'confirma' }));
  assert.strictEqual(calls.upsert.length, 0, 'gravou fora da janela');
  assert.deepStrictEqual(calls.resolve, [{ id: 'i1', res: 'expired', note: `fora da janela de ${FRESH_WINDOW_MIN}min` }]);
  assert.deepStrictEqual(calls.markers.map((m) => m.result + ':' + m.reason), ['skipped:janela_expirada']);
  assert.strictEqual(r.reply, '', 'nao deve sequestrar a reply do turno');
});

test('janela: a 2a intent vale pelo PROPRIO asked_at, nao pelo do menu antigo', async () => {
  // No fluxo de duas etapas o relogio recomeca quando a 2a intent nasce: um menu aberto
  // ha 14min ainda pode virar confirmacao, e a confirmacao tem 15min proprios.
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', campos: [] }, alvo_id: 'c1', alvo_nome: 'Canva' }, minAtras(2))]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [{ id: 'c1', nome: 'Canva', campos: [] }] }) }));
  const r = await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.strictEqual(calls.upsert.length, 1, 'a 2a intent fresca deveria gravar');
  assert.match(r.reply, /Atualizei \*Canva\*/);
});

test('anti-clobber: intent de credencial zera _pendingIntentToResolve', async () => {
  cenario(piStub([intentCred({ modo: 'create', proposta: { nome: 'X' } })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'sim', _pendingIntentToResolve: { intent: { id: 'i1' }, resolution: 'confirmed' } }));
  assert.strictEqual(r._pendingIntentToResolve, null, 'resolvedor generico fecharia a intent sem gravar');
});

test('anti-clobber: intent de OUTRO kind nao e tocada por este bloco', async () => {
  cenario(piStub([{ id: 'z', kind: 'task_creation', asked_at: agora(), payload: {} }]), credStub());
  const pend = { intent: { id: 'z' }, resolution: 'confirmed' };
  const r = await run(ctxBase({ inboundVerbatimText: 'sim', _pendingIntentToResolve: pend }));
  assert.strictEqual(r._pendingIntentToResolve, pend, 'zerou intent de outro dono');
  assert.strictEqual(calls.resolve.length, 0);
  assert.strictEqual(calls.upsert.length, 0);
});

test('E: credencial_write que NAO e a mais recente nao e tratada', async () => {
  // listOpenIntents devolve por asked_at DESC. Com uma pergunta mais nova de outro kind,
  // o "sim" e dela — gravar a credencial aqui seria escrever sem confirmacao.
  const pend = { intent: { id: 'nova' }, resolution: 'confirmed' };
  cenario(piStub([
    { id: 'nova', kind: 'task_creation', asked_at: agora(), payload: {} },
    intentCred({ modo: 'create', proposta: { nome: 'X', campos: [] } }, minAtras(3)),
  ]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'sim', reply: 'resposta normal', _pendingIntentToResolve: pend }));
  assert.strictEqual(calls.upsert.length, 0, 'gravou credencial com um "sim" que era de outra pergunta');
  assert.strictEqual(calls.resolve.length, 0);
  assert.strictEqual(r._pendingIntentToResolve, pend, 'descartou a resolucao da intent que era realmente a alvo');
  assert.strictEqual(r.reply, 'resposta normal');
  assert.strictEqual(r._credenciaisNoTurno, false);
  // Achado 4 (round 3): o ramo tem de aparecer numa serie consultavel, com identificador.
  assert.strictEqual(calls.markers.length, 1, 'ramo mudo — nao aparece em serie nenhuma');
  assert.strictEqual(calls.markers[0].result, 'skipped');
  assert.match(calls.markers[0].reason, /intent_nao_mais_recente/);
  assert.match(calls.markers[0].reason, /i1/, 'sem o id da intent o registro nao acha nada');
  assert.strictEqual(calls.markers[0].raw, null);
});

test('confirmacao: mensagem que nao e confirmacao passa reto e a intent segue aberta', async () => {
  cenario(piStub([intentCred({ modo: 'create', proposta: { nome: 'X' } })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'quantas tarefas eu tenho hoje?', reply: 'Você tem 3 tarefas.' }));
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.resolve.length, 0);
  assert.strictEqual(calls.markers.length, 0);
  assert.strictEqual(r.reply, 'Você tem 3 tarefas.');
  assert.strictEqual(r._credenciaisNoTurno, false);
});

test('confirmacao: listOpenIntents lancando (rejeicao non-Error) nao derruba a mensagem', async () => {
  cenario({ listOpenIntents: async () => { throw 'string crua, nao Error'; }, resolveIntent: async () => true, openIntent: async () => 'x' }, credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'sim', reply: 'texto normal' }));
  assert.strictEqual(r.reply, 'texto normal');
  assert.strictEqual(calls.upsert.length, 0);
});

test('erro forbidden na RPC responde discreto e loga rejected (nunca executed)', async () => {
  cenario(piStub([intentCred({ modo: 'create', proposta: { nome: 'X' } })]),
    credStub({ upsertCredencial: async () => ({ ok: false, id: null, erro: 'forbidden: somente admin' }) }));
  const r = await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.ok(!/credenci/i.test(r.reply), 'vazou a funcionalidade: ' + r.reply);
  assert.deepStrictEqual(calls.markers.map((m) => m.result), ['rejected'], 'escrita falha nao pode logar executed');
  assert.strictEqual(calls.resolve[0].res, 'denied');
});

test('erro not_found na RPC pede o nome exato', async () => {
  cenario(piStub([intentCred({ modo: 'update', proposta: { nome: 'X', campos: [] }, alvo_id: 'c1', alvo_nome: 'X' })]),
    credStub({
      getCredenciaisPara: async () => ({ isAdmin: true, creds: [{ id: 'c1', nome: 'X', campos: [] }] }),
      upsertCredencial: async () => ({ ok: false, id: null, erro: 'not_found: credencial inexistente' }),
    }));
  const r = await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.match(r.reply, /nome exato/);
  assert.deepStrictEqual(calls.markers.map((m) => m.result), ['rejected']);
});

test('I-4: resolveIntent falhando deixa rastro com id da intent e modo', async () => {
  cenario(Object.assign(piStub([{ id: 'intent-abc', kind: 'credencial_write', asked_at: agora(), payload: { modo: 'create', proposta: { nome: 'X', campos: [] } } }]),
    { resolveIntent: async () => false }), credStub());
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try { await run(ctxBase({ inboundVerbatimText: 'sim' })); } finally { console.warn = origWarn; }
  assert.strictEqual(calls.upsert.length, 1, 'a escrita em si deve acontecer');
  const w = warns.find((x) => /resolveIntent FALHOU/.test(x));
  assert.ok(w, 'fechamento falhou em silencio — nao ha rastro do porque duplicaria');
  assert.match(w, /intent-abc/);
  assert.match(w, /modo=create/);
});

// =====================================================================
// C-1 e A — escolha numerica RESOLVE o alvo, nunca executa
// =====================================================================

const CANDS = [{ id: 'ig1', nome: 'Instagram LA Music' }, { id: 'ig2', nome: 'Instagram Pessoal' }];
const ambiguo = (action, cands) => intentCred({
  modo: 'alvo_ambiguo',
  proposta: { action, alvo: 'Instagram', categoria: null, campos: [] },
  candidatos: cands || CANDS,
});
const credsIG = [{ id: 'ig1', nome: 'Instagram LA Music', campos: [] }, { id: 'ig2', nome: 'Instagram Pessoal', campos: [] }];

test('C-1 delete: o numero NAO apaga — abre 2a confirmacao dizendo o que vai acontecer', async () => {
  cenario(piStub([ambiguo('delete')]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: credsIG }) }));
  const c = ctxBase({ inboundVerbatimText: '2' });
  const r = await run(c);
  assert.strictEqual(calls.del.length, 0, 'APAGOU sem confirmacao explicita');
  assert.strictEqual(calls.upsert.length, 0);
  assert.match(r.reply, /Vou APAGAR \*Instagram Pessoal\*/);
  assert.match(r.reply, /Confirma\?/);
  assert.strictEqual(calls.open.length, 1);
  assert.strictEqual(calls.open[0].payload.modo, 'delete');
  assert.strictEqual(calls.open[0].payload.alvo_id, 'ig2');
  assert.strictEqual(calls.open[0].payload.alvo_nome, 'Instagram Pessoal');
  assert.strictEqual(c._metrics.awaiting_user_confirm, true);
  assert.deepStrictEqual(calls.markers.map((m) => m.result), ['skipped'], 'nada foi executado');
});

test('C-1 update: o numero NAO grava — 2a confirmacao com resumo mascarado', async () => {
  const amb = ambiguo('update');
  amb.payload.proposta.campos = [{ label: 'Senha', valor: 'hunter2', sensivel: true }];
  cenario(piStub([amb]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: credsIG }) }));
  const r = await run(ctxBase({ inboundVerbatimText: '1' }));
  assert.strictEqual(calls.upsert.length, 0, 'gravou sem a 2a confirmacao');
  assert.match(r.reply, /Vou atualizar \*Instagram LA Music\*/);
  assert.ok(!/hunter2/.test(r.reply), 'segredo vazou na 2a confirmacao');
  assert.match(r.reply, /●●●●●●/);
  assert.strictEqual(calls.open[0].payload.alvo_id, 'ig1');
});

test('C-1: payload antigo (candidatos como ids crus) continua funcionando', async () => {
  cenario(piStub([ambiguo('delete', ['ig1', 'ig2'])]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: credsIG }) }));
  const r = await run(ctxBase({ inboundVerbatimText: '2' }));
  assert.strictEqual(calls.del.length, 0);
  assert.strictEqual(calls.open[0].payload.alvo_id, 'ig2');
  assert.match(r.reply, /Vou APAGAR \*Instagram Pessoal\*/);
});

test('C-1: indice fora da lista nao faz nada e o turno vira pergunta', async () => {
  cenario(piStub([ambiguo('delete')]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: credsIG }) }));
  const c = ctxBase({ inboundVerbatimText: '5' });
  await run(c);
  assert.strictEqual(calls.del.length, 0);
  assert.strictEqual(calls.open.length, 0);
  assert.strictEqual(calls.resolve.length, 0, 'intent segue aberta pra reescolher');
  assert.strictEqual(c._metrics.awaiting_user_confirm, true);
  assert.deepStrictEqual(calls.markers.map((m) => m.result + ':' + m.reason), ['rejected:confirmacao:indice_invalido']);
});

test('C-1: "sim" na 2a intent (delete com alvo travado) finalmente apaga', async () => {
  cenario(piStub([intentCred({ modo: 'delete', proposta: { action: 'delete', alvo: 'Instagram' }, alvo_id: 'ig2', alvo_nome: 'Instagram Pessoal' })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: credsIG }) }));
  const r = await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.deepStrictEqual(calls.del, ['ig2']);
  assert.match(r.reply, /Apaguei \*Instagram Pessoal\*/);
  assert.deepStrictEqual(calls.markers.map((m) => m.result), ['executed']);
});

test('2a etapa: "nao" resolve denied e nao grava nada', async () => {
  cenario(piStub([intentCred({ modo: 'delete', proposta: { action: 'delete', alvo: 'Instagram' }, alvo_id: 'ig2', alvo_nome: 'Instagram Pessoal' })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'não' }));
  assert.strictEqual(calls.del.length, 0);
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.resolve[0].res, 'denied');
  assert.match(r.reply, /não gravei nada/);
});

test('2a etapa: outro NUMERO nao e confirmacao — nao trata, intent segue aberta', async () => {
  // Na 2a intent (modo delete/update) nao ha menu: um "3" nao pode virar "sim".
  cenario(piStub([intentCred({ modo: 'delete', proposta: { action: 'delete', alvo: 'Instagram' }, alvo_id: 'ig2', alvo_nome: 'Instagram Pessoal' })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: '3', reply: 'resposta do LLM' }));
  assert.strictEqual(calls.del.length, 0, 'numero solto apagou credencial');
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.resolve.length, 0);
  assert.strictEqual(calls.markers.length, 0);
  assert.strictEqual(r.reply, 'resposta do LLM');
});

test('A duplicata: o numero NAO grava — abre 2a etapa mostrando o que vai acontecer', async () => {
  // A proposta e de CREATE: traz nome e campos. A RPC substituiria a lista inteira e
  // renomearia a credencial existente, e a resposta so dizia "Atualizei a que ja existia".
  const proposta = { action: 'create', nome: 'Canva Novo', categoria: 'plataforma', campos: [{ label: 'E-mail', valor: 'la@la.com' }] };
  const existente = { id: 'dup1', nome: 'Canva Antigo', categoria: 'plataforma', campos: [
    { label: 'E-mail', valor: 'antigo@la.com' },
    { label: 'Senha', valor: 's3cr3t', sensivel: true },
    { label: 'Chave', valor: 'k-123', sensivel: true },
  ] };
  cenario(piStub([intentCred({ modo: 'duplicata', proposta, candidatos: [{ id: 'dup1', nome: 'Canva Antigo' }] })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [existente] }) }));
  const c = ctxBase({ inboundVerbatimText: '1' });
  const r = await run(c);
  assert.strictEqual(calls.upsert.length, 0, 'sobrescreveu a credencial existente sem confirmacao');
  assert.strictEqual(calls.open.length, 1);
  assert.strictEqual(calls.open[0].payload.modo, 'update');
  assert.strictEqual(calls.open[0].payload.alvo_id, 'dup1');
  assert.match(r.reply, /Vou atualizar \*Canva Antigo\*/);
  assert.match(r.reply, /Confirma\?/);
  assert.strictEqual(c._metrics.awaiting_user_confirm, true);
  assert.deepStrictEqual(calls.markers.map((m) => m.result), ['skipped']);
});

test('A duplicata: a 2a etapa mostra o RENAME e os campos que sobrevivem, mascarados', async () => {
  const proposta = { action: 'create', nome: 'Canva Novo', campos: [{ label: 'E-mail', valor: 'la@la.com' }] };
  const existente = { id: 'dup1', nome: 'Canva Antigo', campos: [
    { label: 'E-mail', valor: 'antigo@la.com' },
    { label: 'Senha', valor: 's3cr3t', sensivel: true },
  ] };
  cenario(piStub([intentCred({ modo: 'duplicata', proposta, candidatos: [{ id: 'dup1', nome: 'Canva Antigo' }] })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [existente] }) }));
  const r = await run(ctxBase({ inboundVerbatimText: '1' }));
  assert.match(r.reply, /\*Canva Novo\*/, 'o rename precisa aparecer no resumo');
  assert.match(r.reply, /E-mail: la@la\.com/, 'o valor novo precisa aparecer');
  assert.match(r.reply, /Senha: ●●●●●●/, 'a Senha existente sobrevive ao merge e sai mascarada');
  assert.ok(!/s3cr3t/.test(r.reply), 'segredo vazou no resumo');
});

test('A duplicata: "criar" (palavra literal) segue executando — cria, nao sobrescreve', async () => {
  cenario(piStub([intentCred({ modo: 'duplicata', proposta: { action: 'create', nome: 'Canva Novo', categoria: null, campos: [] }, candidatos: [{ id: 'dupA', nome: 'Canva' }] })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'criar' }));
  assert.strictEqual(calls.upsert.length, 1);
  assert.strictEqual(calls.upsert[0].id, null, 'tem de ser insert, nunca update');
  assert.match(r.reply, /Criei a credencial nova/);
});

test('A duplicata: indice fora da lista nao grava e seta awaiting_user_confirm', async () => {
  cenario(piStub([intentCred({ modo: 'duplicata', proposta: { nome: 'X' }, candidatos: [{ id: 'dupA', nome: 'Canva' }] })]), credStub());
  const c = ctxBase({ inboundVerbatimText: '4' });
  await run(c);
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(c._metrics.awaiting_user_confirm, true);
  assert.deepStrictEqual(calls.markers.map((m) => m.result + ':' + m.reason), ['rejected:confirmacao:indice_invalido']);
});

// =====================================================================
// C-2 e B — update parcial nunca destroi campo que a proposta nao citou
// =====================================================================

test('C-2: update sem campos nao envia `campos` (a RPC preserva o que ja esta la)', async () => {
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', url_ref: 'https://novo', campos: [] }, alvo_id: 'c1', alvo_nome: 'Canva' })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [{ id: 'c1', nome: 'Canva', campos: [] }] }) }));
  const r = await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.strictEqual(calls.upsert.length, 1);
  assert.ok(!('campos' in calls.upsert[0]), 'mandou campos vazio — a RPC apagaria login e senha');
  assert.strictEqual(calls.upsert[0].id, 'c1');
  assert.strictEqual(calls.upsert[0].url_ref, 'https://novo');
  assert.match(r.reply, /Atualizei \*Canva\*/);
});

test('B: update parcial faz MERGE por label — 3 existentes + 1 sobrescrito + 1 novo = 4', async () => {
  // "troca a senha do Canva" fazia o modelo emitir campos:[{Senha}] e a RPC
  // (campos = coalesce(p_campos, g.campos)) apagava E-mail e Chave.
  const alvo = { id: 'c1', nome: 'Canva', campos: [
    { label: 'E-mail', valor: 'la@la.com' },
    { label: 'Senha', valor: 'velha', sensivel: true },
    { label: 'Chave', valor: 'k-123', sensivel: true },
  ] };
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', campos: [{ label: 'Senha', valor: 'nova', sensivel: true }, { label: 'Token', valor: 't-9', sensivel: true }] }, alvo_id: 'c1', alvo_nome: 'Canva' })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [alvo] }) }));
  await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.strictEqual(calls.upsert.length, 1);
  const campos = calls.upsert[0].campos;
  assert.strictEqual(campos.length, 4, 'merge perdeu ou duplicou campo: ' + JSON.stringify(campos));
  const porLabel = Object.fromEntries(campos.map((c) => [c.label, c.valor]));
  assert.strictEqual(porLabel['E-mail'], 'la@la.com', 'E-mail nao citado foi apagado');
  assert.strictEqual(porLabel['Chave'], 'k-123', 'Chave nao citada foi apagada');
  assert.strictEqual(porLabel['Senha'], 'nova', 'a Senha citada nao foi atualizada');
  assert.strictEqual(porLabel['Token'], 't-9', 'campo novo nao foi acrescentado');
});

test('B: o merge casa label ignorando caixa e espaco nas pontas', async () => {
  const alvo = { id: 'c1', nome: 'Canva', campos: [{ label: 'E-mail', valor: 'antigo@la.com' }] };
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', campos: [{ label: '  e-MAIL ', valor: 'novo@la.com' }] }, alvo_id: 'c1', alvo_nome: 'Canva' })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [alvo] }) }));
  await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.strictEqual(calls.upsert[0].campos.length, 1, 'criou campo duplicado por diferenca de caixa');
  assert.strictEqual(calls.upsert[0].campos[0].valor, 'novo@la.com');
});

test('B: o merge nunca REBAIXA `sensivel` (flag esquecida pelo modelo)', async () => {
  const alvo = { id: 'c1', nome: 'Canva', campos: [{ label: 'Senha', valor: 'velha', sensivel: true }] };
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', campos: [{ label: 'Senha', valor: 'nova', sensivel: false }] }, alvo_id: 'c1', alvo_nome: 'Canva' })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [alvo] }) }));
  await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.strictEqual(calls.upsert[0].campos[0].sensivel, true, 'campo secreto foi desmarcado');
});

test('B: update com alvo que nao volta na leitura fresca e fail-closed', async () => {
  // Sem os campos atuais o merge nao existe — gravar so a lista da proposta apagaria o resto.
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', campos: [{ label: 'Senha', valor: 'nova', sensivel: true }] }, alvo_id: 'sumiu', alvo_nome: 'Canva' })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [] }) }));
  const c = ctxBase({ inboundVerbatimText: 'sim' });
  const r = await run(c);
  assert.strictEqual(calls.upsert.length, 0, 'gravou sem poder mergear');
  assert.strictEqual(calls.resolve[0].res, 'denied');
  assert.match(r.reply, /nome exato/);
  assert.deepStrictEqual(calls.markers.map((m) => m.result + ':' + m.reason), ['rejected:confirmacao:update_alvo_nao_lido']);
  assert.strictEqual(c._metrics.awaiting_user_confirm, true, 'achado 5: o turno responde com pergunta');
});

test('achado 5: alvo nao lido na escolha numerica tambem seta awaiting_user_confirm', async () => {
  cenario(piStub([intentCred({ modo: 'duplicata', proposta: { action: 'create', nome: 'X', campos: [] }, candidatos: [{ id: 'sumiu', nome: 'Canva' }] })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [] }) }));
  const c = ctxBase({ inboundVerbatimText: '1' });
  const r = await run(c);
  assert.strictEqual(calls.upsert.length, 0);
  assert.strictEqual(calls.open.length, 0, 'abriu 2a etapa sem conseguir ler o alvo');
  assert.strictEqual(c._metrics.awaiting_user_confirm, true);
  assert.match(r.reply, /nome exato/);
  assert.deepStrictEqual(calls.markers.map((m) => m.result + ':' + m.reason), ['rejected:confirmacao:alvo_nao_lido']);
});

// =====================================================================
// Round 3 — a pessoa confirma sabendo o que vai acontecer
// =====================================================================

test('1: campo com label e SEM valor nao apaga o segredo guardado', async () => {
  // `parseCredencialAction` normaliza valor ausente pra '' e o Object.assign deixava esse
  // '' vencer o valor guardado. Zerar campo tem de ser pedido explicito.
  const alvo = { id: 'c1', nome: 'Canva', campos: [
    { label: 'Senha', valor: 's3cr3t', sensivel: true },
    { label: 'E-mail', valor: 'a@b.c' },
  ] };
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', campos: [{ label: 'Senha', valor: '' }] }, alvo_id: 'c1', alvo_nome: 'Canva' })]),
    credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [alvo] }) }));
  await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.strictEqual(calls.upsert.length, 1);
  const porLabel = Object.fromEntries(calls.upsert[0].campos.map((c) => [c.label, c.valor]));
  assert.strictEqual(porLabel['Senha'], 's3cr3t', 'valor vazio apagou o segredo guardado');
  assert.strictEqual(porLabel['E-mail'], 'a@b.c');
});

test('1: campo sem valor aparece como (vazio) no resumo, nunca mascarado', async () => {
  // A mascara existe pra esconder segredo, nao ausencia: pintar `●●●●●●` nos dois casos
  // deixava apagar e preservar visualmente identicos na hora do "sim".
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'Canva', campos: [{ label: 'Senha' }, { label: 'E-mail', valor: 'a@b.c' }] }) }));
  assert.match(r.reply, /Senha: \(vazio\)/, 'campo sem valor foi mascarado: ' + r.reply);
  assert.ok(!/●●●●●●/.test(r.reply), 'mascara usada para ausencia de valor');
  assert.match(r.reply, /E-mail: a@b\.c/);
});

test('2: o resumo do caminho de ALVO EXATO mostra o resultado, nao a proposta', async () => {
  // Era o caminho mais usado e o unico que ainda mostrava a proposta crua: o campo
  // sobrevivente sumia da tela e a pessoa confirmava sem ver o que sobra.
  const alvo = { id: 'c1', nome: 'Canva', campos: [
    { label: 'E-mail', valor: 'la@la.com' },
    { label: 'Senha', valor: 'velha', sensivel: true },
  ] };
  cenario(piStub([]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [alvo] }) }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'update', alvo: 'Canva', nome: 'Canva Pro', campos: [{ label: 'Senha', valor: 'nova', sensivel: true }] }) }));
  assert.match(r.reply, /Vou atualizar \*Canva\*/);
  assert.match(r.reply, /E-mail: la@la\.com/, 'o campo sobrevivente nao aparece no resumo');
  assert.match(r.reply, /\*Canva Pro\*/, 'o rename precisa aparecer');
  assert.match(r.reply, /Senha: ●●●●●●/);
  assert.ok(!/nova|velha/.test(r.reply), 'valor de senha vazou no resumo');
  assert.strictEqual(calls.upsert.length, 0, 'executor nao pode gravar');
});

test('3: observacoes aparecem no resumo (substituicao deixa de ser silenciosa)', async () => {
  const alvo = { id: 'c1', nome: 'Canva', observacoes: 'nota antiga', campos: [] };
  cenario(piStub([]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [alvo] }) }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'update', alvo: 'Canva', observacoes: 'nota nova' }) }));
  assert.match(r.reply, /Obs\.: nota nova/, 'observacoes trocadas sem disclosure: ' + r.reply);
});

test('3: observacoes existentes sobrevivem e aparecem quando a proposta nao as cita', async () => {
  const alvo = { id: 'c1', nome: 'Canva', observacoes: 'nota antiga', campos: [] };
  cenario(piStub([]), credStub({ getCredenciaisPara: async () => ({ isAdmin: true, creds: [alvo] }) }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'update', alvo: 'Canva', url_ref: 'https://x' }) }));
  assert.match(r.reply, /Obs\.: nota antiga/);
});

test('3: observacao longa e truncada no resumo', async () => {
  cenario(piStub([]), credStub());
  const longa = 'z'.repeat(400);
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'X', observacoes: longa }) }));
  const linha = r.reply.split('\n').find((x) => x.startsWith('Obs.: '));
  assert.ok(linha, 'linha de observacoes ausente');
  assert.ok(linha.length < 200, 'observacao longa nao foi truncada: ' + linha.length);
  assert.match(linha, /…$/);
});

test('C: o resumo mascara por LABEL quando o modelo esquece a flag `sensivel`', async () => {
  // Medido na base: 3 de 134 campos tem label de segredo com sensivel:false.
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'VPS', campos: [{ label: 'Senha', valor: 'p4ssw0rd' }, { label: 'Usuário', valor: 'root' }] }) }));
  assert.ok(!/p4ssw0rd/.test(r.reply), 'senha em claro na confirmacao: ' + r.reply);
  assert.match(r.reply, /Senha: ●●●●●●/);
  assert.match(r.reply, /Usuário: root/, 'campo nao sensivel deve continuar visivel');
});

// =====================================================================
// I-3 — alvo ausente nunca vira create silencioso
// =====================================================================

test('I-3: update sem alvo_id nao vira create silencioso', async () => {
  cenario(piStub([intentCred({ modo: 'update', proposta: { action: 'update', alvo: 'Canva', campos: [] }, alvo_nome: 'Canva' })]), credStub());
  const c = ctxBase({ inboundVerbatimText: 'sim' });
  const r = await run(c);
  assert.strictEqual(calls.upsert.length, 0, 'inseriu credencial nova achando que atualizava');
  assert.strictEqual(calls.resolve[0].res, 'denied');
  assert.ok(!/Atualizei/.test(r.reply), 'afirmou ter atualizado: ' + r.reply);
  assert.match(r.reply, /nome exato/);
  assert.strictEqual(c._metrics.awaiting_user_confirm, true);
  assert.deepStrictEqual(calls.markers.map((m) => m.result + ':' + m.reason), ['rejected:confirmacao:update_sem_alvo']);
});

test('I-3: delete sem alvo_id tambem e fail-closed', async () => {
  cenario(piStub([intentCred({ modo: 'delete', proposta: { action: 'delete', alvo: 'Canva' } })]), credStub());
  const r = await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.strictEqual(calls.del.length, 0);
  assert.match(r.reply, /nome exato/);
});

test('todas as chamadas a logMarker passam null no raw (a reply nunca vai pro log)', async () => {
  cenario(piStub([intentCred({ modo: 'create', proposta: { nome: 'X', campos: [{ label: 'Senha', valor: 'seg', sensivel: true }] } })]), credStub());
  await run(ctxBase({ inboundVerbatimText: 'sim' }));
  assert.ok(calls.markers.length > 0);
  for (const m of calls.markers) assert.strictEqual(m.raw, null, `logMarker ${m.type}/${m.result} levou raw`);
});

// =====================================================================
// Apagar a inbound do turno — a defesa que nao depende de reconhecer o segredo
// =====================================================================

test('inbound: gatilho e a PRESENCA do marker, nao a flag do turno (fonte)', () => {
  // `_credenciaisNoTurno` tambem liga no two-pass de LEITURA (<<PEDIR_CREDENCIAIS>>), onde
  // a mensagem da pessoa e so uma pergunta: apagar ali destruiria historico util a troco
  // de nada. O gatilho tem de ser o marker.
  const m = execSrc.match(/if \((_temMarker|_credenciaisNoTurno)\) \{[\s\S]{0,400}?apagarInboundDeCredencial/);
  assert.ok(m, 'a chamada de apagarInboundDeCredencial sumiu do executor');
  assert.strictEqual(m[1], '_temMarker',
    `gatilho e "${m[1]}" — com _credenciaisNoTurno um turno de LEITURA apagaria a pergunta da pessoa`);
});

test('inbound: payload VALIDO apaga a inbound e registra com o id do colaborador', async () => {
  cenario(piStub([]), credStub());
  await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'Canva', campos: [{ label: 'Senha', valor: 'hunter2', sensivel: true }] }) }));
  assert.deepStrictEqual(calls.apagar, [{ cid: 'collab-1', wa: 'WA-TURNO' }]);
  const reg = calls.markers.filter((m) => m.type === 'CREDENCIAL_INBOUND_APAGADA');
  assert.strictEqual(reg.length, 1, 'sem registro nao da pra provar depois que a defesa rodou');
  assert.strictEqual(reg[0].result, 'executed');
  assert.strictEqual(reg[0].raw, null);
});

test('inbound: payload INVALIDO tambem apaga — a mensagem carregou credencial do mesmo jeito', async () => {
  cenario(piStub([]), credStub());
  await run(ctxBase({ reply: 'Ok!\n<<CREDENCIAL_ACTION>>{"action":"create","campos":[{"label":"senha","valor":"hunter2"' }));
  assert.deepStrictEqual(calls.apagar, [{ cid: 'collab-1', wa: 'WA-TURNO' }]);
});

test('inbound: NAO-admin tambem tem a inbound apagada', async () => {
  cenario(piStub([]), credStub({ getCredenciaisPara: async () => ({ isAdmin: false, creds: [] }) }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'X', campos: [{ label: 'Senha', valor: 'p' }] }) }));
  assert.deepStrictEqual(calls.apagar, [{ cid: 'collab-1', wa: 'WA-TURNO' }],
    'a mensagem de quem nao e admin tambem nao pode ficar no historico');
  assert.ok(!/credenci/i.test(r.reply));
});

test('inbound: turno de LEITURA (PEDIR_CREDENCIAIS) NAO apaga nada', async () => {
  // Simula o estado depois do two-pass de leitura: a flag do turno ligada, a reply ja
  // montada a partir da RPC, e NENHUM <<CREDENCIAL_ACTION>> no texto.
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({
    _credenciaisNoTurno: true,
    reply: 'O link do Canva é https://canva.com — o login está com o Luciano.',
  }));
  assert.strictEqual(calls.apagar.length, 0, 'apagou a pergunta de uma consulta de leitura');
  assert.strictEqual(calls.markers.length, 0);
  assert.strictEqual(r.reply, 'O link do Canva é https://canva.com — o login está com o Luciano.');
});

test('inbound: turno sem marker nenhum NAO apaga nada', async () => {
  cenario(piStub([]), credStub());
  await run(ctxBase({ reply: 'Boa! Já anotei aqui.' }));
  assert.strictEqual(calls.apagar.length, 0);
});

test('inbound: falha ao apagar NAO derruba o turno e fica registrada como rejected', async () => {
  cenario(piStub([]), credStub({
    apagarInboundDeCredencial: async (cid, wa) => { calls.apagar.push({ cid, wa }); return { ok: false, erro: 'permission denied' }; },
  }));
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'Canva', campos: [] }) }));
  assert.strictEqual(calls.apagar.length, 1);
  const reg = calls.markers.filter((m) => m.type === 'CREDENCIAL_INBOUND_APAGADA');
  assert.strictEqual(reg[0].result, 'rejected');
  assert.match(reg[0].reason, /permission denied/);
  assert.match(r.reply, /Confirma\?/, 'a falha da faxina nao pode derrubar a confirmacao');
});

test('inbound: sem whatsapp_message_id o servico ainda e chamado (ele acha a mais recente)', async () => {
  cenario(piStub([]), credStub());
  await run(ctxBase({ _inboundWaId: null, reply: MARKER({ action: 'create', nome: 'X', campos: [] }) }));
  assert.deepStrictEqual(calls.apagar, [{ cid: 'collab-1', wa: null }]);
});

test('inbound: CREDENCIAL_INBOUND_APAGADA esta na lista de markers NAO-dominio do engine', () => {
  // Se ficasse de fora, um `executed` de faxina encheria `marker_emitted` e desarmaria o
  // chokepoint num turno em que NADA foi persistido (o executor so abre a confirmacao).
  const linha = ENGINE_SRC_LINES.find((l) => l.includes('const _NON_DOMAIN_MARKERS ='));
  assert.ok(linha, 'lista _NON_DOMAIN_MARKERS nao encontrada em engine.js');
  assert.match(linha, /CREDENCIAL_INBOUND_APAGADA/);
});

// =====================================================================
// RETRY DE CREDENCIAL SEM MARKER (Camada 1) — caso Hugo 04/09 17:21
// O TOM propos o cadastro em prosa, sem marker. Sem marker nada roda: nenhuma intent nasce,
// nada e gravado, a senha vai em claro na tela — e no turno seguinte o auto-resolve generico
// manda pedir os dados de novo. O retry converte a fala no marker AINDA NESTE TURNO, e o
// executor assume: mascara, abre a confirmacao e apaga a inbound.
// =====================================================================

// Reproducao do question_text real gravado em pending_intents naquele turno (valores trocados).
const FALA_SEM_MARKER = [
  'Vou cadastrar:',
  '',
  '*Conta do Google Ads*',
  'Login: contato@lamusic.com.br',
  'Senha: hunter2',
  '',
  'Confirma?',
].join('\n');

const aiQueDevolve = (texto) => {
  const vistos = [];
  return { vistos, chat: async (sys) => { vistos.push(sys); return { text: texto }; } };
};

test('retry: fala sem marker vira marker, executor assume e a senha some da resposta', async () => {
  cenario(piStub([]), credStub());
  const ai = aiQueDevolve(MARKER({
    action: 'create', nome: 'Conta do Google Ads', categoria: 'plataforma', servico: 'Google',
    campos: [{ label: 'Login', valor: 'contato@lamusic.com.br', sensivel: false },
             { label: 'Senha', valor: 'hunter2', sensivel: true }],
  }));
  const r = await run(ctxBase({ reply: FALA_SEM_MARKER, inboundVerbatimText: 'guarda ai: login contato@lamusic.com.br senha hunter2', ai }));

  assert.ok(!/hunter2/.test(r.reply), 'a senha continuou em claro na resposta: ' + r.reply);
  assert.match(r.reply, /●●●●●●/);
  assert.ok(r.reply.includes('Confirma?'), 'nao virou confirmacao do executor: ' + r.reply);
  assert.strictEqual(calls.upsert.length, 0, 'gravou sem confirmacao');
  assert.strictEqual(calls.open.length, 1, 'nao abriu a intent — o "sim" seguinte cairia no vazio');
  assert.strictEqual(calls.open[0].kind, 'credencial_write');
  assert.strictEqual(calls.open[0].payload.modo, 'create');
  assert.strictEqual(calls.apagar.length, 1, 'nao apagou a inbound com a credencial');
  assert.deepStrictEqual(
    calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').map((m) => m.result + ':' + m.reason),
    ['executed:marker_recuperado']);
  // O mini-prompt precisa dos DOIS lados: a fala do TOM (o que ele propos) e a mensagem da
  // pessoa (de onde vem o valor letra por letra). Sem a segunda ele inventaria a senha.
  assert.ok(ai.vistos[0].includes('Vou cadastrar:'), 'o prompt do retry nao levou a fala do TOM');
  assert.ok(ai.vistos[0].includes('guarda ai'), 'o prompt do retry nao levou a mensagem da pessoa');
});

test('retry: NO_MARKER deixa a resposta do modelo como estava e nao abre intent', async () => {
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: FALA_SEM_MARKER, ai: aiQueDevolve('NO_MARKER') }));
  assert.strictEqual(r.reply, FALA_SEM_MARKER);
  assert.strictEqual(calls.open.length, 0);
  assert.strictEqual(calls.upsert.length, 0);
  assert.deepStrictEqual(
    calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').map((m) => m.result + ':' + m.reason),
    ['rejected:sem_marker_valido']);
});

test('retry: marker invalido devolvido pelo modelo nao e anexado', async () => {
  cenario(piStub([]), credStub());
  // action fora do enum: parseCredencialAction devolve null. Anexar assim mesmo faria o
  // executor cair no ramo payload_invalido e trocar a resposta por "nao entendi" — pior
  // que deixar a fala original.
  const r = await run(ctxBase({ reply: FALA_SEM_MARKER, ai: aiQueDevolve(MARKER({ action: 'inventada', nome: 'X' })) }));
  assert.strictEqual(r.reply, FALA_SEM_MARKER);
  assert.strictEqual(calls.open.length, 0);
  assert.deepStrictEqual(
    calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').map((m) => m.reason), ['sem_marker_valido']);
});

test('retry: nao-admin nao chama o modelo nem abre intent', async () => {
  cenario(piStub([]), credStub({ getCredenciaisPara: async () => ({ isAdmin: false, creds: [] }) }));
  // ctxBase manda ai.chat estourar: se for chamado, o teste quebra.
  const r = await run(ctxBase({ reply: FALA_SEM_MARKER }));
  assert.strictEqual(r.reply, FALA_SEM_MARKER);
  assert.strictEqual(calls.open.length, 0);
  assert.strictEqual(calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').length, 0);
});

test('retry: turno de LEITURA (_credenciaisNoTurno) nunca chama o modelo', async () => {
  // A resposta do two-pass traz ficha com rotulos reais; se um verbo de escrita aparecer nela
  // o gate puro dispara. Quem barra e esta guarda — por isso ela e testada aqui.
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({
    reply: 'Anotei aqui pra voce:' + '\n' + 'Login: a@b.com' + '\n' + 'Senha: hunter2',
    _credenciaisNoTurno: true,
  }));
  assert.strictEqual(calls.open.length, 0);
  assert.strictEqual(calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').length, 0);
  assert.ok(r.reply.includes('hunter2'), 'a resposta de leitura foi adulterada');
});

test('retry: conversa que nao e ficha de credencial nao chama o modelo', async () => {
  cenario(piStub([]), credStub());
  const fala = 'Vou cadastrar a tarefa de trocar as lampadas da sala 3. Confirma?';
  const r = await run(ctxBase({ reply: fala }));
  assert.strictEqual(r.reply, fala);
  assert.strictEqual(calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').length, 0);
});

test('retry: nao encadeia em cima do auto-retry de tarefa (_isMarkerRetry)', async () => {
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: FALA_SEM_MARKER, raw: { _isMarkerRetry: true } }));
  assert.strictEqual(r.reply, FALA_SEM_MARKER);
  assert.strictEqual(calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').length, 0);
});

test('retry: turno que JA tem marker nao passa pelo retry', async () => {
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({ reply: MARKER({ action: 'create', nome: 'Canva LA', categoria: 'plataforma' }) }));
  assert.strictEqual(calls.markers.filter((m) => m.type === 'CREDENCIAL_RETRY').length, 0);
  assert.strictEqual(calls.open.length, 1, 'o caminho normal parou de funcionar');
});

test('retry: falha do modelo nao derruba o turno (fail-closed)', async () => {
  cenario(piStub([]), credStub());
  const r = await run(ctxBase({
    reply: FALA_SEM_MARKER,
    ai: { chat: async () => { throw new Error('provider fora do ar'); } },
  }));
  assert.strictEqual(r.reply, FALA_SEM_MARKER);
  assert.strictEqual(calls.open.length, 0);
  assert.strictEqual(calls.upsert.length, 0);
});

// =====================================================================
// CAMADA 2 — auto-resolve generico (engine.js ~10662)
// Se o retry falhar, a confirmacao do turno seguinte cai na intent GENERICA. O ramo sem
// payload concreto mandava "peca pra pessoa repetir o pedido com os detalhes" — foi o engine
// que ditou o "me manda os dados de novo" no caso Hugo. Este bloco nao e extraivel (depende
// do supabase e de meia duzia de variaveis do turno), entao a prova aqui e sobre a FONTE:
// a precedencia e o texto da regra sao verificados no proprio engine.js.
// =====================================================================

const iCredGate = exigir(
  ENGINE_SRC_LINES.findIndex((l) => l.includes('const _liberaCredencial = !hasConcrete && pareceEscritaDeCredencial')),
  'calculo de _liberaCredencial no auto-resolve');
const iCriaGate = exigir(
  ENGINE_SRC_LINES.findIndex((l) => l.includes('const _liberaCriacao = _gateOn && !hasConcrete')),
  'calculo de _liberaCriacao no auto-resolve');

test('camada 2: credencial e avaliada ANTES e VETA o create-gate de tarefa', () => {
  // `podeLiberarCriacao` casa com "vou registrar" — sem o veto, uma proposta de credencial
  // vira TAREFA nova, com o segredo dentro do titulo. A ordem importa: _liberaCredencial
  // tem de existir antes da linha que o consome.
  assert.ok(iCredGate < iCriaGate, 'o gate de credencial passou a ser calculado depois do de criacao');
  assert.ok(ENGINE_SRC_LINES[iCriaGate].includes('!_liberaCredencial'),
    'o create-gate perdeu o veto de credencial: ' + ENGINE_SRC_LINES[iCriaGate]);
});

test('camada 2: o ramo de credencial manda reproduzir, nunca pedir de novo', () => {
  const iRegra = exigir(
    ENGINE_SRC_LINES.findIndex((l) => l.includes('proposta de CADASTRO/ALTERAÇÃO DE CREDENCIAL')),
    'markerRule do ramo de credencial');
  const regra = ENGINE_SRC_LINES[iRegra];
  assert.ok(regra.includes('<<CREDENCIAL_ACTION>>'), 'a regra nao diz qual marker emitir');
  assert.ok(/NÃO peça os dados de novo/.test(regra),
    'a regra deixou de proibir explicitamente pedir os dados de novo — que e o bug de origem');
});

test('camada 2: a pergunta gravada em marker_logs passa pelo redator', () => {
  // question_text de uma proposta de credencial carrega os valores em claro, e raw_excerpt
  // vai pro relatorio das 7h que os diretores recebem no WhatsApp.
  const iTelemetria = exigir(
    ENGINE_SRC_LINES.findIndex((l) => l.includes("'CONFIRM_CREDENCIAL_ALLOWED'")),
    'telemetria do ramo de credencial');
  const trecho = ENGINE_SRC_LINES.slice(iTelemetria, iTelemetria + 8).join('\n');
  assert.ok(trecho.includes('redigirSegredos(String(target.question_text'),
    'a pergunta voltou a ser gravada crua no marker_logs');
});

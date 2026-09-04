'use strict';

const test = require('node:test');
const assert = require('node:assert');

// O gate lê env no require, então cada cenário precisa de um módulo novo.
function carregar(env) {
  const ANTES = { ...process.env };
  Object.assign(process.env, {
    TOM_OPS_ENABLED: '', TOM_OPS_GROUP_ID: '', TOM_OPS_ALLOWLIST: '', ...env,
  });
  delete require.cache[require.resolve('./ops-agent')];
  const mod = require('./ops-agent');
  process.env = ANTES;
  return mod;
}

const GRUPO = 'b3bd198a-c81a-40dc-addc-16838614cbae';   // LA ORGANIZER - TOM
const ALF   = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const HUGO  = 'e75929c3-6ec0-47a5-9d8f-9793e251263a';
const OUTRO = '11111111-2222-3333-4444-555555555555';
const LIGADO = { TOM_OPS_ENABLED: '1', TOM_OPS_GROUP_ID: GRUPO, TOM_OPS_ALLOWLIST: `${ALF},${HUGO}` };

test('libera os dois autorizados no grupo certo', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), true);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: HUGO }), true);
});

// AS DUAS CONDIÇÕES. "É membro do grupo" sozinho faria quem fosse adicionado um dia herdar a
// VPS; "está na allowlist" sozinho daria poder de engenharia no 1:1 e em qualquer outro grupo.
test('NEGA: pessoa autorizada FORA do grupo de ops', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.isOpsChannel({ groupId: 'outro-grupo-qualquer', senderCollabId: ALF }), false);
  assert.strictEqual(m.isOpsChannel({ groupId: null, senderCollabId: ALF }), false);
});

test('NEGA: pessoa NÃO autorizada dentro do grupo de ops', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: OUTRO }), false);
});

test('NEGA: remetente não identificado — sender_id NULL não vira comando', () => {
  const m = carregar(LIGADO);
  for (const s of [null, undefined, '', 0]) {
    assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: s }), false, String(s));
  }
});

// Kill switch e fail-closed de configuração.
test('NEGA: nasce desligado — sem TOM_OPS_ENABLED nada passa', () => {
  const m = carregar({ TOM_OPS_GROUP_ID: GRUPO, TOM_OPS_ALLOWLIST: `${ALF},${HUGO}` });
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false);
});

test('NEGA: flag em qualquer valor que não seja exatamente "1"', () => {
  for (const v of ['0', 'true', 'sim', 'yes', ' 1']) {
    const m = carregar({ ...LIGADO, TOM_OPS_ENABLED: v });
    assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false, `flag="${v}"`);
  }
});

test('NEGA: ligado mas sem grupo ou sem allowlist configurados', () => {
  const semGrupo = carregar({ TOM_OPS_ENABLED: '1', TOM_OPS_ALLOWLIST: ALF });
  assert.strictEqual(semGrupo.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false);
  const semLista = carregar({ TOM_OPS_ENABLED: '1', TOM_OPS_GROUP_ID: GRUPO });
  assert.strictEqual(semLista.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), false);
});

test('allowlist tolera espaços na env sem perder a checagem', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_ALLOWLIST: ` ${ALF} , ${HUGO} ` });
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: ALF }), true);
  assert.strictEqual(m.isOpsChannel({ groupId: GRUPO, senderCollabId: OUTRO }), false);
});

// O briefing é o que impede o agente de redescobrir a casa a cada pedido — e o que fixa o
// que ele NÃO faz. Se alguém apagar isso, o agente perde os limites sem nada quebrar.
test('briefing carrega quem pediu e os limites', () => {
  const m = carregar(LIGADO);
  const b = m.buildBriefing('Hugo');
  assert.match(b, /Hugo/);
  assert.match(b, /N[ÃA]O apague dado de produ[çc][ãa]o/i);
  assert.match(b, /soul\/|skills\//);
  assert.match(b, /tom_known_issues/);
  assert.match(b, /tom-error\.log/);
});

// PEDIDO PERDIDO NO RESTART (Alf, 08/08 19:29) — o pior sintoma possível: silêncio.
// O CLI roda como processo FILHO do TOM. `pm2 restart` mata o pai, o filho morre junto e o
// `.then()` que postaria a resposta nunca roda. Não há erro, não há log, não há aviso: a
// pessoa fica olhando pro "Tô nisso" pra sempre. E o auto-deploy reinicia a CADA push, então
// isto não é exceção — é o caminho comum.
test('pedido em andamento fica registrado e some quando termina', () => {
  const m = carregar(LIGADO);
  assert.deepStrictEqual(m.pedidosEmAndamento(), []);
  const id = m._registrarPedido('Alf', 'roda a auditoria');
  assert.strictEqual(m.pedidosEmAndamento().length, 1);
  assert.strictEqual(m.pedidosEmAndamento()[0].quem, 'Alf');
  m._concluirPedido(id);
  assert.deepStrictEqual(m.pedidosEmAndamento(), []);
});

test('sem pedido em andamento não há aviso — reinício limpo é silencioso', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.textoDePedidosPerdidos(), null);
});

test('aviso nomeia quem pediu e diz o que fazer', () => {
  const m = carregar(LIGADO);
  m._registrarPedido('Hugo', 'me traz os erros de ontem do financeiro');
  const t = m.textoDePedidosPerdidos();
  assert.match(t, /Hugo/);
  assert.match(t, /me traz os erros/);
  assert.match(t, /manda de novo|pede de novo/i);
  assert.ok(!t.includes('**'), 'markdown não renderiza no zap');
});

test('aviso cobre TODOS os pedidos perdidos, não só o primeiro', () => {
  const m = carregar(LIGADO);
  m._registrarPedido('Alf', 'primeiro pedido');
  m._registrarPedido('Hugo', 'segundo pedido');
  const t = m.textoDePedidosPerdidos();
  assert.match(t, /primeiro pedido/);
  assert.match(t, /segundo pedido/);
});

test('pedido muito longo é cortado no aviso', () => {
  const m = carregar(LIGADO);
  m._registrarPedido('Alf', 'x'.repeat(400));
  assert.ok(m.textoDePedidosPerdidos().length < 400, 'aviso não pode virar parede');
});

// O texto existir não basta: quem faz ele CHEGAR é o canal, e o drain hook só usa canal que
// alguém tenha configurado. Quem configura é o group-chat-engine, no processo do TOM — o
// gov-runner roda em processo próprio e nunca configurou, então lá o aviso morria no `if
// (!_canalAviso) return` e um restart no meio do ciclo era silêncio total.
test('sem canal configurado, o aviso de reinício não chega a ninguém', async () => {
  const m = carregar(LIGADO);
  m._registrarPedido('Alf', 'roda a auditoria');
  const r = await m.avisarPedidosPerdidos();
  assert.strictEqual(r.avisou, false);
  assert.match(r.motivo, /canal/i);
});

test('com o canal ligado, o aviso de reinício chega inteiro', async () => {
  const m = carregar(LIGADO);
  const postadas = [];
  m.configurarCanalAviso((t) => { postadas.push(t); return { id: 'm1' }; });
  m._registrarPedido('Hugo', 'me traz os erros de ontem');
  const r = await m.avisarPedidosPerdidos();
  assert.strictEqual(r.avisou, true);
  assert.strictEqual(postadas.length, 1);
  assert.match(postadas[0], /Hugo/);
});

test('reinício limpo não avisa nada, nem com o canal ligado', async () => {
  const m = carregar(LIGADO);
  const postadas = [];
  m.configurarCanalAviso((t) => { postadas.push(t); return { id: 'm1' }; });
  const r = await m.avisarPedidosPerdidos();
  assert.strictEqual(r.avisou, false);
  assert.strictEqual(postadas.length, 0, 'reinício limpo não pode acordar o grupo');
});

test('canal que quebra não derruba o shutdown', async () => {
  const m = carregar(LIGADO);
  m.configurarCanalAviso(() => { throw new Error('uazapi 503'); });
  m._registrarPedido('Alf', 'roda a auditoria');
  const r = await m.avisarPedidosPerdidos();
  assert.strictEqual(r.avisou, false);
  assert.match(r.motivo, /503/);
});

// As regras de entrega vivem num .md editável sem deploy. Se o caminho quebrar, o agente
// volta a despejar parede de texto no WhatsApp sem nada falhar — daí o teste.
const FORMATO = require('path').join(__dirname, '../../docs/ops/FORMATO-GRUPO.md');

test('briefing embute as regras de formato do grupo', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_FORMATO: FORMATO });
  const b = m.buildBriefing('Alf');
  assert.match(b, /at[ée] 15 linhas/i);
  assert.match(b, /Exemplo bom/);
  assert.ok(b.length > 2000, `briefing curto demais (${b.length}) — o .md não entrou`);
});

test('arquivo de formato ausente não derruba o briefing', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_FORMATO: '/caminho/que/nao/existe.md' });
  const b = m.buildBriefing('Alf');
  assert.match(b, /Alf/);
  assert.match(b, /N[ÃA]O apague dado de produ[çc][ãa]o/i);
});

// ── A VOZ DO TOM CHEGA NO GRUPO DE OPS ──────────────────────────────────────────────────────
// Até 04/09 o briefing levava só o FORMATO (como entregar) e personalidade NENHUMA: o agente
// daqui era o mesmo nome com outra pessoa dentro. A prova tem que ser de PROPAGAÇÃO, não de
// redação — o que entra no briefing precisa ser byte a byte o `soul/SOUL.md`, a mesma fonte do
// 1:1 e do chat de grupo com a equipe. Se um dia alguém "melhorar a voz" escrevendo direto no
// briefing, nasce um segundo TOM e é este assert que cai.
const SOUL = require('path').join(__dirname, '../../soul/SOUL.md');

test('briefing carrega a voz do TOM do soul/SOUL.md — byte a byte, não em resumo', () => {
  const soul = require('fs').readFileSync(SOUL, 'utf8').trim();
  const m = carregar({ ...LIGADO, TOM_OPS_FORMATO: FORMATO });
  const b = m.buildBriefing('Alf');
  assert.ok(b.includes(soul), 'o SOUL não entrou inteiro no briefing do ops');
  assert.match(b, /soul\/SOUL\.md/, 'a voz precisa entrar rotulada com a origem');
  assert.ok(soul.length > 1500, `SOUL suspeito de estar vazio/truncado (${soul.length})`);
});

// A disciplina de ops é o que já era bom aqui e não pode sair junto com o formulário.
test('a voz entra SEM tirar a disciplina de ops do briefing', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_FORMATO: FORMATO });
  const b = m.buildBriefing('Alf');
  assert.match(b, /Date antes de somar/i, 'conferir data antes de somar');
  assert.match(b, /nunca diga que fez o que n[ãa]o fez/i);
  assert.match(b, /reproduza/i, 'medir/reproduzir antes de afirmar');
  assert.match(b, /N[ÃA]O altere a voz do TOM/i, 'ler o soul, sim; alterar, não');
});

// O eco de recebimento: nem o código o gera mais, nem o briefing pode voltar a pedi-lo.
test('nenhum eco de recebimento sobrou no briefing montado', () => {
  const m = carregar({ ...LIGADO, TOM_OPS_FORMATO: FORMATO });
  const b = m.buildBriefing('Alf');
  assert.ok(!/Peguei[^\n]*[:"]/.test(b), 'o template do eco voltou pro briefing');
  assert.ok(!/vou olhar e te falo/i.test(b), 'a frase do eco voltou pro briefing');
  assert.match(b, /comece pela resposta/i, 'o briefing precisa mandar começar pela resposta');
});

// RELATÓRIO DEIXOU DE SER O PADRÃO. Não basta o .md dizer "conversa também vale": enquanto a
// estrutura obrigatória vier antes e solta, ela é lida como regra geral. A prova é de ORDEM e
// de ESCOPO — a estrutura de laudo tem que viver dentro da seção condicional.
test('FORMATO-GRUPO: conversa é o padrão e relatório é o caso condicional', () => {
  const md = require('fs').readFileSync(FORMATO, 'utf8');
  // Ancorado no TÍTULO (`## `): a seção de conversa cita o nome da outra pra dizer que ela fica
  // desligada, e casar pelo nome solto apontava pra essa citação, não pra seção.
  const conversa = md.indexOf('## O padrão é conversa');
  const relatorio = md.indexOf('## Quando pedirem um relatório');
  assert.ok(conversa > 0, 'sumiu a seção de conversa');
  assert.ok(relatorio > 0, 'sumiu a seção de relatório — ela continua existindo, só não é padrão');
  assert.ok(conversa < relatorio, 'conversa tem que vir antes do relatório');
  // O alvo de 15 linhas e a estrutura 1/2/3 são de laudo: fora da seção, viram regra geral.
  assert.ok(md.indexOf('até 15 linhas') > relatorio, 'o alvo de 15 linhas escapou pra fora do relatório');
  assert.ok(md.indexOf('Primeira linha responde') > relatorio, 'a estrutura de laudo escapou pra fora');
  // O que é genuinamente de WhatsApp fica valendo sempre — antes da seção condicional.
  assert.ok(md.indexOf('Formatação') < relatorio, 'as marcações do WhatsApp valem sempre');
});

// O canal de ops JÁ ESTÁ EM PRODUÇÃO. Estes parâmetros existem para o agente de governança
// reusar o spawn sem herdar o briefing genérico — e não podem mudar nada do que já roda.
test('runOpsAgent aceita briefing próprio sem alterar o padrão', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(typeof m.resolverBriefing, 'function');
  assert.strictEqual(m.resolverBriefing('Alf', 'PROTOCOLO XYZ'), 'PROTOCOLO XYZ');
  assert.match(m.resolverBriefing('Alf', null), /Alf/);
  assert.match(m.resolverBriefing('Alf', '   '), /Alf/, 'briefing em branco cai no padrão');
});

test('runOpsAgent aceita timeout próprio, com o default intacto', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.resolverTimeout(1800000), 1800000);
  assert.strictEqual(m.resolverTimeout(undefined), m.OPS_TIMEOUT_MS);
  assert.strictEqual(m.resolverTimeout(0), m.OPS_TIMEOUT_MS, 'zero não pode virar timeout imediato');
  assert.strictEqual(m.resolverTimeout(-5), m.OPS_TIMEOUT_MS);
  assert.strictEqual(m.resolverTimeout('abc'), m.OPS_TIMEOUT_MS);
});

// ── CUSTO DA RODADA NO CANAL INTERATIVO ────────────────────────────────────────────────────
// O ciclo automático grava o custo no `detail` do ritual_logs, mas o canal interativo não tem
// linha em ritual_logs nenhuma (é sob demanda, sem reference_date). Guardar o custo dele no
// banco exigiria tabela nova — que é feature, e o freeze está de pé. O meio-termo é o log:
// mesmo dialeto `custo=` do detail, então UM grep em /opt/LA-Organizer/logs/ pega os dois.
test('linhaDeCusto formata a linha de log com o mesmo dialeto do detail', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.linhaDeCusto('Alf', 0.8123456789), '[OpsAgent] custo=0.812346 quem="Alf"');
});

test('linhaDeCusto: zero é custo, não ausência', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.linhaDeCusto('Alf', 0), '[OpsAgent] custo=0 quem="Alf"');
});

// Sem número não existe linha pra logar: "custo=null" no log é pior que log nenhum, porque
// entra no mesmo grep de quem for somar depois.
test('linhaDeCusto devolve null quando o CLI não mandou custo', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.linhaDeCusto('Alf', null), null);
  assert.strictEqual(m.linhaDeCusto('Alf', undefined), null);
  assert.strictEqual(m.linhaDeCusto('Alf', NaN), null);
});

// ── ACK DO PEDIDO ───────────────────────────────────────────────────────────────────────────
// Bug do Alf, 31/08: o ack era constante, então "👀" e um pedido de 40 linhas recebiam a MESMA
// frase. O contrato que estes testes prendem é o que faltava: o ack tem que PROVAR leitura.

test('ack: pedido curto ganha aceno curto, sem citar', () => {
  const m = carregar(LIGADO);
  const a = m.ackDoPedido('👀', 'Alf');
  assert.ok(a.includes('Alf'), a);
  assert.ok(!a.includes('"'), `curto não cita: ${a}`);
});

test('ack: pedido com itens enumerados devolve a CONTA', () => {
  const m = carregar(LIGADO);
  const pedido = 'Tom, tres coisas:\n1. o vizinho do regex\n2. a regra do verified_note\n3. a decisao de desenho';
  assert.ok(m.ackDoPedido(pedido, 'Alf').includes('3'), m.ackDoPedido(pedido, 'Alf'));
});

// ECO DE RECEBIMENTO (invertido em 04/09). O ack longo devolvia a frase da pessoa entre aspas.
// Como o engine posta o ack em TODO turno do canal, papo casual também levava a pergunta de
// volta — recibo, não conversa. Este teste agora prende o contrário: NENHUM formato de pedido
// pode aparecer citado no ack.
test('ack: NUNCA devolve o pedido em eco — nem citado, nem parafraseado', () => {
  const m = carregar(LIGADO);
  const pedidos = [
    'Tom, conta quantos arquivos tem em src/services e me diz o numero',
    'Le os ultimos 3000 registros do tom-out.log e cruza com marker_logs pra ver o que sobrou',
    'coe Tom, e ai, deu certo aquilo do financeiro que a gente falou ontem de manha?',
  ];
  for (const p of pedidos) {
    const a = m.ackDoPedido(p, 'Alf');
    assert.ok(!a.includes('"'), `ack citou o pedido: ${a}`);
    // Nenhuma palavra de 6+ letras do pedido pode reaparecer no ack: é assim que o eco volta
    // disfarçado de "resumo do que entendi".
    for (const w of p.toLowerCase().match(/[a-z_]{6,}/g) || []) {
      assert.ok(!a.toLowerCase().includes(w), `ack repetiu "${w}" do pedido: ${a}`);
    }
  }
});

test('ack: pedidos DIFERENTES não podem receber a mesma frase (a regressão de 31/08)', () => {
  const m = carregar(LIGADO);
  const curto = m.ackDoPedido('👀', 'Alf');
  const longo = m.ackDoPedido('Le os ultimos 3000 registros do tom-out.log e cruza com marker_logs', 'Alf');
  const lista = m.ackDoPedido('Tom:\n1. um\n2. dois', 'Alf');
  assert.notStrictEqual(curto, longo);
  assert.notStrictEqual(longo, lista);
  assert.notStrictEqual(curto, lista);
});

test('ack: CONTRATO — sempre string não-vazia, inclusive no vazio/null', () => {
  const m = carregar(LIGADO);
  // Devolver vazio faria o postTomText entregar nada e o watcher ler o turno como não-atendido.
  for (const entrada of ['', null, undefined, '   ', '\n\n']) {
    const a = m.ackDoPedido(entrada, 'Alf');
    assert.strictEqual(typeof a, 'string');
    assert.ok(a.trim().length > 0, JSON.stringify(entrada));
  }
});

test('ack: remetente desconhecido não vira nome falso', () => {
  const m = carregar(LIGADO);
  assert.ok(!m.ackDoPedido('👀', 'alguém do grupo').includes('alguém do grupo'));
  assert.ok(!m.ackDoPedido('👀', null).includes('null'));
});

test('contarItensDoPedido: só conta marcador que ABRE a linha', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.contarItensDoPedido('1. um\n2. dois\n3) tres'), 3);
  assert.strictEqual(m.contarItensDoPedido('- um\n• dois\n* tres'), 3);
  // "1998" no meio da prosa não é item — senão qualquer texto com número vira "lista".
  assert.strictEqual(m.contarItensDoPedido('em 1998 foram 2 casos e 3 alertas'), 0);
  assert.strictEqual(m.contarItensDoPedido(''), 0);
});

// ── PAPO CURTO NÃO GERA ACENO (04/09, reclamação do Alf com todas as letras) ────────────────
// O engine postava o ack em TODO turno do canal de ops. Numa pergunta curta isso vira DUAS
// mensagens para uma pergunta — protocolo, não conversa. O ack continua existindo e continua
// sempre devolvendo string (o contrato acima não muda); o que passa a ser condicional é POSTAR.
// A regra mora aqui, ao lado do ack, porque usa exatamente o mesmo conhecimento (a conta de
// itens e o corte de tamanho); quem age em cima dela é o group-chat-engine.
test('mereceAck: frase curta de conversa não merece aceno — o "digitando" já basta', () => {
  const m = carregar(LIGADO);
  for (const p of ['👀', 'coé Tom', 'e aí, deu certo?', 'Tom, roda os testes', 'blz?']) {
    assert.strictEqual(m.mereceAck(p), false, `não podia acenar: ${p}`);
  }
});

test('mereceAck: pauta enumerada merece aceno mesmo sendo curta — quem enumera passa trabalho', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.mereceAck('Tom:\n1. um\n2. dois'), true);
  assert.strictEqual(m.mereceAck('- um\n- dois\n- tres'), true);
});

test('mereceAck: pedido denso merece aceno — vai demorar minutos', () => {
  const m = carregar(LIGADO);
  const denso = 'Le os ultimos 3000 registros do tom-out.log e cruza com marker_logs pra ver o que sobrou';
  assert.ok(denso.length > m.ACK_CURTO_MAX);
  assert.strictEqual(m.mereceAck(denso), true);
});

test('mereceAck: mensagem vazia não merece aceno (não é pedido)', () => {
  const m = carregar(LIGADO);
  for (const p of ['', null, undefined, '   ']) assert.strictEqual(m.mereceAck(p), false, JSON.stringify(p));
});

// O corte é EXATAMENTE o ramo do aceno curto: se um dia alguém mexer no ACK_CURTO_MAX, os dois
// lados andam juntos e ninguém volta a postar "Opa — deixa eu ver aqui" em cima de um papo.
test('mereceAck: o silêncio cobre exatamente o ramo do aceno curto do ackDoPedido', () => {
  const m = carregar(LIGADO);
  const curto = 'x'.repeat(m.ACK_CURTO_MAX);
  const passou = 'x'.repeat(m.ACK_CURTO_MAX + 1);
  assert.match(m.ackDoPedido(curto, 'Alf'), /Opa/, 'esse é o ramo curto');
  assert.strictEqual(m.mereceAck(curto), false);
  assert.strictEqual(m.mereceAck(passou), true);
});

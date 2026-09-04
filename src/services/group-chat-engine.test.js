// src/services/group-chat-engine.test.js — buildTomContent (montagem prosa+ações) e a
// ENTREGA no grupo (postOpsResult), que é o que o ciclo de governança usa como prova de envio.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildTomContent, ACTIONS_DELIM, friendlyTaskFail, postOpsResult } = require('./group-chat-engine');

const prose = (c) => String(c).split(ACTIONS_DELIM)[0].trim();

test('sem ação: prosa pura, sem bloco ACTIONS', () => {
  const c = buildTomContent('Beleza, Rose!', []);
  assert.equal(c, 'Beleza, Rose!');
  assert.ok(!c.includes(ACTIONS_DELIM));
});

test('ação ok + prosa: mantém a prosa do LLM e anexa o bloco', () => {
  const c = buildTomContent('Criei a tarefa!', [{ kind: 'task', status: 'ok', label: 'Tarefa' }]);
  assert.match(c, /^Criei a tarefa!/);
  assert.ok(c.includes(ACTIONS_DELIM));
});

test('FALHA com prosa otimista do LLM: descarta a mentira E manda falha HONESTA (nunca muda no zap)', () => {
  const c = buildTomContent('Pronto, apaguei a tarefa! ✅', [
    { kind: 'task', status: 'fail', label: 'Tarefa', detail: 'não consegui registrar' },
  ]);
  assert.ok(!c.includes('apaguei'), 'não pode repetir a prosa otimista falsa');
  // PROVA do bug Rose 15/06: a prosa (antes do ACTIONS) NÃO pode ser vazia, senão o bridge-out não espelha.
  assert.ok(prose(c).length > 0, 'prosa de falha não pode ser vazia');
  assert.match(prose(c), /não consegui registrar/);
  assert.ok(c.includes(ACTIONS_DELIM));
});

test('FALHA sem prosa nenhuma: ainda manda prosa honesta com o motivo', () => {
  const c = buildTomContent('', [{ kind: 'task', status: 'fail', label: 'Tarefa', detail: 'não achei essa tarefa' }]);
  assert.ok(prose(c).length > 0);
  assert.match(prose(c), /não achei essa tarefa/);
});

test('ação ok SEM prosa: INALTERADO (só o bloco ACTIONS — sucesso não regride)', () => {
  const c = buildTomContent('', [{ kind: 'task', status: 'ok', label: 'Tarefa' }]);
  assert.equal(prose(c), ''); // sucesso sem prosa segue igual ao antes do fix (zero regressão)
  assert.ok(c.includes(ACTIONS_DELIM));
});

test('só <<SILENCIO>> e sem ação → null (silêncio real)', () => {
  assert.equal(buildTomContent('<<SILENCIO>>', []), null);
});

test('prosa vazia e sem ação → null', () => {
  assert.equal(buildTomContent('   ', []), null);
});

test('friendlyTaskFail: not_found vira explicação útil; motivo desconhecido cai no genérico', () => {
  assert.match(friendlyTaskFail('not_found_in_group'), /não achei.*grupo/);
  assert.match(friendlyTaskFail('not_found_in_pool'), /não achei/);
  assert.equal(friendlyTaskFail('xpto-desconhecido'), 'não consegui registrar');
});

// ── ENTREGA NO GRUPO: postOpsResult TEM QUE FALHAR ALTO ────────────────────────────────────
// GOVLOG-SEM-ENTREGA (09/08): `postTomText` devolve null quando o insert em group_chat_messages
// falha, e `postOpsResult` engolia isso. Quem chama — o ciclo de governança — via um `await`
// que resolveu normalmente, gravava `sent` em ritual_logs, e o gate de idempotência bloqueava o
// retry do dia. O relatório nunca chegava ao grupo, em silêncio: o gate virava mordaça.
// Pior no caso PARCIAL: com a parte 2 de 4 falhando, o loop seguia postando 3 e 4 e ninguém
// notava — o grupo ficava com um relatório furado, sem o pedaço do meio.

/** Supabase de mentira: falha o N-ésimo insert (0 = nunca falha). Registra o que foi postado. */
function sbQueFalhaNa(enesimo) {
  const postadas = [];
  return {
    postadas,
    from: () => ({
      insert: (row) => {
        postadas.push(String(row.content));
        const n = postadas.length;
        return { select: () => ({ single: async () => (n === enesimo
          ? { data: null, error: { message: 'duplicate key value violates unique constraint' } }
          : { data: { id: `m${n}` }, error: null }) }) };
      },
    }),
  };
}

// 4 blocos de 1000 chars: cada um cabe no limite de 1200, mas dois não — vira 4 mensagens.
const QUATRO_PARTES = ['a', 'b', 'c', 'd'].map((c) => c.repeat(1000)).join('\n\n');

test('postOpsResult: entrega inteira ok → resolve com a última mensagem', async () => {
  const sb = sbQueFalhaNa(0);
  const r = await postOpsResult(sb, 'g1', QUATRO_PARTES);
  assert.strictEqual(sb.postadas.length, 4, 'o texto tem que sair em 4 mensagens');
  assert.strictEqual(r.id, 'm4');
});

test('postOpsResult: insert falhou → REJEITA em vez de devolver null em silêncio', async () => {
  const sb = sbQueFalhaNa(1);
  await assert.rejects(
    () => postOpsResult(sb, 'g1', 'relatório do ciclo'),
    /entrega|não postei|não cheguei a postar/i,
  );
});

test('postOpsResult: entrega PARCIAL (parte 2 de 4) rejeita, para de postar e diz quantas foram', async () => {
  const sb = sbQueFalhaNa(2);
  await assert.rejects(() => postOpsResult(sb, 'g1', QUATRO_PARTES), (e) => {
    assert.strictEqual(e.entregues, 1, 'tem que dizer quantas partes o grupo recebeu');
    assert.strictEqual(e.total, 4);
    return true;
  });
  assert.strictEqual(sb.postadas.length, 2,
    'seguiu postando depois da falha: o grupo fica com relatório furado e ninguém detecta');
});

test('postOpsResult: agente sem texto — se nem o aviso entrar, também rejeita', async () => {
  const sb = sbQueFalhaNa(1);
  await assert.rejects(() => postOpsResult(sb, 'g1', '   '));
});

// ── GROUP-NOTE-CONFAB (Clayton, Recreio 02/09) ────────────────────────────────────────────
// A regra anti-mentira acima só olhava ação que FALHOU. Quando o LLM não emite marker NENHUM
// e mesmo assim afirma a escrita na prosa, `actions` vem VAZIO, `hasFailure` é false, e a
// afirmação passa inteira. Caso real, primeira hora de uso do grupo do Recreio: o Clayton
// explicou que o 6o contrato não sai (aluno em aviso prévio), o TOM respondeu "Anotado aqui
// pra contexto" e `group_notes` do grupo ficou com ZERO linhas.
// Reusa o MESMO chokepoint do 1:1 (enforceNoMarkerHonesty) — fonte única de vocabulário.
test('CASO REAL Kaique: afirma "Anotado" sem marker nenhum → não passa como verdade', () => {
  const c = buildTomContent(
    'Entendido, Clayton! Então tá tudo certo — ficamos com os 5 contratos mesmo, e o Kaique Batista já sai depois do aviso prévio. Anotado aqui pra contexto.',
    []);
  assert.match(c, /não consegui registrar/i, 'a fala precisa admitir que nada foi gravado');
});

test('ZERO-REGRESSÃO: afirmar escrita COM ação ok segue passando intacto', () => {
  const c = buildTomContent('Feito! Anotei aqui pra vocês.', [{ kind: 'note', status: 'ok', label: 'Kaique' }]);
  assert.doesNotMatch(c, /não consegui registrar/i);
  assert.match(c, /Anotei aqui/);
});

test('ZERO-REGRESSÃO: conversa social sem ação nenhuma não é acusada', () => {
  for (const fala of ['Eai Clayton! 👽 Obrigado pelo acesso!', 'De nada, Clayton! 👽', 'Bom dia, pessoal!']) {
    const c = buildTomContent(fala, []);
    assert.doesNotMatch(c, /não consegui registrar/i, `falso positivo em: ${fala}`);
  }
});

// FALSEFIRE-COMPOSICAO (Rose ADM 14/08, já pago no 1:1): "Anotado! Pode mandar o próximo" é
// TOM COLETANDO conteúdo, não afirmando escrita. Sem este veto o guard acusa a coleta.
test('content-solicitation ("pode mandar o próximo") não é afirmação de escrita', () => {
  const c = buildTomContent('Anotado! Pode mandar o próximo.', []);
  assert.doesNotMatch(c, /não consegui registrar/i);
});

// Pergunta de confirmação pendente não é afirmação de escrita — a ação ainda vai acontecer.
test('ação pendente de confirmação não dispara o guard', () => {
  const c = buildTomContent('Confirma que é pra apagar a ficha *X*?', [{ kind: 'note', status: 'pending', label: 'X' }]);
  assert.doesNotMatch(c, /não consegui registrar/i);
});

// ── PEDIR NÃO É FALHAR (bateria E2E de 02/09) ─────────────────────────────────────────────
// Grupo que atende mais de uma unidade, pergunta sem unidade: o TOM respondia
// "Opa, tentei mas não consegui concluir agora — me diz de qual unidade". A pergunta estava
// certa e a moldura de erro estava errada. Pedido de informação vira PERGUNTA.
test('ação "ask" vira pergunta, não mensagem de erro', () => {
  const c = buildTomContent('Deixa eu ver aqui 👇', [
    { kind: 'situacao', status: 'ask', label: 'Situação do aluno', detail: 'de qual unidade? Recreio, Barra ou Campo Grande' },
  ]);
  assert.doesNotMatch(c, /não consegui|tentei mas/i, 'perguntar não é falhar');
  assert.match(c, /de qual unidade/i);
  assert.match(c, /Deixa eu ver aqui/, 'a fala do TOM é preservada');
});

test('ask sem prosa nenhuma ainda entrega a pergunta', () => {
  const c = buildTomContent('', [{ kind: 'situacao', status: 'ask', label: 'x', detail: 'de qual unidade?' }]);
  assert.match(c, /de qual unidade/i);
});

test('ZERO-REGRESSÃO: fail de verdade continua com a moldura de erro', () => {
  const c = buildTomContent('Pronto!', [
    { kind: 'situacao', status: 'fail', label: 'Situação do aluno', detail: 'não consegui consultar o LA Report agora' },
  ]);
  assert.match(c, /não consegui/i);
});

test('ask não dispara o chokepoint de escrita sem marker', () => {
  const c = buildTomContent('Anotado, já vou ver', [{ kind: 'situacao', status: 'ask', label: 'x', detail: 'de qual unidade?' }]);
  assert.doesNotMatch(c, /não consegui registrar/i);
});

// ── A NOTA HONESTA É DO SISTEMA, NÃO DO MODELO (Sucesso do Aluno, 02/09) ──────────────────
// A Fabíola apontou que o número não respondia à pergunta dela (mês de matrícula), o TOM
// explicou CERTO que não faz esse filtro — e emendou sozinho "⚠️ Na real não consegui
// registrar isso agora", sem nenhuma ação no turno. Autoacusação falsa na frente da equipe.
// A nota é escrita pelo chokepoint DEPOIS de medir; o modelo nunca deve escrevê-la.
test('nota honesta escrita pelo MODELO é arrancada', () => {
  const c = buildTomContent(
    'Fabi, o filtro aqui é por unidade e por pendência. Mês de matrícula não é um recorte que eu faço.\n\n_⚠️ Na real não consegui registrar isso agora — me manda de novo, por favor._',
    [{ kind: 'situacao', status: 'ok', label: 'x' }]);
  assert.doesNotMatch(c, /não consegui registrar/i);
  assert.match(c, /Mês de matrícula não é um recorte/);
});

test('mas o chokepoint continua podendo ADICIONAR a nota quando mede que nada persistiu', () => {
  const c = buildTomContent('Anotado aqui pra contexto.', []);
  assert.match(c, /não consegui registrar/i, 'a nota do sistema, essa sim, continua valendo');
});

test('a nota do modelo não engana o chokepoint a ponto de sumir com a resposta', () => {
  const c = buildTomContent(
    'Já te mando a lista completa.\n\n⚠️ Na real não consegui registrar isso agora',
    [{ kind: 'situacao', status: 'ok', label: 'x' }]);
  assert.match(c, /Já te mando a lista completa/);
});

// =====================================================================================
// DEFEITO 2 — O POOL DE 30 FAZ O TOM AFIRMAR AUSENCIA A PARTIR DE LISTA TRUNCADA
// (auditoria 04/09, 10:36). O TOM disse que tres anamneses "nao estavam no pool ativo".
// Estavam: `pending`, e so fecharam as 11:01. Ele ainda inventou o motivo ("ja sairam da
// lista"). Raiz: o pool lia 30 tarefas ordenadas por `created_at DESC`, e a pauta do dia
// nasce num LOTE SO (ate 48 filhas por unidade) — a ordem por criacao vira quase
// hora-invertida e as tarefas das 09:00 caem nas posicoes 45-47, fora do corte.
// =====================================================================================
const { ordenarPoolPorVencimento, recortarPool, extrairMarkers, POOL_LIMIT } = require('./group-chat-engine');

test('o pool ordena por QUEM VENCE PRIMEIRO, nao por quem foi criada por ultimo', () => {
  // Lote unico: created_at quase igual e em ordem inversa da agenda (foi o que aconteceu).
  const lote = [
    { id: 'c', title: '19:00 Arthur', due_date: '2026-09-04', created_at: '2026-09-04T11:00:00Z' },
    { id: 'a', title: '09:00 Felipe', due_date: '2026-09-04', created_at: '2026-09-04T11:00:02Z' },
    { id: 'b', title: 'atrasada de ontem', due_date: '2026-09-03', created_at: '2026-09-04T11:00:01Z' },
  ];
  const ord = ordenarPoolPorVencimento(lote).map((t) => t.id);
  assert.deepEqual(ord, ['b', 'c', 'a'], 'atrasada primeiro; dentro do mesmo dia, a mais antiga de criacao');
});

test('tarefa SEM prazo vai pro fim (nao empurra o que vence hoje pra fora do corte)', () => {
  const ord = ordenarPoolPorVencimento([
    { id: 'sem', title: 'x', due_date: null, created_at: '2026-09-04T09:00:00Z' },
    { id: 'com', title: 'y', due_date: '2026-09-30', created_at: '2026-09-01T09:00:00Z' },
  ]).map((t) => t.id);
  assert.deepEqual(ord, ['com', 'sem']);
});

test('o TETO cabe o maior grupo real (medido hoje: 46 abertas) e a pauta do dia (48/unidade)', () => {
  assert.ok(POOL_LIMIT >= 96, `teto ${POOL_LIMIT} volta a truncar o grupo real — medi 46 abertas + 48 filhas de pauta`);
});

test('TRUNCAMENTO E VISIVEL: quem recorta DIZ que recortou', () => {
  const muitas = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, due_date: '2026-09-04' }));
  const r = recortarPool(muitas, 120);
  assert.equal(r.pool.length, 120);
  assert.equal(r.total, 200);
  assert.equal(r.truncado, 80, 'o motor precisa saber QUANTAS ficaram de fora pra nunca dizer "nao existe"');
});

test('sem truncamento, truncado=0 (zero por saude tem que soar diferente de zero por corte)', () => {
  const r = recortarPool([{ id: 'x', title: 'X' }], 120);
  assert.equal(r.truncado, 0);
  assert.equal(r.total, 1);
});

// =====================================================================================
// DEFEITO 3 — VAZAMENTO DE MARCADOR CRU NO WHATSAPP (04/09, grupo Barra).
// Duas mensagens reais sairam com <<SITUACAO_ALUNO>>{...}<<END>> literal no grupo e no
// painel. Raiz dupla: (1) o `match` sem /g dentro de um `if` (nao de um laco) lia so o
// PRIMEIRO marcador, e o prompt exige "um aluno POR marcador" — pedir ficha de 3 alunos
// OBRIGA 3 marcadores; (2) nao existia sanitizador de saida por FORMA: as quatro camadas
// que limpam o texto limpam por marcador NOMEADO, ninguem pergunta "sobrou algum <<X>>?".
// =====================================================================================
test('extrairMarkers le TODOS os marcadores repetidos (o `if` lia so o primeiro)', () => {
  const r = extrairMarkers('a\n<<SITUACAO_ALUNO>>{"aluno":"A"}<<END>>\nb\n<<SITUACAO_ALUNO>>{"aluno":"B"}<<END>>', 'SITUACAO_ALUNO', 5);
  assert.equal(r.total, 2);
  assert.deepEqual(r.blocos, ['{"aluno":"A"}', '{"aluno":"B"}']);
  assert.equal(r.limpo, 'a\n\nb', 'a leitura e a limpeza saem do MESMO laco');
});

test('extrairMarkers respeita o teto E devolve o excedente (raspar em silencio esconde a falha)', () => {
  const txt = Array.from({ length: 8 }, (_, i) => `<<SITUACAO_ALUNO>>{"aluno":"A${i}"}<<END>>`).join('\n');
  const r = extrairMarkers(txt, 'SITUACAO_ALUNO', 5);
  assert.equal(r.blocos.length, 5);
  assert.equal(r.excedente, 3);
  assert.doesNotMatch(r.limpo, /<</, 'o excedente sai do texto tambem — nunca vaza');
});

test('SANITIZADOR POR FORMA: marcador residual desconhecido nao chega no WhatsApp', () => {
  const c = buildTomContent('Claro, Alf! 👇\n\n<<SITUACAO_ALUNO>>{"aluno":"Manuela"}<<END>>',
    [{ kind: 'situacao', status: 'ok', label: 'Ficha: Felipe' }]);
  assert.doesNotMatch(c, /<<SITUACAO_ALUNO>>|<<END>>/, 'marcador cru vazou pro grupo real em 04/09');
  assert.match(c, /Claro, Alf/, 'a fala do TOM sobrevive');
});

test('marcador da rota 1:1 que o motor de grupo nem conhece tambem e raspado', () => {
  const c = buildTomContent('Pronto!\n<<REMINDER_CREATE>>{"x":1}<<END>>', [{ kind: 'task', status: 'ok', label: 'T' }]);
  assert.doesNotMatch(c, /<</);
});

test('marcador TRUNCADO (sem END, resposta cortada no meio) tambem e raspado', () => {
  const c = buildTomContent('Aqui vai 👇\n<<SITUACAO_ALUNO>>{"aluno":"Man', [{ kind: 'situacao', status: 'ok', label: 'x' }]);
  assert.doesNotMatch(c, /<<SITUACAO_ALUNO>>/);
});

test('SENSOR: o raspador avisa quem chama (senao o vazamento vira zero silencioso)', () => {
  const vistos = [];
  buildTomContent('oi\n<<SITUACAO_ALUNO>>{"a":1}<<END>>\n<<GROUP_NOTE>>{"b":2}<<END>>',
    [{ kind: 'situacao', status: 'ok', label: 'x' }], { onResidual: (n) => vistos.push(...n) });
  assert.deepEqual(vistos.sort(), ['GROUP_NOTE', 'SITUACAO_ALUNO']);
});

test('ZERO-REGRESSAO: texto sem marcador nenhum nao aciona o sensor', () => {
  const vistos = [];
  buildTomContent('Bom dia, pessoal!', [], { onResidual: (n) => vistos.push(...n) });
  assert.equal(vistos.length, 0);
});

test('ZERO-REGRESSAO: o delimitador de ACTIONS nao e confundido com marcador', () => {
  const c = buildTomContent('Feito!', [{ kind: 'task', status: 'ok', label: 'T' }]);
  assert.ok(c.includes(ACTIONS_DELIM));
});

// =====================================================================================
// DEFEITO 4 — A GUARDA DE HONESTIDADE GRITA EM FALSO (04/09, 10:30:56 e 10:35:30).
// Duas respostas puramente INFORMATIVAS e CORRETAS levaram colada a nota
// "Na real nao consegui registrar isso agora". A guarda exige "nada foi persistido" +
// alegacao de conclusao — e nada foi persistido porque NAO HAVIA NADA A PERSISTIR.
// O que separa os dois casos: nas falas abaixo o participio descreve trabalho de OUTRA
// PESSOA ("criadas pela Krissya") ou uma INFERENCIA ("o que indica que ... provavelmente"),
// nunca uma escrita do proprio TOM. Ele so respondeu uma pergunta.
// =====================================================================================
test('CASO REAL 10:35:30 — "todas criadas pela Krissya" e relato, nao promessa quebrada', () => {
  const c = buildTomContent(
    'Sim, Alf! Ainda tem 27 anamneses abertas de hoje — todas criadas pela Krissya pra alunos com aula hoje, de 08h as 20h.',
    []);
  assert.doesNotMatch(c, /não consegui registrar/i, 'a informacao estava CERTA e a nota mandou o time desconfiar dela');
  assert.match(c, /27 anamneses abertas/, 'e a frase nao pode ser apagada junto');
});

test('CASO REAL 10:30:56 — inferencia hedgeada sobre o que outra pessoa fez', () => {
  const c = buildTomContent(
    'Eles nao aparecem mais nas pendentes — o que indica que todas as anamneses ja foram concluidas (provavelmente quando a Krissya passou por elas hoje de manha).',
    []);
  assert.doesNotMatch(c, /não consegui registrar/i);
  assert.match(c, /nao aparecem mais nas pendentes/, 'a frase informativa nao pode ser apagada junto');
});

test('A GUARDA NAO ENFRAQUECE: TOM afirmando a PROPRIA escrita segue pego', () => {
  assert.match(buildTomContent('Anotado aqui pra contexto.', []), /não consegui registrar/i);
  assert.match(buildTomContent('Criei as 3 tarefas pra Krissya.', []), /não consegui registrar/i);
  assert.match(buildTomContent('✅ Todas as 3 anamneses concluidas.', []), /não consegui registrar/i);
});

test('A GUARDA NAO ENFRAQUECE: passiva SEM agente de terceiro segue pega', () => {
  // "foram criadas" sem dizer POR QUEM continua sendo o TOM se atribuindo a escrita.
  assert.match(buildTomContent('Todas as tarefas foram criadas.', []), /não consegui registrar/i);
});

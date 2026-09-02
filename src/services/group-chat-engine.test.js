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

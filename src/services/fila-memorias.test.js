'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  ordenarFila, renderFila, parseComandoFila, renderResultado, decidirFila, executarComandoFila, enviarFilaDeMemorias,
} = require('./fila-memorias');

// As 6 de 10/09, do jeito que o Alf leu no chat.
const M = (id, grupo, memory_type, content, extra = {}) => ({ id, grupo, memory_type, content, occurred_on: '2026-09-09', ...extra });
const FILA = [
  M('c53e', 'Sucesso do Aluno', 'fact', 'Cada professor precisa de 2 vídeos de boas-vindas.'),
  M('16e1', 'ADM CG', 'lesson', 'Cobrança sai pelo número da ADM, nunca do celular pessoal.',
    { efeito: 'Quando pedirem pra redigir cobrança, o TOM lembra de mandar pelo número da ADM e pedir autorização.' }),
  M('e46c', 'Administração Recreio', 'lesson', 'Ao trocar turma, conferir a sala.'),
];

// ── ordem ────────────────────────────────────────────────────────────────────────────────
test('a fila é agrupada por grupo, em ordem alfabética, e é determinística', () => {
  const a = ordenarFila(FILA).map((x) => x.id);
  const b = ordenarFila([...FILA].reverse()).map((x) => x.id);
  assert.deepStrictEqual(a, ['16e1', 'e46c', 'c53e']);
  assert.deepStrictEqual(a, b);
});

// ── o texto que chega no grupo ─────────────────────────────────────────────────────────────
test('a lista numera, diz o grupo, o tipo, o que muda no TOM e como responder', () => {
  const numerada = ordenarFila(FILA).map((x, i) => ({ ...x, review_number: i + 1 }));
  const t = renderFila(numerada);
  assert.match(t, /\(3\)/);
  assert.match(t, /\*1\.\* _ADM CG_ · regra/);
  assert.match(t, /Muda no TOM:\* Quando pedirem pra redigir cobrança/);
  assert.match(t, /aprova 1 3/);
  assert.match(t, /pra todos os grupos/);
});

test('memória sem efeito (de antes de 10/09) diz isso, não fica em branco', () => {
  const t = renderFila([{ ...FILA[0], review_number: 1 }]);
  assert.match(t, /não informado — memória de antes de 10\/09/);
});

test('fila vazia diz que está vazia', () => {
  assert.match(renderFila([]), /Nenhuma memória esperando/);
});

// ── o comando ────────────────────────────────────────────────────────────────────────────
test('aprova 1 3', () => {
  assert.deepStrictEqual(parseComandoFila('aprova 1 3'),
    { tipo: 'decidir', ops: [{ acao: 'aprovar', numeros: [1, 3], todas: false }], paraTodosOsGrupos: false });
});

test('vírgula, "e", maiúscula e ponto final', () => {
  assert.deepStrictEqual(parseComandoFila('Aprova 1, 3 e 5.').ops[0].numeros, [1, 3, 5]);
});

test('aprova e descarta na mesma mensagem', () => {
  const c = parseComandoFila('aprova 1 3 descarta 2');
  assert.deepStrictEqual(c.ops.map((o) => [o.acao, o.numeros]), [['aprovar', [1, 3]], ['descartar', [2]]]);
});

test('aprova todas / aprovo tudo', () => {
  assert.strictEqual(parseComandoFila('aprova todas').ops[0].todas, true);
  assert.strictEqual(parseComandoFila('Aprovo tudo').ops[0].todas, true);
  assert.strictEqual(parseComandoFila('descarta todas').ops[0].acao, 'descartar');
});

test('"pra todos os grupos" é alcance, não "todas"', () => {
  const c = parseComandoFila('aprova 1 pra todos os grupos');
  assert.deepStrictEqual(c.ops[0], { acao: 'aprovar', numeros: [1], todas: false });
  assert.strictEqual(c.paraTodosOsGrupos, true);
});

test('ambíguo ou fora do formato segue pro agente (null)', () => {
  assert.strictEqual(parseComandoFila('aprova todas menos a 2'), null);
  assert.strictEqual(parseComandoFila('aprova a do Clayton'), null);
  assert.strictEqual(parseComandoFila('aprova 2 descarta 2'), null, 'o mesmo número nas duas ações');
  assert.strictEqual(parseComandoFila('bom dia, tudo certo?'), null);
  assert.strictEqual(parseComandoFila('roda a auditoria de ontem'), null);
  assert.strictEqual(parseComandoFila(''), null);
});

test('pedir a lista', () => {
  for (const t of ['memórias pendentes', 'Memorias', 'lista as memórias', 'fila de memórias', 'lições pendentes']) {
    assert.deepStrictEqual(parseComandoFila(t), { tipo: 'listar' }, t);
  }
});

// ── decidir com o número GRAVADO ──────────────────────────────────────────────────────────
function fakeSb(linhas) {
  const escritas = [];
  const logs = [];
  return {
    escritas, logs,
    from(tbl) {
      const st = { tbl, op: 'select', patch: null };
      const api = {
        select() { return api; },
        eq(col, val) {
          if (st.op === 'update' && col === 'id') {
            escritas.push({ id: val, ...st.patch });
            const l = linhas.find((x) => x.id === val);
            if (l) Object.assign(l, st.patch);
            return Promise.resolve({ error: null });
          }
          return api;
        },
        is() { return api; },
        limit() { return api; },
        update(patch) { st.op = 'update'; st.patch = patch; return api; },
        insert(row) { logs.push(row); return Promise.resolve({ error: null }); },
        then(res, rej) {
          const data = st.tbl === 'ritual_logs' ? [] : linhas.filter((l) => l.is_active === false && !l.approved_at)
            .map((l) => ({ ...l, group: { name: l.grupo } }));
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}
const pend = (id, grupo, n, extra = {}) => ({ id, grupo, memory_type: 'lesson', content: `conteudo ${id}`, occurred_on: '2026-09-09',
  is_active: false, approved_at: null, review_number: n, ...extra });

test('"aprova 1 3" aprova exatamente as memórias com esses NÚMEROS gravados', async () => {
  const linhas = [pend('a', 'G', 1), pend('b', 'G', 2), pend('c', 'H', 3)];
  const sb = fakeSb(linhas);
  const r = await decidirFila(sb, parseComandoFila('aprova 1 3'));
  const ids = sb.escritas.filter((e) => e.is_active === true).map((e) => e.id).sort();
  assert.deepStrictEqual(ids, ['a', 'c']);
  assert.deepStrictEqual(r.restam, [2]);
});

test('aprovar a 1 não renumera: a 3 continua sendo a mesma memória', async () => {
  const linhas = [pend('a', 'G', 1), pend('b', 'G', 2), pend('c', 'H', 3)];
  const sb = fakeSb(linhas);
  await decidirFila(sb, parseComandoFila('aprova 1'));
  await decidirFila(sb, parseComandoFila('aprova 3'));
  assert.strictEqual(linhas.find((l) => l.id === 'c').is_active, true);
  assert.strictEqual(linhas.find((l) => l.id === 'b').is_active, false);
});

test('memória que nasceu DEPOIS da lista (sem número) não é tocada nem por "aprova todas"', async () => {
  const linhas = [pend('a', 'G', 1), pend('nova', 'G', null)];
  const sb = fakeSb(linhas);
  const r = await decidirFila(sb, parseComandoFila('aprova todas'));
  assert.deepStrictEqual(sb.escritas.map((e) => e.id), ['a']);
  assert.strictEqual(r.semNumero, 1);
  assert.match(renderResultado(r), /chegou depois da lista/);
});

test('descartar carimba approved_at pra não voltar pra fila', async () => {
  const linhas = [pend('a', 'G', 1)];
  const sb = fakeSb(linhas);
  await decidirFila(sb, parseComandoFila('descarta 1'));
  assert.strictEqual(sb.escritas[0].is_active, false);
  assert.ok(sb.escritas[0].approved_at);
});

test('número fora da lista é dito, e nada é aprovado no lugar', async () => {
  const linhas = [pend('a', 'G', 1)];
  const sb = fakeSb(linhas);
  const r = await decidirFila(sb, parseComandoFila('aprova 9'));
  assert.strictEqual(sb.escritas.length, 0);
  const t = renderResultado(r);
  assert.match(t, /Não consegui aplicar nada/);
  assert.match(t, /Não está na lista: 9/);
});

test('o resultado repete o TEXTO do que foi decidido', async () => {
  const linhas = [pend('a', 'G', 1, { content: 'cobrança sai pelo número da ADM' })];
  const t = renderResultado(await decidirFila(fakeSb(linhas), parseComandoFila('aprova 1')));
  assert.match(t, /✅ \*Aprovada:\*/);
  assert.match(t, /cobrança sai pelo número da ADM/);
});

test('sem lista postada ainda, manda pedir a lista em vez de adivinhar', async () => {
  const linhas = [pend('a', 'G', null)];
  const t = renderResultado(await decidirFila(fakeSb(linhas), parseComandoFila('aprova 1')));
  assert.match(t, /memórias pendentes/);
});

test('"memórias pendentes" numera e grava o número antes de mostrar', async () => {
  const linhas = [pend('b', 'Zeta', null), pend('a', 'Alfa', null)];
  const sb = fakeSb(linhas);
  const t = await executarComandoFila(sb, { tipo: 'listar' });
  assert.deepStrictEqual(sb.escritas.map((e) => [e.id, e.review_number]), [['a', 1], ['b', 2]]);
  assert.match(t, /\*1\.\* _Alfa_/);
});

// ── envio das 07:30 ──────────────────────────────────────────────────────────────────────
test('fila vazia não posta nada', async () => {
  const postados = [];
  const r = await enviarFilaDeMemorias(fakeSb([]), { ymd: '2026-09-11', ownerId: 'alf', postar: async (t) => { postados.push(t); return true; } });
  assert.strictEqual(r.enviado, false);
  assert.strictEqual(postados.length, 0);
});

test('com fila: numera, posta e só grava o log com a entrega confirmada', async () => {
  const linhas = [pend('a', 'G', null)];
  const sb = fakeSb(linhas);
  const postados = [];
  const r = await enviarFilaDeMemorias(sb, { ymd: '2026-09-11', ownerId: 'alf', postar: async (t) => { postados.push(t); return true; } });
  assert.strictEqual(r.enviado, true);
  assert.match(postados[0], /\*1\.\*/);
  assert.strictEqual(sb.logs[0].ritual_type, 'fila_memorias');
});

test('entrega que falhou não grava log (o próximo tick tenta de novo)', async () => {
  const sb = fakeSb([pend('a', 'G', null)]);
  await assert.rejects(() => enviarFilaDeMemorias(sb, { ymd: '2026-09-11', ownerId: 'alf', postar: async () => null }));
  assert.strictEqual(sb.logs.length, 0);
});

'use strict';
// Triagem da fila de memórias (24/09): o que repete o histórico sai antes do Alf ver. Ver o topo
// de triagem-memorias.js. Nenhum teste toca banco nem modelo: tudo por fake.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const T = require('./triagem-memorias');

const v = (...xs) => xs; // vetor pequeno basta pro cosseno
const mem = (o) => ({ group_id: 'g1', scope: 'group', is_active: false, approved_at: null, created_at: '2026-09-20T00:00:00Z', efeito: null, ...o });

// ── similaridade / vizinhos ───────────────────────────────────────────────────────────────
test('similaridade: iguais = 1, ortogonais = 0, aceita o texto "[...]" do pgvector, lixo = 0', () => {
  assert.ok(Math.abs(T.similaridade(v(1, 0), v(1, 0)) - 1) < 1e-9);
  assert.strictEqual(T.similaridade(v(1, 0), v(0, 1)), 0);
  assert.ok(Math.abs(T.similaridade('[1,0]', [1, 0]) - 1) < 1e-9);
  assert.strictEqual(T.similaridade(null, [1]), 0);
  assert.strictEqual(T.similaridade([1, 2], [1]), 0);
});

test('vizinhos: só mesmo grupo ou escopo tom, acima do mínimo, ordenados, sem a própria', () => {
  const cand = mem({ id: 'c', embedding: v(1, 0), created_at: '2026-09-24' });
  const acervo = [
    cand,
    mem({ id: 'a', embedding: v(1, 0.1), is_active: true }),
    mem({ id: 'outro-grupo', group_id: 'g2', embedding: v(1, 0), is_active: true }),
    mem({ id: 'global', group_id: 'g2', scope: 'tom', embedding: v(1, 0.3), is_active: true }),
    mem({ id: 'longe', embedding: v(0, 1), is_active: true }),
  ];
  assert.deepStrictEqual(T.vizinhosPorSentido(cand, acervo).map((x) => x.id), ['a', 'global']);
});

test('vizinhos: entre duas PENDENTES só a mais antiga serve de fonte (a velha fica)', () => {
  const nova = mem({ id: 'nova', embedding: v(1, 0), created_at: '2026-09-24' });
  const velha = mem({ id: 'velha', embedding: v(1, 0), created_at: '2026-09-23' });
  assert.deepStrictEqual(T.vizinhosPorSentido(nova, [nova, velha]).map((x) => x.id), ['velha']);
  assert.deepStrictEqual(T.vizinhosPorSentido(velha, [nova, velha]).map((x) => x.id), []);
});

test('vizinhos: recusada entra como fonte e leva o estado', () => {
  const cand = mem({ id: 'c', embedding: v(1, 0), created_at: '2026-09-24' });
  const rec = mem({ id: 'r', embedding: v(1, 0), approved_at: '2026-09-21T00:00:00Z' });
  assert.strictEqual(T.vizinhosPorSentido(cand, [rec])[0].estado, 'recusada');
});

// ── aceitarVeredito: o código só aceita com prova ─────────────────────────────────────────
const VIZ = [{ id: 'f1', content: 'O scaffold de reply-quote pode colar fala anterior do TOM dentro da mensagem.' }];
test('veredito: "igual" + trecho copiado da fonte apontada -> aceita', () => {
  assert.strictEqual(T.aceitarVeredito({ fonte: 'F1', grau: 'igual', trecho: 'reply-quote pode colar fala anterior' }, VIZ).id, 'f1');
});
test('veredito: trecho que NÃO está na fonte -> recusa (o modelo não descarta por achismo)', () => {
  assert.strictEqual(T.aceitarVeredito({ fonte: 'F1', grau: 'igual', trecho: 'algo que ninguém escreveu nunca' }, VIZ), null);
});
test('veredito: trecho curto demais, grau não-igual, fonte inexistente ou nula -> recusa', () => {
  assert.strictEqual(T.aceitarVeredito({ fonte: 'F1', grau: 'igual', trecho: 'scaffold' }, VIZ), null);
  assert.strictEqual(T.aceitarVeredito({ fonte: 'F1', grau: 'complementa', trecho: 'reply-quote pode colar fala anterior' }, VIZ), null);
  assert.strictEqual(T.aceitarVeredito({ fonte: 'F2', grau: 'igual', trecho: 'reply-quote pode colar fala anterior' }, VIZ), null);
  assert.strictEqual(T.aceitarVeredito({ fonte: null, grau: 'igual', trecho: 'reply-quote pode colar fala anterior' }, VIZ), null);
  assert.strictEqual(T.aceitarVeredito(null, VIZ), null);
});
test('veredito: acento e pontuação não impedem achar o trecho', () => {
  assert.ok(T.aceitarVeredito({ fonte: 'f1', grau: 'igual', trecho: 'reply quote pode colar fala anterior do tom' }, VIZ));
});

// ── triarFila (fake sb + fake modelo) ─────────────────────────────────────────────────────
function fakeSb(acervo, { erroLeitura = false } = {}) {
  const updates = []; const markers = [];
  const q = (tabela) => {
    const f = { _eq: {} };
    f.select = () => f; f.gte = () => f;
    f.eq = (c, val) => { f._eq[c] = val; return f; };
    f.limit = async () => (erroLeitura ? { data: null, error: { message: 'caiu' } }
      : { data: acervo.filter((m) => m.is_active === f._eq.is_active), error: null });
    f.update = (patch) => ({ eq: async (_c, id) => { updates.push({ id, ...patch }); return { error: null }; } });
    f.insert = async (o) => { if (tabela === 'marker_logs') markers.push(o); return { error: null }; };
    return f;
  };
  return { sb: { from: q }, updates, markers };
}
const ACERVO = [
  mem({ id: 'ativa-1', embedding: v(1, 0), is_active: true, content: 'Guard de honestidade que rebaixa afirmação sem marker pode estar correto quando nada foi criado.' }),
  mem({ id: 'nova-dup', embedding: v(1, 0.05), created_at: '2026-09-24', content: 'Guard de honestidade rebaixando afirmação sem marker é correto.' }),
  mem({ id: 'nova-dif', embedding: v(0, 1), created_at: '2026-09-24', content: 'Chave CNPJ segue para passaporte.' }),
];
const modeloIgual = async () => ({ text: '{"fonte":"F1","grau":"igual","trecho":"rebaixa afirmação sem marker pode estar correto"}' });

test('triarFila: repetida sai (patch do "descarta" + marcador com a fonte); a diferente fica', async () => {
  const { sb, updates, markers } = fakeSb(ACERVO);
  const r = await T.triarFila(sb, [ACERVO[1], ACERVO[2]], { chat: modeloIgual, agora: Date.parse('2026-09-24T12:00:00Z') });
  assert.deepStrictEqual(r.tiradas.map((t) => t.id), ['nova-dup']);
  assert.deepStrictEqual(r.ficam.map((p) => p.id), ['nova-dif']);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].is_active, false);
  assert.ok(updates[0].approved_at);
  assert.match(markers[0].reason, /repetida:nova-dup igual a ativa-1 \(ativa\)/);
});

test('triarFila: sem vizinho parecido o modelo nem é chamado', async () => {
  const { sb } = fakeSb(ACERVO);
  let chamadas = 0;
  await T.triarFila(sb, [ACERVO[2]], { chat: async () => { chamadas++; return { text: '{}' }; } });
  assert.strictEqual(chamadas, 0);
});

test('triarFila: modelo diz "complementa" -> fica', async () => {
  const { sb, updates } = fakeSb(ACERVO);
  const r = await T.triarFila(sb, [ACERVO[1]], { chat: async () => ({ text: '{"fonte":"F1","grau":"complementa","trecho":"rebaixa afirmação sem marker pode estar correto"}' }) });
  assert.strictEqual(r.ficam.length, 1);
  assert.strictEqual(updates.length, 0);
});

test('triarFila: modelo fora ou resposta torta -> FICA na fila e conta como cega (falha-aberta)', async () => {
  for (const chat of [async () => { throw new Error('cota'); }, async () => ({ text: 'desculpe' })]) {
    const { sb, updates } = fakeSb(ACERVO);
    const r = await T.triarFila(sb, [ACERVO[1]], { chat });
    assert.strictEqual(r.ficam.length, 1);
    assert.strictEqual(r.cegas, 1);
    assert.strictEqual(updates.length, 0);
  }
});

test('triarFila: acervo não carrega -> fila intacta, nada escrito', async () => {
  const { sb, updates } = fakeSb(ACERVO, { erroLeitura: true });
  const r = await T.triarFila(sb, [ACERVO[1]], { chat: modeloIgual });
  assert.strictEqual(r.ficam.length, 1);
  assert.strictEqual(updates.length, 0);
});

test('triarFila: aplicar:false decide mas não escreve (modo controle)', async () => {
  const { sb, updates, markers } = fakeSb(ACERVO);
  const r = await T.triarFila(sb, [ACERVO[1]], { chat: modeloIgual, aplicar: false });
  assert.strictEqual(r.tiradas.length, 1);
  assert.strictEqual(updates.length + markers.length, 0);
});

test('triarFila: teto por rodada', async () => {
  const muitas = Array.from({ length: 4 }, (_, i) => mem({ id: `n${i}`, embedding: v(1, 0.01 * i), created_at: `2026-09-24T0${i}:00:00Z`, content: ACERVO[0].content }));
  const { sb } = fakeSb([ACERVO[0], ...muitas]);
  const r = await T.triarFila(sb, muitas, { chat: modeloIgual, teto: 2 });
  assert.strictEqual(r.tiradas.length, 2);
});

// ── texto da lista ────────────────────────────────────────────────────────────────────────
test('linhaDaTriagem: diz quantas saíram, quantas eram iguais a recusada, e as não conferidas', () => {
  assert.strictEqual(T.linhaDaTriagem({}), '');
  assert.match(T.linhaDaTriagem({ tiradas: [{ fonteEstado: 'ativa' }, { fonteEstado: 'recusada' }] }), /🧹 Tirei 2 repetidas — diziam o mesmo que outra memória \(1 igual a uma que você já recusou\)\./);
  assert.match(T.linhaDaTriagem({ tiradas: [{ fonteEstado: 'ativa' }] }), /Tirei 1 repetida — dizia/);
  assert.match(T.linhaDaTriagem({ cegas: 2 }), /Não consegui conferir 2/);
});

test('o critério do modelo é "muda o que o TOM faz", não "tem palavra nova"', () => {
  assert.match(T.PROMPT, /mudaria o que o TOM FAZ ou SABE/);
  assert.match(T.PROMPT, /Exemplo a mais, caso citado, justificativa/);
});

// ── ligação na lista das 07:30 ────────────────────────────────────────────────────────────
const fila = fs.readFileSync(path.join(__dirname, 'fila-memorias.js'), 'utf8');
test('enviarFilaDeMemorias tria ANTES de numerar e põe a linha 🧹 no topo', () => {
  const iTri = fila.indexOf('await triarFila(sb, itens');
  const iNum = fila.indexOf('const numerados = await numerarFila(sb, ');
  assert.ok(iTri > 0 && iNum > iTri, 'triagem antes da numeração');
  assert.match(fila, /linhaDaTriagem\(tri\)/);
  assert.ok(fila.includes('const r = await postar(aviso ? `${aviso}'), 'a linha 🧹 vai junto da lista postada');
});

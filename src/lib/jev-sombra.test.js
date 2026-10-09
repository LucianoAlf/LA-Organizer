'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const J = require('./jev-sombra');

const okFetch = (respostas) => {
  let i = 0; const chamadas = [];
  const f = async (url, init) => { chamadas.push(init); const r = respostas[i++]; return { ok: true, status: 200, json: async () => r }; };
  f.chamadas = chamadas; return f;
};
const sbFake = (hist) => ({
  from: () => {
    const q = { select: () => q, eq: () => q, or: () => q, ilike: () => q, order: () => q, limit: async () => ({ data: hist }) };
    return q;
  },
});

test('fala curta: só continuação → curta; palavra de conteúdo ou número → pedido completo', () => {
  for (const s of ['Fecha', 'Concluída', 'Ainda hj', 'fechou', 'sim', 'tudo feito', 'ok tom']) assert.strictEqual(J.falaCurta(s), true, s);
  for (const s of ['fecha o projeto X', 'conclui a tarefa do Pedro', 'Reagendar pra segunda', 'me lembra 10h', '156,00']) assert.strictEqual(J.falaCurta(s), false, s);
});

test('registro nunca leva telefone/e-mail/CPF', () => {
  const l = J.montarRegistro({ collabId: 'c1', fala: 'liga pro 21 99876-5432 ou a@b.com cpf 123.456.789-09', metrics: { skill_active: 'none' }, jev: { gaveta: 'recados' } });
  assert.doesNotMatch(l.fala, /9987|a@b\.com|123\.456/);
  assert.strictEqual(l.collaborator_id, 'c1');
  assert.strictEqual(l.skill_pick, 'none');
});

test('X-Title: Tom e modelo jev em toda chamada; 2 passos quando a gaveta tem várias caixas', async () => {
  const f = okFetch([{ answers: { gaveta: { choice: 'tarefas', confidence: 0.99 } } }, { answers: { caixa: { choice: 'tarefa_criar', confidence: 0.95 } } }]);
  const r = await J.perguntarJev('me lembra amanhã 9h de ligar pro fornecedor', '', null, { chave: 'k', fetchImpl: f });
  assert.strictEqual(r.gaveta, 'tarefas'); assert.strictEqual(r.caixa, 'tarefa_criar');
  assert.strictEqual(f.chamadas.length, 2);
  for (const c of f.chamadas) { assert.strictEqual(c.headers['X-Title'], 'Tom'); assert.match(c.body, /typesafe\/jev-1\.13/); }
});

test('fala curta nunca sai com sugestão de escrita (fica com a confirmação do TOM)', async () => {
  const f = okFetch([{ answers: { gaveta: { choice: 'tarefas', confidence: 0.99 } } }, { answers: { caixa: { choice: 'tarefa_concluir', confidence: 0.99 } } }]);
  const r = await J.perguntarJev('Fecha', 'Rose quentinhas tá parada', { tipo: 'tarefa', titulo: 'Rose quentinhas' }, { chave: 'k', fetchImpl: f });
  assert.strictEqual(r.caixa, 'confirmacao_do_tom');
  assert.strictEqual(r.caixa_jev, 'tarefa_concluir');
});

test('tipo do item citado vai para o Jev', () => {
  assert.match(J.estado('Fecha', 'Como foi *Casamento X*?', { tipo: 'compromisso', titulo: 'Casamento X' }), /COMPROMISSO: "Casamento X"/);
});

test('falha/timeout do Jev nunca lança', async () => {
  const quebra = async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); };
  const r = await J.perguntarJev('oi', '', null, { chave: 'k', fetchImpl: quebra });
  assert.ok(r.erro);
  const http = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.ok((await J.perguntarJev('oi', '', null, { chave: 'k', fetchImpl: http })).erro);
  assert.strictEqual((await J.perguntarJev('oi', '', null, { chave: '' })).erro, 'sem_chave');
});

test('interruptor: TOM_JEV_SOMBRA≠1 → não lê banco, não chama o Jev, não grava', async () => {
  let perguntou = false;
  const arq = path.join(os.tmpdir(), `jev-sombra-off-${process.pid}.jsonl`);
  const r = await J.registrarSombra('c1', {}, { sb: sbFake([{ direction: 'inbound', content: 'oi' }]), arquivo: arq, env: { TOM_JEV_SOMBRA: '0' }, perguntar: async () => { perguntou = true; } });
  assert.strictEqual(r, null); assert.strictEqual(perguntou, false); assert.strictEqual(fs.existsSync(arq), false);
});

test('ligado: grava 1 linha com a fala (sem telefone), a última do TOM como contexto e o que o TOM emitiu', async () => {
  const arq = path.join(os.tmpdir(), `jev-sombra-on-${process.pid}.jsonl`);
  try { fs.unlinkSync(arq); } catch (_) { /* nada */ }
  let viu = null;
  const hist = [{ direction: 'outbound', content: 'resposta deste turno' }, { direction: 'inbound', content: 'me lembra de ligar pro 21 99876-5432 amanhã' }, { direction: 'outbound', content: 'Bom dia!' }];
  const r = await J.registrarSombra('c1', { skill_active: 'none', marker_emitted: 'TASK_UPDATE' }, {
    sb: sbFake(hist), arquivo: arq, env: { TOM_JEV_SOMBRA: '1', OPENROUTER_API_KEY: 'k' },
    perguntar: async (fala, ult) => { viu = { fala, ult }; return { gaveta: 'tarefas', caixa: 'tarefa_criar' }; },
  });
  assert.strictEqual(viu.ult, 'Bom dia!');
  const linhas = fs.readFileSync(arq, 'utf8').trim().split('\n');
  assert.strictEqual(linhas.length, 1);
  const l = JSON.parse(linhas[0]);
  assert.strictEqual(l.gaveta, 'tarefas'); assert.strictEqual(l.tom_marcador, 'TASK_UPDATE');
  assert.doesNotMatch(l.fala, /9987/);
  assert.strictEqual(r.collaborator_id, 'c1');
  fs.unlinkSync(arq);
});

test('erro de banco dentro da sombra → null, sem lançar', async () => {
  const sb = { from: () => { throw new Error('db fora'); } };
  assert.strictEqual(await J.registrarSombra('c1', {}, { sb, env: { TOM_JEV_SOMBRA: '1' } }), null);
});

test('fiação: o engine dispara a sombra SEM await, depois do recordMessage do fim do turno', () => {
  const E = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  const i = E.lastIndexOf('metricsService.recordMessage(_metrics).catch(() => {});');
  const trecho = E.slice(i, i + 900);
  assert.match(trecho, /setImmediate\(\(\) => \{[\s\S]*registrarSombra\(/);
  assert.doesNotMatch(trecho, /await\s+[\w.]*registrarSombra/);
  assert.match(trecho, /TOM_JEV_SOMBRA === '1'/);
});

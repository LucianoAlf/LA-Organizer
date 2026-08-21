'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyDupChoice, pickFreshDupBypassIntent, pickDupBypassIntentForReply } = require('./dup-choice');

// dígitos (comportamento legado preservado)
test('dígito puro 1/2/3', () => {
  assert.strictEqual(classifyDupChoice('1'), '1');
  assert.strictEqual(classifyDupChoice('2'), '2');
  assert.strictEqual(classifyDupChoice('3'), '3');
});

test('dígito com pontuação/contexto', () => {
  assert.strictEqual(classifyDupChoice('2.'), '2');
  assert.strictEqual(classifyDupChoice('2 - cria mesmo'), '2');
  assert.strictEqual(classifyDupChoice('1, é a mesma'), '1');
});

// linguagem natural — opção 2 (outro caso / são diferentes)
test('NL opção 2: caso Juliana "São duas tarefas diferentes"', () => {
  assert.strictEqual(classifyDupChoice('São duas tarefas diferentes'), '2');
});

test('NL opção 2: variações', () => {
  assert.strictEqual(classifyDupChoice('são diferentes'), '2');
  assert.strictEqual(classifyDupChoice('é outra coisa'), '2');
  assert.strictEqual(classifyDupChoice('outro caso'), '2');
  assert.strictEqual(classifyDupChoice('cria separado'), '2');
  assert.strictEqual(classifyDupChoice('pode criar a nova'), '2');
  assert.strictEqual(classifyDupChoice('não é a mesma'), '2');
});

// linguagem natural — opção 1 (mesma situação)
test('NL opção 1: mesma situação', () => {
  assert.strictEqual(classifyDupChoice('é a mesma coisa'), '1');
  assert.strictEqual(classifyDupChoice('já tá coberta'), '1');
  assert.strictEqual(classifyDupChoice('é igual, deixa assim'), '1');
});

// linguagem natural — opção 3 (cancelar)
test('NL opção 3: cancelar', () => {
  assert.strictEqual(classifyDupChoice('cancela'), '3');
  assert.strictEqual(classifyDupChoice('deixa pra lá, vou reformular'), '3');
});

// NÃO casar (sem falso-positivo)
test('null: mensagens que não são resposta de dup', () => {
  assert.strictEqual(classifyDupChoice('comprar leite amanhã'), null);
  assert.strictEqual(classifyDupChoice('Dai do pedagógico'), null);
  assert.strictEqual(classifyDupChoice('qual o status do projeto X?'), null);
  assert.strictEqual(classifyDupChoice(''), null);
  assert.strictEqual(classifyDupChoice(null), null);
});

test('null: frase longa não é tratada como escolha NL', () => {
  // mensagem comprida (descrição de nova tarefa) não deve casar mesmo contendo "nova"
  const longo = 'cria uma tarefa nova pra mim de comprar material de limpeza e organizar o estoque da sala';
  assert.strictEqual(classifyDupChoice(longo), null);
});

// ── pickFreshDupBypassIntent (DUP-BYPASS-STALE-BIND, Arthur 23/06) ──
const dupIntent = (over = {}) => ({
  id: 'i1', kind: 'task_creation', asked_at: new Date().toISOString(),
  payload: { _dup_bypass: true, drafts: [{ title: 'X' }] }, ...over,
});

test('pickFreshDupBypassIntent: dup recente → retorna a intent', () => {
  const i = dupIntent();
  assert.strictEqual(pickFreshDupBypassIntent([i]), i);
});

test('pickFreshDupBypassIntent: dup stale (5h) → null (caso Arthur)', () => {
  const stale = dupIntent({ asked_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString() });
  assert.strictEqual(pickFreshDupBypassIntent([stale]), null);
});

test('pickFreshDupBypassIntent: ignora sem _dup_bypass / sem drafts / outro kind / sem asked_at', () => {
  assert.strictEqual(pickFreshDupBypassIntent([{ kind: 'task_creation', asked_at: new Date().toISOString(), payload: {} }]), null);
  assert.strictEqual(pickFreshDupBypassIntent([dupIntent({ payload: { _dup_bypass: true, drafts: [] } })]), null);
  assert.strictEqual(pickFreshDupBypassIntent([dupIntent({ kind: 'confirmation' })]), null);
  assert.strictEqual(pickFreshDupBypassIntent([dupIntent({ asked_at: null })]), null);
});

test('pickFreshDupBypassIntent: pega a fresca ignorando a stale', () => {
  const stale = dupIntent({ id: 'old', asked_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() });
  const fresh = dupIntent({ id: 'new', asked_at: new Date().toISOString() });
  assert.strictEqual(pickFreshDupBypassIntent([stale, fresh]).id, 'new');
});

test('pickFreshDupBypassIntent: lista vazia / não-array → null', () => {
  assert.strictEqual(pickFreshDupBypassIntent([]), null);
  assert.strictEqual(pickFreshDupBypassIntent(null), null);
});

// ── pickDupBypassIntentForReply (DUP-QUOTE-SCAFFOLD, Juliana 23/06) ──
// Resposta ao menu via reply-quote = binding inequívoco: casa por título e ignora a idade.
// Sem quote, mantém a recência ≤10min (DUP-BYPASS-STALE-BIND, Arthur).
const menuQuote = (title) =>
  `Achei uma tarefa parecida já criada:\n_"Conversar com a Lohana"_\n\nA nova seria:\n_"${title}"_\n\nResponde com o **número**:\n\n1️⃣ *Mesma situação* — já tá coberta.`;

test('pickDupBypassIntentForReply: quote do menu casa título → recupera mesmo stale 35min (Juliana)', () => {
  const stale = dupIntent({
    asked_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    payload: { _dup_bypass: true, drafts: [{ title: 'Conversar com Caio e Kaio sobre atrasos' }] },
  });
  const got = pickDupBypassIntentForReply([stale], { quotedText: menuQuote('Conversar com Caio e Kaio sobre atrasos') });
  assert.strictEqual(got, stale);
});

test('pickDupBypassIntentForReply: SEM quote + stale 5h → null (Arthur preservado)', () => {
  const stale = dupIntent({ asked_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString() });
  assert.strictEqual(pickDupBypassIntentForReply([stale], { quotedText: null }), null);
});

test('pickDupBypassIntentForReply: SEM quote + fresca → recupera (recência ≤10min)', () => {
  const fresh = dupIntent();
  assert.strictEqual(pickDupBypassIntentForReply([fresh], { quotedText: null }), fresh);
});

test('pickDupBypassIntentForReply: quote do menu mas título NÃO casa → cai na recência (stale→null)', () => {
  const stale = dupIntent({
    asked_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    payload: { _dup_bypass: true, drafts: [{ title: 'Outra tarefa qualquer' }] },
  });
  assert.strictEqual(pickDupBypassIntentForReply([stale], { quotedText: menuQuote('Conversar com Caio e Kaio') }), null);
});

test('pickDupBypassIntentForReply: quote que NÃO é menu de dup → cai na recência', () => {
  const stale = dupIntent({ asked_at: new Date(Date.now() - 35 * 60 * 1000).toISOString() });
  assert.strictEqual(pickDupBypassIntentForReply([stale], { quotedText: 'oi tom, tudo certo por ai?' }), null);
});

test('pickDupBypassIntentForReply: quote do menu + fresca também recupera', () => {
  const fresh = dupIntent({ payload: { _dup_bypass: true, drafts: [{ title: 'Tarefa Z' }] } });
  assert.strictEqual(pickDupBypassIntentForReply([fresh], { quotedText: menuQuote('Tarefa Z') }), fresh);
});

// ── registerBatchDupConflict (DUP-BATCH-MENU-MISBIND, Ana 07/07 07:04→07:05 BRT) ──
// Lote de 4 tarefas, 3 caíram no detector de dup. O menu exibido citou a PRIMEIRA
// ("Liberar a folha para conferência da Direção"); a Ana respondeu "2" e o TOM criou
// a ÚLTIMA ("Avisar William sobre treinamentos"). Em pending_intents as 3 intents
// abrem no mesmo instante (07:04:49) e a resolution=confirmed cai na do William.
const { registerBatchDupConflict } = require('./dup-choice');

const loteAna = [
  { menu: { type: 'dup_task', candidateTitle: 'Liberar a folha para conferência da Direção' },
    target: { title: 'Liberar a folha para conferência da Direção' } },
  { menu: { type: 'dup_task', candidateTitle: 'Iniciar acesso ao novo sistema RH' },
    target: { title: 'Iniciar acesso ao novo sistema RH' } },
  { menu: { type: 'dup_task', candidateTitle: 'Avisar William sobre treinamentos' },
    target: { title: 'Avisar William sobre treinamentos' } },
];

test('registerBatchDupConflict: lote da Ana — menu e alvo do "1/2/3" saem do MESMO conflito', () => {
  let st = { menu: null, target: null };
  for (const c of loteAna) st = registerBatchDupConflict(st, c);
  assert.strictEqual(st.menu.candidateTitle, 'Liberar a folha para conferência da Direção');
  assert.strictEqual(st.target.title, st.menu.candidateTitle,
    'o "2" tem que criar a tarefa que o menu mostrou, não a última do lote');
  assert.notStrictEqual(st.target.title, 'Avisar William sobre treinamentos');
});

test('registerBatchDupConflict: conflito único segue amarrando normalmente', () => {
  const st = registerBatchDupConflict({ menu: null, target: null }, loteAna[0]);
  assert.strictEqual(st.menu.candidateTitle, 'Liberar a folha para conferência da Direção');
  assert.strictEqual(st.target.title, 'Liberar a folha para conferência da Direção');
});

// ── pickEventDupMenu (EVENT-DUP-MENU-CLOBBER, Jéssica 25/07) ──────────────────
const { pickEventDupMenu } = require('./dup-choice');

const _menu = (title, ageMs, now) => ({ event: { title }, timestamp: now - ageMs });

test('CASO JÉSSICA: quote da Festa da Mari casa mesmo com Viagem por cima (não clobra)', () => {
  const now = 1_000_000_000;
  const menus = [ _menu('Festa da Mari', 3*60*1000, now), _menu('Viagem para SP', 30*1000, now) ];
  const got = pickEventDupMenu(menus, { quotedText: 'Achei um parecido: "Festa da Mari". Responde 1/2/3', nowMs: now });
  assert.strictEqual(got.menu.event.title, 'Festa da Mari');
  assert.strictEqual(got.byQuote, true);
});

test('sem quote: pega o MAIS RECENTE vivo (comportamento antigo preservado)', () => {
  const now = 1_000_000_000;
  const menus = [ _menu('Festa da Mari', 3*60*1000, now), _menu('Viagem para SP', 30*1000, now) ];
  const got = pickEventDupMenu(menus, { quotedText: '', nowMs: now });
  assert.strictEqual(got.menu.event.title, 'Viagem para SP');
  assert.strictEqual(got.byQuote, false);
});

test('quote que não cita título vivo → cai no mais recente', () => {
  const now = 1_000_000_000;
  const menus = [ _menu('Festa da Mari', 60*1000, now) ];
  const got = pickEventDupMenu(menus, { quotedText: 'qualquer coisa sem título', nowMs: now });
  assert.strictEqual(got.menu.event.title, 'Festa da Mari');
  assert.strictEqual(got.byQuote, false);
});

test('menu expirado (>10min) não é selecionável', () => {
  const now = 1_000_000_000;
  assert.strictEqual(pickEventDupMenu([ _menu('Velha', 11*60*1000, now) ], { nowMs: now }), null);
  // ...mas o quote não ressuscita menu que já saiu da janela (memória-only, sem DB fallback)
  assert.strictEqual(pickEventDupMenu([ _menu('Velha', 11*60*1000, now) ], { quotedText: 'Velha', nowMs: now }), null);
});

test('lista vazia / degenerada → null', () => {
  for (const v of [null, undefined, [], 42]) assert.strictEqual(pickEventDupMenu(v, {}), null);
});

test('quote casa o mais ANTIGO quando é ele o citado (varre do recente, mas título manda)', () => {
  const now = 1_000_000_000;
  const menus = [ _menu('Reunião A', 5*60*1000, now), _menu('Reunião B', 20*1000, now) ];
  const got = pickEventDupMenu(menus, { quotedText: 'menu citado: Reunião A', nowMs: now });
  assert.strictEqual(got.menu.event.title, 'Reunião A');
});

// Catraca de FONTE: o helper de evento só resolve o clobber se o engine (a) empilhar em vez
// de sobrescrever e (b) escolher pelo quote na resolução.
const fs = require('node:fs');
const path = require('node:path');
const EVENG = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: dup de evento empilha (não clobra) e resolve por pickEventDupMenu/quote', () => {
  assert.ok(EVENG.includes('_pushEventDupMenu(collaborator.id, e)'), 'set virou append?');
  assert.ok(!/pendingDupEvents\.set\(collaborator\.id, \{ event/.test(EVENG), 'ainda há set clobber direto');
  assert.match(EVENG, /pickEventDupMenu\(pendingDupEvents\.get\(collab\.id\)[^)]*\{ quotedText/, 'resolução não usa o quote');
  assert.ok(!/pendingDupEvents\.delete\(collab\.id\)/.test(EVENG), 'ainda apaga a lista inteira em vez do escolhido');
});

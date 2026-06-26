// src/services/group-chat-prompt.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { buildGroupChatPrompt, fmtPoolLine } = require('./group-chat-prompt');

const base = {
  soulText: 'Eu sou o TOM.',
  groupName: 'Financeiro',
  members: [{ name: 'Ana Paula' }, { name: 'Rose' }],
  pool: [
    { title: 'Fechar caixa', status: 'pending', due_date: '2026-06-13' },
    { title: 'Conferir NF', status: 'done', due_date: null },
  ],
  history: [
    { who: 'Ana Paula', role: 'member', content: 'gente, fechamos o caixa?' },
    { who: 'Rose', role: 'member', content: 'ainda não' },
  ],
  senderName: 'Rose',
};

test('inclui identidade, nome do grupo e membros', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Eu sou o TOM\./);
  assert.match(p, /Financeiro/);
  assert.match(p, /Ana Paula/);
  assert.match(p, /Rose/);
});

test('inclui o pool e o marker TASK_UPDATE', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Fechar caixa/);
  assert.match(p, /<<TASK_UPDATE>>/);
});

test('inclui o histórico do chat com quem falou', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Ana Paula.*fechamos o caixa/s);
});

test('marca quem é o remetente atual', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Rose/);
});

test('robusto a dados vazios', () => {
  const p = buildGroupChatPrompt({ soulText: 'X', groupName: 'G', members: [], pool: [], history: [], senderName: 'Y' });
  assert.equal(typeof p, 'string');
  assert.ok(p.length > 0);
});

test('inclui marker PROJECT_CREATE', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /<<PROJECT_CREATE>>/);
});

test('inclui marker EVENT_CREATE', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /<<EVENT_CREATE>>/);
});

test('inclui tag de silencio <<SILENCIO>>', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /<<SILENCIO>>/);
});

test('inclui bloco de memória de longo prazo quando passado', () => {
  const p = buildGroupChatPrompt({ ...base, longTermMemory: 'Resumo da semana passada.' });
  assert.match(p, /Resumo da semana passada\./);
  assert.match(p, /Memória de longo prazo/);
});

test('mostra placeholder de memória quando longTermMemory é null', () => {
  const p = buildGroupChatPrompt({ ...base, longTermMemory: null });
  assert.match(p, /ainda construindo/);
});

test('exibe papel de facilitador', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /FACILITADOR/);
});

test('injeta a âncora de data quando passada (BUG weekday)', () => {
  const p = buildGroupChatPrompt({ ...base, dateAnchor: '**Data/hora agora (BRT):** 2026-06-12 18:00 (sexta)\nsegunda 15/06' });
  assert.match(p, /âncora temporal/);
  assert.match(p, /2026-06-12 18:00 \(sexta\)/);
  assert.match(p, /segunda 15\/06/);
});

test('instrui a NÃO duplicar tarefa em correção (atualiza no lugar)', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /NUNCA duplique/);
  assert.match(p, /ATUALIZA no lugar/);
});

test('fmtPoolLine: criador + descrição viram sufixo "criada por" e linha ↳', () => {
  const line = fmtPoolLine({ title: 'Ligar para aluno', status: 'pending', due_date: '2026-06-25', description: 'Aluno: Leandro\nAssunto: trancamento', creator: { full_name: 'Vitoria Souza' } });
  assert.match(line, /^- Ligar para aluno — pendente \(prazo 2026-06-25\) · criada por Vitoria/);
  assert.match(line, /\n {2}↳ Aluno: Leandro Assunto: trancamento/);
});

test('fmtPoolLine: sem criador/descrição mantém formato antigo de 1 linha (anti-regressão)', () => {
  const line = fmtPoolLine({ title: 'Fechar caixa', status: 'pending', due_date: '2026-06-13' });
  assert.strictEqual(line, '- Fechar caixa — pendente (prazo 2026-06-13)');
});

test('fmtPoolLine: descrição longa é truncada com reticências', () => {
  const line = fmtPoolLine({ title: 'X', status: 'pending', due_date: null, description: 'y'.repeat(300) });
  assert.match(line, /↳ y+…$/);
});

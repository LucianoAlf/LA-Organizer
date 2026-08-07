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

test('fmtPoolLine: prefixa o PACOTE quando t.packageTitle (GROUPREPORT-PACKAGE-TITLE-MISSING)', () => {
  const line = fmtPoolLine({ title: 'Venc 05 (prazo dia 06)', status: 'pending', due_date: '2026-07-06', packageTitle: 'Depósito de Cheques' });
  assert.match(line, /^- Depósito de Cheques: Venc 05 \(prazo dia 06\) — pendente/);
});

test('fmtPoolLine: sem packageTitle não muda (regressão)', () => {
  const line = fmtPoolLine({ title: 'Fechar caixa', status: 'pending', due_date: '2026-06-13' });
  assert.strictEqual(line, '- Fechar caixa — pendente (prazo 2026-06-13)');
});

// GROUPCHAT-POOL-DATE-NO-RELLABEL (Rose 13/07, grupo Financeiro): o pool do grupo ia
// pro LLM com a due_date CRUA (sem dia-relativo pré-computado), então o LLM calculava
// "amanhã/terça" e escorregava (+1). Paridade com o 1:1 (formatRelativeDate + REGRA DE OURO).
test('fmtPoolLine: com today, mostra o dia RELATIVO pré-computado, não a ISO crua (Rose 13/07)', () => {
  // hoje=13/07 (seg); vence 15/07 (qua) = em 2 dias. NUNCA "amanhã".
  const line = fmtPoolLine({ title: 'Venc 10', status: 'pending', due_date: '2026-07-15' }, '2026-07-13');
  assert.match(line, /qua/);               // weekday correto de 15/07
  assert.match(line, /em 2d/);             // relativo correto (não "amanhã")
  assert.doesNotMatch(line, /2026-07-15/); // não vaza a ISO crua pro LLM
});

test('buildGroupChatPrompt: passa o today pro pool (rótulo relativo, não a ISO crua)', () => {
  // hoje=12/06 (sex); vence 15/06 (seg) = em 3 dias.
  const p = buildGroupChatPrompt({ ...base, today: '2026-06-12', pool: [{ title: 'Fechar caixa', status: 'pending', due_date: '2026-06-15' }] });
  assert.match(p, /em 3d/);
  assert.doesNotMatch(p, /prazo 2026-06-15/);
});

// ── GROUPCHAT-DATE-SELF-POISONING (Rose 06/08) ───────────────────────────────
// A Rose cravou o padrão: "o dia do tom vai até 21h... ele conta que é dia 7 já". Fui atrás
// achando deslocamento de UTC. NÃO era: a âncora e o pool entregam 06/08 corretamente.
//
// O que acontece é pior e mais simples: o TOM errou UMA vez, a fala virou linha no histórico
// do grupo, e o histórico volta no prompt de toda rodada seguinte. Dump do prompt real às 23h:
//   L10  quinta 06/08 (HOJE)              <- âncora, correta
//   L53  TOM: Com base na lista de hoje (07/08):     <- ele, errado, ontem
//   L118 TOM: Rose, aqui o que a lista mostra hoje (07/08):
// Quatro afirmações erradas e MAIS RECENTES contra uma âncora antiga. Ele copia a si mesmo.
//
// Fix: reancorar a data DEPOIS do histórico, dizendo que fala antiga não é fato.
const { buildGroupChatPrompt: _bp } = require('./group-chat-prompt');

const _base = {
  soulText: 'SOUL', groupName: 'Financeiro', members: [{ name: 'Rose' }], senderName: 'Rose',
  pool: [], today: '2026-08-06', longTermMemory: null, notesContext: '', credentialContext: '',
  dateAnchor: '**Data/hora agora (BRT):** 2026-08-06 22:03 (quinta)',
  history: [{ who: 'TOM', role: 'tom', content: 'Com base na lista de hoje (07/08): nenhuma!' }],
};

test('a data é REANCORADA depois do historico — senao a fala velha do TOM ganha por recencia', () => {
  const p = _bp(_base);
  const iHist = p.indexOf('Conversa recente');
  const iReanc = p.lastIndexOf('2026-08-06');
  assert.ok(iHist > 0, 'nao achei o bloco de historico');
  assert.ok(iReanc > iHist, 'a ultima afirmacao de data no prompt ainda vem ANTES do historico');
});

test('a reancoragem diz explicitamente que data no historico NAO e fato', () => {
  const p = _bp(_base);
  const depois = p.slice(p.indexOf('Conversa recente'));
  assert.match(depois, /hist[oó]rico/i);
  assert.match(depois, /2026-08-06|06\/08/);
});

test('sem `today` o prompt nao inventa reancoragem (degrada silencioso)', () => {
  const p = _bp({ ..._base, today: null });
  const depois = p.slice(p.indexOf('Conversa recente'));
  assert.ok(!/RE-ANCORAGEM/i.test(depois), 'inventou bloco de data sem ter a data');
});

// ── GROUPCHAT-DATE-SELF-POISONING (Rose 06/08) ────────────────────────────────
// Medição retroativa: 11 das 26 falas dele que afirmam "hoje DD/MM" estavam erradas (42%),
// sempre em rajada. A âncora no topo estava CERTA nas três vezes — o que venceu foi a fala
// antiga dele, relida no histórico e no resumo de longo prazo. O prompt não pode reapresentar
// esse carimbo de data como se fosse fato.
const { neutralizaDataAfirmada: _neutraliza } = require('../utils/date-claim');

test('fala ANTIGA do TOM entra no prompt sem o carimbo de data', () => {
  const p = buildGroupChatPrompt({
    soulText: 'S', groupName: 'G', members: [{ name: 'Rose' }], pool: [],
    history: [{ role: 'tom', who: 'TOM', content: 'Com base na lista de hoje (07/08): nada por aqui.' }],
    senderName: 'Rose', today: '2026-08-06',
  });
  assert.ok(p.includes('Com base na lista de hoje: nada por aqui.'), 'a frase tem que sobreviver sem a data');
  assert.ok(!p.includes('07/08'), 'a data errada da fala antiga NÃO pode reaparecer no prompt');
});

test('fala de PESSOA entra intacta — não adulteramos o que o humano disse', () => {
  const p = buildGroupChatPrompt({
    soulText: 'S', groupName: 'G', members: [{ name: 'Rose' }], pool: [],
    history: [{ role: 'member', who: 'Rose', content: 'Tom, hoje é 06/08, presta atenção' }],
    senderName: 'Rose', today: '2026-08-06',
  });
  assert.ok(p.includes('Tom, hoje é 06/08, presta atenção'), 'fala humana é dado, não se mexe');
});

test('memória de longo prazo entra sem data congelada e avisada como sessão PASSADA', () => {
  // Texto REAL de work_groups.tom_chat_memory do grupo Financeiro.
  const p = buildGroupChatPrompt({
    soulText: 'S', groupName: 'G', members: [{ name: 'Rose' }], pool: [], history: [],
    senderName: 'Rose', today: '2026-08-06',
    longTermMemory: '<li>TOM se confundiu com a data — Rose corrigiu: hoje é <strong>06/08</strong></li>',
  });
  assert.ok(!/hoje é <strong>06\/08/.test(p), 'fato datado não pode virar verdade permanente');
  assert.ok(/sess(ões|ão) (anterior|passad)/i.test(p), 'o bloco precisa se declarar como passado');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { lerFlag, elegivelHoje, textoLembreteDiario, recusaLembreteDiario } = require('./lembrete-diario');
const { lerEdicao, montarPatch } = require('./edicao-tarefa');

const HOJE = '2026-09-11';
const T = (o) => ({ id: 'x', title: 'Entregar planilha', status: 'pending', lembrete_diario: true, due_date: '2026-09-14', ...o });

test('flag: aceita booleano e as palavras que o LLM usa; o resto é null (não mexe)', () => {
  assert.strictEqual(lerFlag(true), true);
  assert.strictEqual(lerFlag('sim'), true);
  assert.strictEqual(lerFlag('false'), false);
  assert.strictEqual(lerFlag(undefined), null);
  assert.strictEqual(lerFlag('talvez'), null);
});

test('toca de hoje até o prazo, inclusive — e para depois, concluída ou sem flag', () => {
  assert.strictEqual(elegivelHoje(T(), HOJE), true);
  assert.strictEqual(elegivelHoje(T({ due_date: HOJE }), HOJE), true);
  assert.strictEqual(elegivelHoje(T({ due_date: '2026-09-10' }), HOJE), false);
  assert.strictEqual(elegivelHoje(T({ status: 'done' }), HOJE), false);
  assert.strictEqual(elegivelHoje(T({ status: 'cancelled' }), HOJE), false);
  assert.strictEqual(elegivelHoje(T({ lembrete_diario: false }), HOJE), false);
  assert.strictEqual(elegivelHoje(T({ due_date: null }), HOJE), false);
});

test('texto diz quanto falta, e no dia diz hoje', () => {
  assert.match(textoLembreteDiario({ nick: 'Alf', titulo: 'X', prazo: '2026-09-14', hoje: HOJE }), /prazo 14\/09 \(faltam 3 dias\)/);
  assert.match(textoLembreteDiario({ nick: 'Alf', titulo: 'X', prazo: '2026-09-12', hoje: HOJE }), /vence amanhã/);
  assert.match(textoLembreteDiario({ nick: 'Alf', titulo: 'X', prazo: HOJE, hoje: HOJE }), /vence \*hoje\*/);
});

test('ligar sem prazo ou em tarefa de grupo é recusado com pergunta; desligar nunca é recusado', () => {
  assert.match(recusaLembreteDiario({ lembreteDiario: true }, { title: 'A', due_date: null }), /não tem prazo — até quando/);
  assert.match(recusaLembreteDiario({ lembreteDiario: true }, { title: 'A', due_date: HOJE, assigned_group_id: 'g' }), /é do grupo/);
  assert.strictEqual(recusaLembreteDiario({ lembreteDiario: true }, { title: 'A', due_date: HOJE }), null);
  assert.strictEqual(recusaLembreteDiario({ lembreteDiario: false }, { title: 'A', due_date: null }), null);
});

test('edição: lembrete_diario sozinho é mudança válida e NÃO renomeia a tarefa', () => {
  const e = lerEdicao({ action: 'update', id: 'ab12cd34', title: 'Entregar planilha do mês', lembrete_diario: true });
  assert.strictEqual(e.erro, undefined);
  assert.strictEqual(e.lembreteDiario, true);
  assert.strictEqual(e.novoTitulo, '');
  const r = montarPatch(e, { title: 'Entregar planilha', lembrete_diario: false });
  assert.deepStrictEqual(r.patch, { lembrete_diario: true });
  assert.deepStrictEqual(r.mudancas, ['lembrete diário ligado']);
});

test('edição: já ligado não muda; desligar grava false', () => {
  assert.deepStrictEqual(montarPatch(lerEdicao({ id: 'ab12cd34', lembrete_diario: true }), { lembrete_diario: true }).mudancas, []);
  const r = montarPatch(lerEdicao({ id: 'ab12cd34', lembrete_diario: 'false' }), { lembrete_diario: true });
  assert.deepStrictEqual(r.patch, { lembrete_diario: false });
  assert.deepStrictEqual(r.mudancas, ['lembrete diário desligado']);
});

// ── LIGAÇÃO NO ENGINE, NO DESPACHANTE E NO PROMPT ─────────────────────────────────────
const _fs = require('node:fs');
const _p = require('node:path');
const ENG = _fs.readFileSync(_p.join(__dirname, '..', 'engine.js'), 'utf8');
const DSP = _fs.readFileSync(_p.join(__dirname, '..', 'rituals', 'dispatcher.js'), 'utf8');
const SYS = _fs.readFileSync(_p.join(__dirname, '..', 'prompts', 'system.js'), 'utf8');

test('engine: update lê prazo/flag, recusa sem prazo, e create grava o flag só com prazo', () => {
  assert.match(ENG, /const _COLS_ED = 'id, title, description, assigned_to, created_by, assigned_group_id, status, due_date, lembrete_diario';/);
  assert.match(ENG, /recusaLembreteDiario\(ed, _full \|\| t\)/);
  assert.match(ENG, /lerFlag\(a\.lembrete_diario\) === true/);
});

test('despachante: job das 11h com claim próprio, e a véspera das 18h deixa essas tarefas pro diário', () => {
  assert.match(DSP, /async function checkDailyTaskReminders\(ymdToday\)/);
  assert.match(DSP, /now\.hour === 11\)[\s\S]{0,80}checkDailyTaskReminders\(now\.ymd\)/);
  assert.match(DSP, /notification_type: 'daily_task_reminder'/);
  assert.match(DSP, /\.is\('assigned_group_id', null\)[^\n]*\n\s*\.eq\('lembrete_diario', false\)/);
  const corpo = DSP.slice(DSP.indexOf('async function checkDailyTaskReminders('), DSP.indexOf('// Sprint Fase B — Lojinha'));
  assert.ok(corpo.includes("proactiveLink.sendAndLink(supabase, { phone: collab.phone, content: text, collaboratorId: collab.id, refType: 'task', refId: t.id })"), 'toque diário tem que ir por sendAndLink vinculado à tarefa');
  assert.ok(!corpo.includes('whatsapp.sendMessage('), 'envio cru no toque diário');
  assert.ok(!corpo.includes("from('conversation_history').insert"), 'insert manual de histórico duplica o log do sendAndLink');
});

test('prompt: pedido sobre UMA tarefa vira lembrete_diario, não PREFS_UPDATE global', () => {
  assert.match(SYS, /"lembrete_diario": true/);
  assert.match(SYS, /NÃO é \\`<<PREFS_UPDATE>>\\` \\`reminder_lead\\`/);
});

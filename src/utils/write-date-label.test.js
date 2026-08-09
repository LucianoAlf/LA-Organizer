'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rotuloDeFala, corrigeRotuloDeEscrita, datasGravadasDasActions } = require('./write-date-label');

// ── PROVA DE REVERSÃO — CONFAB-WRITE-DATE-NO-RELLABEL, caso Anne 05/08 ────────────
// Literal do banco (conversation_history 2026-08-06 01:14:14Z). Anne pediu "me lembre
// no dia 7"; o marker gravou 07/08 CERTO e a fala saiu "pra amanhã" (era quarta 05/08).
// Do outro lado a leitura foi "manhã", não "amanhã" — a conclusão foi que o TOM tinha
// errado o que estava certo, e o turno virou 3 turnos de correção desnecessária.
// O dado nunca esteve errado; a narração esteve.
test('caso Anne: "amanhã" com 07/08 gravado vira o rótulo certo', () => {
  const falaReal = '✅ Fechei os cheques do dia 5. E anotei o lembrete pra amanhã às 10h30!';
  const r = corrigeRotuloDeEscrita(falaReal, '2026-08-07', '2026-08-05');
  assert.equal(r.corrigiu, true);
  assert.equal(r.de, 'amanhã');
  assert.equal(r.para, 'sexta (07/08)');
  assert.equal(r.texto, '✅ Fechei os cheques do dia 5. E anotei o lembrete pra sexta (07/08) às 10h30!');
  assert.ok(!/amanhã/i.test(r.texto), 'o rótulo errado não pode sobreviver');
});

// Caso Krissya 01/07 23:07 BRT (banco: fala 2026-07-02 02:07Z). O pedido foi "amanhã",
// o TOM narrou "Hoje às 11:30" e levou o "Hoje não, amanhã" de volta. Direção inversa
// da Anne, mesmo buraco. Maiúscula no começo da linha tem que sobreviver à troca.
test('caso Krissya: "Hoje" com 02/07 gravado vira "Amanhã", preservando a maiúscula', () => {
  const falaReal = '✅ Anotado, Krissya.\n\n📋 *Ler o roteiro que Luciano me mandou*\n⏰ Hoje às 11:30';
  const r = corrigeRotuloDeEscrita(falaReal, '2026-07-02', '2026-07-01');
  assert.equal(r.corrigiu, true);
  assert.equal(r.para, 'amanhã');
  assert.ok(r.texto.endsWith('⏰ Amanhã às 11:30'), `capitalização perdida: ${r.texto}`);
});

// ── O CASO NORMAL — não pode mexer em quem acertou ───────────────────────────────
test('rótulo que bate com o gravado passa intacto', () => {
  const t = '✅ Anotado! Amanhã às 9h te lembro de finalizar a conciliação.';
  const r = corrigeRotuloDeEscrita(t, '2026-06-12', '2026-06-11');
  assert.equal(r.corrigiu, false);
  assert.equal(r.texto, t);
});

// ── GUARDAS — na dúvida, não age (só reporta) ────────────────────────────────────
// Caso Dudu 10/06: "de hoje" fala da consulta cancelada, "amanhã" do lembrete novo.
// Com dois rótulos na fala não dá pra saber qual é o da data gravada; trocar o errado
// estragaria a frase. Prefere não agir a agir torto.
test('dois rótulos na mesma fala: não age', () => {
  const t = 'Cancelo essa de hoje e abro um lembrete pra você agendar outra — amanhã de manhã te cobro.';
  const r = corrigeRotuloDeEscrita(t, '2026-06-12', '2026-06-10');
  assert.equal(r.corrigiu, false);
  assert.equal(r.texto, t);
  assert.equal(r.motivo, 'rotulo_ambiguo');
});

// "amanhã (sex 07/08)" é território do date-claim (o carimbo colado). Aqui a fala já
// carrega a data absoluta, então o leitor tem a informação certa mesmo com o rótulo
// torto — e reescrever produziria "sexta (07/08), quinta 02/07".
test('rótulo com data colada: não age (é o outro guard)', () => {
  const t = '📅 *Reunião Time Gestão*\n🗓️ Amanhã, quinta 02/07 · 9h–10h';
  const r = corrigeRotuloDeEscrita(t, '2026-07-03', '2026-07-01');
  assert.equal(r.corrigiu, false);
  assert.equal(r.motivo, 'data_colada');
});

test('fala sem rótulo relativo passa intacta', () => {
  const t = '✅ Anotado: *Imprimir adesivos do Drum Games* — sexta às 10h.';
  const r = corrigeRotuloDeEscrita(t, '2026-07-06', '2026-07-03');
  assert.equal(r.corrigiu, false);
  assert.equal(r.motivo, 'sem_rotulo');
});

// "manhã" mora dentro de "amanhã": um `\b` ASCII (ou um match ingênuo) casaria duas
// vezes e o guard de rótulo-único derrubaria a correção legítima. Já queimou a casa
// antes (GROUPCHAT-DATE-SELF-POISONING) — fica ancorado.
test('"amanhã de manhã" conta como UM rótulo', () => {
  const r = corrigeRotuloDeEscrita('Anotado ✅ Lembrete pra amanhã de manhã: ir ao Parque Shopping.',
    '2026-06-09', '2026-06-07');
  assert.equal(r.corrigiu, true);
  assert.equal(r.para, 'terça (09/06)');
});

test('entrada inválida devolve o texto intacto, sem exceção', () => {
  for (const [txt, data, hoje] of [
    ['Anotei pra amanhã.', null, '2026-08-05'],
    ['Anotei pra amanhã.', '2026-08-07', null],
    ['Anotei pra amanhã.', 'lixo', '2026-08-05'],
    [null, '2026-08-07', '2026-08-05'],
  ]) {
    const r = corrigeRotuloDeEscrita(txt, data, hoje);
    assert.equal(r.corrigiu, false);
    assert.equal(r.texto, txt || '');
  }
});

// ── O FORMATADOR ─────────────────────────────────────────────────────────────────
// Formato copiado da própria fala do TOM quando ele acerta ("dia 7 (sexta)", turno
// seguinte da Anne): dia da semana + data entre parênteses. Não uso o
// formatRelativeDate de dates.js porque ele produz "07/08 sex (em 2d)" — rótulo de
// CONTEXTO, para o LLM ler, não português para a pessoa ouvir.
test('rotuloDeFala cobre a vizinhança de hoje e cai pra data numérica depois', () => {
  const hoje = '2026-08-05'; // quarta
  assert.equal(rotuloDeFala('2026-08-05', hoje), 'hoje');
  assert.equal(rotuloDeFala('2026-08-06', hoje), 'amanhã');
  assert.equal(rotuloDeFala('2026-08-04', hoje), 'ontem');
  assert.equal(rotuloDeFala('2026-08-07', hoje), 'sexta (07/08)');
  assert.equal(rotuloDeFala('2026-08-11', hoje), 'terça (11/08)');
  assert.equal(rotuloDeFala('2026-08-12', hoje), '12/08');   // 7d+: dia-da-semana confunde
  assert.equal(rotuloDeFala('2026-08-01', hoje), '01/08');   // passado distante
  assert.equal(rotuloDeFala('lixo', hoje), '');
});

// Aritmética em UTC a partir de YMD já resolvido em BRT — sem conversão de fuso não há
// como deslocar o dia (LOCALYMD-UTC-SHIFT). Vira o mês e o ano sem tropeçar.
test('rotuloDeFala atravessa virada de mês e de ano', () => {
  assert.equal(rotuloDeFala('2026-09-01', '2026-08-31'), 'amanhã');
  assert.equal(rotuloDeFala('2027-01-01', '2026-12-31'), 'amanhã');
  assert.equal(rotuloDeFala('2026-12-31', '2027-01-01'), 'ontem');
});

// ── QUAL DATA FOI GRAVADA ────────────────────────────────────────────────────────
// O auto-align (engine.js:10941) e o weekday override (4907) MUTAM as actions antes de
// gravar, então ler as actions depois do apply é ler o que foi para o banco.
test('datasGravadasDasActions colhe a data do create com offset BRT', () => {
  // Payload real do caso Anne (marker_logs 06/08 01:14:12).
  assert.deepEqual(
    datasGravadasDasActions([{ action: 'create', title: 'Separar cheques', remind_at: '2026-08-07T10:30:00-03:00' }]),
    ['2026-08-07']);
});

test('datasGravadasDasActions cobre due_date, new_due_date e new_remind_at', () => {
  assert.deepEqual(datasGravadasDasActions([{ action: 'create', due_date: '2026-08-07' }]), ['2026-08-07']);
  assert.deepEqual(datasGravadasDasActions([{ action: 'reschedule', new_due_date: '2026-08-11' }]), ['2026-08-11']);
  assert.deepEqual(datasGravadasDasActions([{ action: 'reschedule', new_remind_at: '2026-08-11T09:00:00-03:00' }]), ['2026-08-11']);
});

// Timestamp em Z na madrugada é o dia ANTERIOR em BRT. Ler o literal daria 08/08 e a
// correção "consertaria" para o dia errado — pior que não agir. (LOCALYMD-UTC-SHIFT.)
test('datasGravadasDasActions converte Z para o dia civil de BRT', () => {
  assert.deepEqual(datasGravadasDasActions([{ action: 'create', remind_at: '2026-08-08T01:00:00Z' }]), ['2026-08-07']);
});

test('datasGravadasDasActions ignora ação sem data e ação que não grava data', () => {
  assert.deepEqual(datasGravadasDasActions([{ action: 'complete', id: 'abc12345' }]), []);
  assert.deepEqual(datasGravadasDasActions([{ action: 'create', title: 'sem prazo' }]), []);
  assert.deepEqual(datasGravadasDasActions(null), []);
});

test('datasGravadasDasActions devolve datas distintas sem repetir', () => {
  const r = datasGravadasDasActions([
    { action: 'create', due_date: '2026-08-07', remind_at: '2026-08-07T10:30:00-03:00' },
    { action: 'create', due_date: '2026-08-11' },
  ]);
  assert.deepEqual(r.sort(), ['2026-08-07', '2026-08-11']);
});

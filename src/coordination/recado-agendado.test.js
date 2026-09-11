'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  lerEnvioAgendado, aindaAgendavel, ehCancelamentoAgendado, quandoLegivel,
  textoAgendado, textoAvisoSolicitante, textoCancelado, textoErroHorario,
} = require('./recado-agendado');
const { buildCoordinationConfirmPreview } = require('./coord-confirm');

// Clayton 14/07/2026 19:45:19 BRT — "Pode ser as 9 da manhã" (finding 03f2c79b).
const CLAYTON_AGORA = Date.parse('2026-07-14T19:45:19-03:00');

test('Clayton: recado pro Luciano amanhã às 9h é AGENDADO pra ele, não lembrete pro Clayton', () => {
  const r = lerEnvioAgendado({ send_at: '2026-07-15T09:00:00-03:00' }, CLAYTON_AGORA);
  assert.deepStrictEqual(r, { sendAt: '2026-07-15T12:00:00.000Z' });
  assert.strictEqual(textoAgendado('Luciano', r.sendAt, CLAYTON_AGORA, 'ab12'),
    '🕘 Combinado — mando pra *Luciano* amanhã (15/07) às 9h. [ID: ab12]');
});

test('send_at: ausente = agora; sem fuso = Brasília; alias aceito', () => {
  assert.deepStrictEqual(lerEnvioAgendado({}, CLAYTON_AGORA), { sendAt: null });
  assert.deepStrictEqual(lerEnvioAgendado({ send_at: '2026-07-15T09:00' }, CLAYTON_AGORA), { sendAt: '2026-07-15T12:00:00.000Z' });
  assert.deepStrictEqual(lerEnvioAgendado({ enviar_em: '2026-07-15T09:00:00-03:00' }, CLAYTON_AGORA), { sendAt: '2026-07-15T12:00:00.000Z' });
});

test('send_at: já passou, lixo e longe demais viram erro (pergunta); até 2 min à frente é agora', () => {
  assert.deepStrictEqual(lerEnvioAgendado({ send_at: '2026-07-14T09:00:00-03:00' }, CLAYTON_AGORA), { erro: 'send_at_passado' });
  assert.deepStrictEqual(lerEnvioAgendado({ send_at: 'amanhã cedo' }, CLAYTON_AGORA), { erro: 'send_at_invalido' });
  assert.deepStrictEqual(lerEnvioAgendado({ send_at: 42 }, CLAYTON_AGORA), { erro: 'send_at_invalido' });
  assert.deepStrictEqual(lerEnvioAgendado({ send_at: '2026-12-01T09:00:00-03:00' }, CLAYTON_AGORA), { erro: 'send_at_longe' });
  assert.deepStrictEqual(lerEnvioAgendado({ send_at: '2026-07-14T19:46:00-03:00' }, CLAYTON_AGORA), { sendAt: null });
});

test('se o horário passou enquanto a pessoa confirmava, não agenda — manda já', () => {
  assert.strictEqual(aindaAgendavel('2026-07-15T12:00:00.000Z', CLAYTON_AGORA), true);
  assert.strictEqual(aindaAgendavel('2026-07-14T22:46:00.000Z', CLAYTON_AGORA), false);
  assert.strictEqual(aindaAgendavel(null, CLAYTON_AGORA), false);
});

test('horário legível: hoje, amanhã e dia da semana', () => {
  const agora = Date.parse('2026-09-11T10:00:00-03:00'); // sexta
  assert.strictEqual(quandoLegivel('2026-09-11T18:30:00.000Z', agora), 'hoje às 15h30');
  assert.strictEqual(quandoLegivel('2026-09-12T12:00:00.000Z', agora), 'amanhã (12/09) às 9h');
  assert.strictEqual(quandoLegivel('2026-09-15T12:00:00.000Z', agora), 'ter 15/09 às 9h');
});

test('cancelar: reconhece a ação; textos de cancelado e de nada pra cancelar', () => {
  assert.strictEqual(ehCancelamentoAgendado({ action: 'cancel_scheduled' }), true);
  assert.strictEqual(ehCancelamentoAgendado({ action: 'Cancelar' }), true);
  assert.strictEqual(ehCancelamentoAgendado({ mode: 'relay_literal' }), false);
  assert.strictEqual(textoCancelado('Luciano', 1), '🗑️ Cancelei o recado agendado pra *Luciano*.');
  assert.strictEqual(textoCancelado('Luciano', 2), '🗑️ Cancelei os 2 recados agendados pra *Luciano*.');
  assert.match(textoCancelado('Luciano', 0), /Não achei recado agendado/);
});

test('quem pediu sabe quando saiu — e quando não saiu', () => {
  assert.strictEqual(textoAvisoSolicitante('Luciano', 'Lembra do notebook amanhã', true),
    '📨 Mandei pra *Luciano* o recado que você agendou: _"Lembra do notebook amanhã"_');
  assert.match(textoAvisoSolicitante('Luciano', 'x'.repeat(200), false), /^⚠️ Não consegui mandar pra \*Luciano\*.*…"_\)\. Quer que eu tente de novo\?$/);
  assert.match(textoErroHorario('send_at_passado', 'Luciano'), /já passou — mando pra \*Luciano\* agora/);
});

test('pergunta de confirmação (rede) diz o horário e o cancelamento; a antiga não muda', () => {
  const amanha9 = new Date(Date.now() + 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T09:00:00-03:00';
  assert.match(buildCoordinationConfirmPreview([{ recipient_name: 'Luciano', send_at: new Date(Date.parse(amanha9)).toISOString() }]),
    /^Mando pra Luciano amanhã \(\d{2}\/\d{2}\) às 9h\? Confirma\?$/);
  assert.strictEqual(buildCoordinationConfirmPreview([{ recipient_name: 'Luciano', action: 'cancel_scheduled' }]),
    'Cancelo o recado agendado pra Luciano? Confirma?');
  assert.strictEqual(buildCoordinationConfirmPreview([{ recipient_name: 'Jhonatan' }]), 'Aviso o Jhonatan? Confirma?');
});

// ── LIGAÇÃO NO ENGINE, NO DESPACHANTE E NO PROMPT ─────────────────────────────────────
const _fs = require('node:fs');
const _p = require('node:path');
const ENG = _fs.readFileSync(_p.join(__dirname, '..', 'engine.js'), 'utf8');
const DSP = _fs.readFileSync(_p.join(__dirname, '..', 'rituals', 'dispatcher.js'), 'utf8');
const SYS = _fs.readFileSync(_p.join(__dirname, '..', 'prompts', 'system.js'), 'utf8');

test('engine: parser lê send_at e o cancelamento; executor agenda, cancela e reusa a linha no envio', () => {
  assert.match(ENG, /lerEnvioAgendado\(parsed\)/);
  assert.match(ENG, /ehCancelamentoAgendado\(parsed\)/);
  assert.match(ENG, /async function applyCoordinationRequestAction\(collab, parsed, opts = \{\}\)/);
  assert.match(ENG, /status: 'scheduled', send_after: _agendarPara/);
  assert.match(ENG, /opts\.reuseRequestId\s*\n\s*\? \{ data: \{ id: opts\.reuseRequestId \}, error: null \}/);
  assert.match(ENG, /module\.exports\.despacharRecadoAgendado = despacharRecadoAgendado;/);
});

test('engine: agendar/cancelar não é contado como "Recado enviado!" no sim', () => {
  assert.match(ENG, /if \(_r\.ok && _r\.kind\) _extras\.push\(_r\.replyText\);/);
  assert.match(ENG, /else if \(_okC \+ _jaIa\.length === _resto\) _outC/);
});

test('despachante: claim scheduled→pending antes de enviar, a cada tick', () => {
  assert.match(DSP, /async function dispatchScheduledCoordination\(now = new Date\(\)\)/);
  assert.match(DSP, /\.update\(\{ status: 'pending', updated_at: now\.toISOString\(\) \}\)\s*\n\s*\.eq\('id', row\.id\)\.eq\('status', 'scheduled'\)/);
  assert.match(DSP, /await dispatchScheduledCoordination\(new Date\(\)\);/);
});

test('prompt: recado pra depois é o mesmo marker com send_at — nunca lembrete pra quem pediu', () => {
  assert.match(SYS, /"send_at" em ISO completo/);
  assert.match(SYS, /NUNCA troque por lembrete pra própria pessoa/);
  assert.match(SYS, /"action":"cancel_scheduled"/);
});

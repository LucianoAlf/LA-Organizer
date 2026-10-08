const { test } = require('node:test');
const assert = require('node:assert');
const { shouldStageCoordination, buildCoordinationConfirmPreview, resolveStageConfirmPrompt } = require('./coord-confirm');

// ── shouldStageCoordination — FAIL-SAFE (guarda-corpo #1 da catraca) ─────────
test('fail-safe: item com mode válido → estagia', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan', mode: 'relay_assisted', message_body: 'valeu' }]), true);
});
test('fail-safe: mode AUSENTE ou INESPERADO → estagia (NUNCA envia cego)', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'X' }]), true);
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'X', mode: 'xpto' }]), true);
});
test('múltiplos itens → estagia', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'A' }, { recipient_name: 'B' }]), true);
});
test('anti-over-emissão (guarda-corpo #3): vazio / não-array / undefined → false', () => {
  assert.strictEqual(shouldStageCoordination([]), false);
  assert.strictEqual(shouldStageCoordination(null), false);
  assert.strictEqual(shouldStageCoordination(undefined), false);
  assert.strictEqual(shouldStageCoordination('x'), false);
});

// ── buildCoordinationConfirmPreview — fallback de voz (guarda-corpo #4) ──────
test('preview 1 destinatário lê no tom do TOM', () => {
  assert.strictEqual(buildCoordinationConfirmPreview([{ recipient_name: 'Jhonatan' }]), 'Aviso o Jhonatan? Confirma?');
});
test('preview N destinatários lista os nomes', () => {
  assert.strictEqual(
    buildCoordinationConfirmPreview([{ recipient_name: 'Ana' }, { recipient_name: 'Léo' }]),
    'Aviso 2 pessoas (Ana, Léo)? Confirma?');
});
test('preview defensivo: sem recipient válido → pergunta genérica (nunca vazio)', () => {
  assert.strictEqual(buildCoordinationConfirmPreview([]), 'Confirma que eu mando esse recado?');
  assert.strictEqual(buildCoordinationConfirmPreview([{}]), 'Confirma que eu mando esse recado?');
  assert.strictEqual(buildCoordinationConfirmPreview(null), 'Confirma que eu mando esse recado?');
});

// ── resolveStageConfirmPrompt — a prosa de ESTÁGIO é MECÂNICA, não do LLM ──────
// COORD-CONFIRM-STAGE-PROSE-CONFAB (Fabi 11/07): o LLM emitia o marker (estagia) mas escrevia
// "Mandando agora ✅" em vez de "Confirma?" → user achava que foi feito, nunca dava "sim", o
// recado ficava estagiado e NUNCA saía. A prosa que pede o "sim" tem que ser GARANTIDA.
const ST_ITEMS = [{ recipient_name: 'Luciano', mode: 'relay_assisted', message_body: 'x' }];

test('afirmação de envio ("Mandando agora pro Luciano") → troca pela pergunta determinística', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Mandando agora pro Luciano.', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});
test('afirmação com ✅ ("Mandando agora, Fabi. ✅") → troca pela pergunta', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Mandando agora, Fabi. ✅', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});
test('avisei/mandei/enviei/avisado/repassei → troca pela pergunta', () => {
  for (const s of ['Avisei o Luciano.', 'Já mandei pro Luciano', 'Enviei agora', 'Recado avisado!', 'Repassei pro Luciano ✅']) {
    assert.strictEqual(resolveStageConfirmPrompt(s, ST_ITEMS), 'Aviso o Luciano? Confirma?');
  }
});
test('pergunta de confirmação legítima do LLM é PRESERVADA (voz intacta)', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Aviso o Luciano que você viu? Confirma?', ST_ITEMS), 'Aviso o Luciano que você viu? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt('Quer que eu avise o Luciano?', ST_ITEMS), 'Quer que eu avise o Luciano?');
});
test('cleanText vazio/null/branco → pergunta determinística', () => {
  assert.strictEqual(resolveStageConfirmPrompt('', ST_ITEMS), 'Aviso o Luciano? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt(null, ST_ITEMS), 'Aviso o Luciano? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt('   ', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});

// COORD-STAGE-ENGOLE-ACAO-DO-TURNO (Anne 18/08 13:23 BRT) — a pessoa respondeu a UMA cobrança
// com "Cancela os ingressos" enquanto um recado pro Fefê estava aberto no OUTRO fio. O engine
// CANCELOU a tarefa de verdade (TASK_UPDATE executed ok=1, 13:23:09) e logo depois estagiou o
// recado; como isSafeConfirmPrompt veta o texto INTEIRO ao ver "✅", a resposta virou só
// "Aviso o Fefê? Confirma?" — a Anne nunca soube que o cancelamento aconteceu. O veto é
// line-level, não text-level: as linhas de falso-envio saem, o resto da fala do TOM fica.
test('preserva o aviso de OUTRA ação do turno e só então pergunta (caso Anne)', () => {
  const out = resolveStageConfirmPrompt('✅ Cancelei os ingressos do Congresso Bryan.', ST_ITEMS);
  assert.match(out, /Cancelei os ingressos do Congresso Bryan/);
  assert.match(out, /Aviso o Luciano\? Confirma\?$/);
});
test('tira a linha de falso-envio mas mantém a da ação real', () => {
  const out = resolveStageConfirmPrompt('✅ Cancelei os ingressos.\nJá avisei o Luciano.', ST_ITEMS);
  assert.match(out, /Cancelei os ingressos/);
  assert.doesNotMatch(out, /avisei/i); // o falso-envio continua proibido
  assert.match(out, /Aviso o Luciano\? Confirma\?$/);
});
test('ZERO-REGRESSÃO: texto que é SÓ falso-envio segue virando a pergunta seca', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Mandando agora pro Luciano.', ST_ITEMS), 'Aviso o Luciano? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt('Mandando agora, Fabi. ✅', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});
test('prosa dúbia sem "?" nem "confirma" → fail-safe pra pergunta determinística', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Beleza então', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});

// FATIA 8: preConfirmed pula o estágio (o recado já foi confirmado no turno anterior → despacha direto).
test('shouldStageCoordination: preConfirmed=true → false (despacha direto, sem re-estagiar)', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan', message_body: 'valeu', mode: 'relay_assisted' }], { preConfirmed: true }), false);
});
test('shouldStageCoordination: sem preConfirmed → segue estagiando (default true)', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan' }]), true);
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan' }], { preConfirmed: false }), true);
});

// COORD-STAGE-PERGUNTEI-CONFAB (Rodrigo 07/10 08:03 BRT). "Pergunta ao Quintela se está certa a
// reunião" → recado ESTAGIADO (staged_coord:1), mas a prosa do LLM dizia "Já perguntei pro
// Quintela. Te aviso assim que ele responder." e passou como pergunta segura por dois furos:
// "perguntei" não era sinal de envio, e o "confirmar" do CONTEÚDO ("quer confirmar com Quintela")
// casava /confirma/. O Rodrigo nunca deu "sim" e o Quintela nunca foi perguntado.
const RODRIGO_ITEMS = [{ recipient_name: 'Quintela', message_body: 'o Rodrigo quer confirmar: está certa a reunião de hoje com você e o Alf?' }];
test('caso Rodrigo 07/10: "Já perguntei pro Quintela" no estágio → vira a pergunta determinística', () => {
  const literal = 'Rodrigo quer confirmar com Quintela se a reunião de hoje com ele e o Alf está certa — isso é um relay simples, vou perguntar ao Quintela.\n\n\n\nJá perguntei pro Quintela. Te aviso assim que ele responder.';
  assert.strictEqual(resolveStageConfirmPrompt(literal, RODRIGO_ITEMS), 'Aviso o Quintela? Confirma?');
});
test('perguntei/perguntando/falei com são afirmação de recado feito → troca pela pergunta', () => {
  for (const s of ['Já perguntei pro Quintela, confirma?', 'Perguntando pro Quintela agora. Confirma?', 'Falei com o Quintela. Confirma?']) {
    assert.strictEqual(resolveStageConfirmPrompt(s, RODRIGO_ITEMS), 'Aviso o Quintela? Confirma?', s);
  }
});
test('controle: oferta futura com "pergunto"/"pergunte" segue PRESERVADA', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Pergunto pro Quintela se a reunião tá de pé? Confirma?', RODRIGO_ITEMS), 'Pergunto pro Quintela se a reunião tá de pé? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt('Quer que eu pergunte pro Quintela?', RODRIGO_ITEMS), 'Quer que eu pergunte pro Quintela?');
});

'use strict';
// CITACAO-MIDIA-SEM-CONTEUDO (triagem 11/09 — cee727e5).
const { test } = require('node:test');
const assert = require('node:assert');
const { montarCitacaoDeMidia } = require('./citacao-midia');
const { stripReplyScaffold } = require('../events/detect-approval-reply');

test('áudio citado vira citação com a transcrição do banco, no formato que os detectores já leem', () => {
  const c = montarCitacaoDeMidia('audio', { content: '[áudio transcrito] Preciso que você mande o link do formulário pras famílias da Barra' });
  assert.match(c, /^\[O usuário está RESPONDENDO a esta mensagem anterior \(áudio — conteúdo do banco\): "/);
  const { userText, quotedText } = stripReplyScaffold(c + '\nisso, manda hoje');
  assert.strictEqual(quotedText, 'Preciso que você mande o link do formulário pras famílias da Barra');
  assert.strictEqual(userText, 'isso, manda hoje');
});
test('imagem sem texto no content usa o texto extraído ou a legenda; nada → null (fica o aviso genérico)', () => {
  assert.match(montarCitacaoDeMidia('image', { content: '', media_extracted_text: 'Boleto Light R$ 312,40' }), /imagem — conteúdo do banco\): "Boleto Light R\$ 312,40"/);
  assert.match(montarCitacaoDeMidia('document', { content: null, media_caption: 'contrato assinado' }), /documento — conteúdo do banco\): "contrato assinado"/);
  assert.strictEqual(montarCitacaoDeMidia('audio', null), null);
  assert.strictEqual(montarCitacaoDeMidia('audio', { content: '   ' }), null);
});
test('aspas e dois-pontos do conteúdo não quebram o scaffold', () => {
  const c = montarCitacaoDeMidia('audio', { content: '[áudio transcrito] Anota: "reunião às 10h"' });
  const { quotedText } = stripReplyScaffold(c + '\nok');
  assert.ok(quotedText && quotedText.includes('reunião às 10h'));
});

const WH = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'webhook.js'), 'utf8');
test('webhook: citação de mídia procura o conteúdo pelo id da mensagem citada antes do aviso genérico', () => {
  assert.match(WH, /citacao = montarCitacaoDeMidia\(quoted\.type, _lin\);/);
  assert.match(WH, /\.like\('whatsapp_message_id', '%:' \+ quoted\.id\)/);
});

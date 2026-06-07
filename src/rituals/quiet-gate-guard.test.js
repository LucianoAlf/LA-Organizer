const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { checkFile, walk, SRC, REACTIVE_FILES } = require('../../scripts/check-quiet-gates');

// Anti-regressão do vazamento de quiet hours (domingo 07/06): todo envio
// PROATIVO (whatsapp.sendMessage) fora dos arquivos reativos precisa de um gate
// de silêncio (isQuietNow/sendProativo) ou marcador // quiet-exempt: na função.
// Esta é a mesma trava que o auto-deploy.ps1 roda antes do push.
test('nenhum envio proativo sem gate de silêncio', () => {
  const files = walk(SRC, []);
  const violations = [];
  for (const abs of files) {
    const rel = path.relative(SRC, abs);
    if (REACTIVE_FILES.has(rel)) continue;
    for (const v of checkFile(abs, rel)) {
      violations.push(`${rel}:${v.line}  ${v.snippet}`);
    }
  }
  assert.strictEqual(
    violations.length, 0,
    'Envio(s) proativo(s) SEM gate de silêncio:\n' + violations.join('\n') +
    '\n\nCorrija com isQuietNow()/sendProativo() ou marque // quiet-exempt: <motivo>.'
  );
});

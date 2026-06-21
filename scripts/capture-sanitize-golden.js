// Descartável: captura o golden-master da cadeia de sanitização ATUAL do claude.js
// (cópia verbatim de claude.js:276-321) sobre um corpus, ANTES de extrair sanitize.js.
// O teste de sanitize.js asserta saída idêntica → garante que o refactor não muda nada.
const fs = require('fs');
const path = require('path');
function currentSanitize(rawResult) {
  const sanitized = rawResult
    .replace(/<tool_(call|use|name|result)[\s\S]*?<\/tool_\1>/gi, '')
    .replace(/<\/?tool_(call|use|name|result)\b[^>]*>/gi, '')
    .replace(/<function_call[\s\S]*?<\/function_call>/gi, '')
    .replace(/<\/?function_call\b[^>]*>/gi, '')
    .replace(/<parameters?[\s\S]*?<\/parameters?>/gi, '')
    .replace(/<\/?parameters?\b[^>]*>/gi, '')
    .replace(/<details[\s\S]*?<\/details>/gi, '')
    .replace(/<\/?details\b[^>]*>/gi, '')
    .replace(/<summary[\s\S]*?<\/summary>/gi, '')
    .replace(/<\/?summary\b[^>]*>/gi, '')
    .replace(/<(?:antml:)?invoke\b[\s\S]*?<\/(?:antml:)?invoke>/gi, '')
    .replace(/<\/?(?:antml:)?(?:function_calls|invoke|parameter)\b[^>]*>/gi, '')
    .replace(/^.*\b(?:feedback\s+memory|memory\s+hint|saving\s+feedback)\b.*$/gim, '')
    .replace(/^.*\b(Based on|Now let me|Let me (?:update|read|write|check|create|save|run|verify|now)|I.ll (?:update|read|write|check|create|save|run|now)|I need to (?:update|read|write|check|create|save|run))\b.*$/gim, '')
    .replace(/^.*\b(MEMORY\.md|memory\/[\w-]+\.md|\/root\/\.claude|\.claude\/projects|\/opt\/LA-Organizer\/(?!docs\b))\b.*$/gim, '')
    .replace(/^.*\b(?:vou\s+salvar\s+isso\s+na\s+mem[óo]ria|salvando\s+na\s+mem[óo]ria|saving\s+to\s+memory)\b.*$/gim, '')
    .replace(/^.*\bsav(?:e[ds]?|ing)\b.*\bmemor(?:y|ies|[óo]ria)\b.*$/gim, '')
    .replace(/^.*\bsalv(?:o|a|ei|ando)\b.*\bmem[óo]ria\s+local\b.*$/gim, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^.*(?:\bssh\s+tom\b|\bscp\b|\bpm2\b|cat\s+\.env|grep\s+SUPABASE|setup-vps-key|connection\s+string|service_role|\/mnt\/[a-z]\/|\/opt\/LA-Organizer|\bsudo\s|\bnpm\s+run\b|node\s+--).*$/gim, '')
    .replace(/\n{3,}/g, '\n\n');
  return sanitized.trim();
}
const corpus = [
  '✅ Fechado, Fabi! Já dei baixa.\n\n<<TASK_UPDATE>>\n[{"action":"complete","id":"abc"}]\n<<END>>',
  'Now let me update the task list\nTarefa criada! 👽',
  'Para reiniciar rode ssh tom "pm2 restart tom" no servidor.',
  'Olha o código:\n```\nservice_role key aqui\n```\nPronto!',
  'Vou salvar isso na memória local pra lembrar depois.',
  '<invoke name="x"><parameter name="y">z</parameter></invoke>Resposta real.',
  'Bom dia! 👽 Tudo certo por aqui, sem novidades.',
  'Texto\n\n\n\ncom muitas quebras.',
];
const golden = corpus.map(input => ({ input, output: currentSanitize(input) }));
const dest = path.join(__dirname, '..', 'src', 'ai', '__fixtures__', 'sanitize.golden.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(golden, null, 2), 'utf8');
console.log('golden gravado:', golden.length, 'casos →', dest);

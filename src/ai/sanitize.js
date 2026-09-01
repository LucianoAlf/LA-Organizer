const BT = String.fromCharCode(96, 96, 96);
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
// Sanitiza o output do LLM antes de chegar no engine/usuário. Provider-agnóstico
// (Claude e Codex). Higiene de saída: remove tool-tags embutidas, narração em
// inglês, cercas de código, paths/comandos de infra e promessas falsas de "salvar
// na memória". Extraído verbatim de claude.js (Sprint 10-12, casos Rose 10-12/06).
// Inclui o .trim() final → retorna a string 100% limpa (idêntico ao `text` de hoje).
function sanitizeOutput(raw) {
  const rawResult = typeof raw === 'string' ? raw : '';
// Regras de TAG (tool_use, function_call, parameters, details/summary, invoke). Ficam
// separadas das regras de PROSA porque o resgate abaixo aplica SO estas: uma resposta
// estruturada nao pode perder linha por casar regra de prosa (path de infra, narracao),
// senao o JSON quebra e a falha volta a ser silenciosa -- que foi o pecado original.
function _tirarTags(s) {
  return String(s == null ? '' : s)
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
  ;
}

// Conteudo DENTRO das cercas, na ordem, colado.
function _dentroDasCercas(raw) {
  const fora = [];
  const re = new RegExp(BT + '[^' + NL + ']*' + NL + '?([' + BS + 's' + BS + 'S]*?)' + BT, 'g');
  let m;
  while ((m = re.exec(raw)) !== null) fora.push(m[1]);
  return fora.join(NL).trim();
}

// RESGATE DA CERCA (01/09). A regra que apaga blocos de cerca INTEIROS existe pra tirar
// codigo da resposta ao USUARIO. So que o prompt da auditoria pede 'Responda SOMENTE com
// JSON valido': o modelo devolvia o JSON cercado e o sanitizador apagava a resposta toda.
// Virava `result vazio` com subtype=success -- o Claude respondia CERTO e a gente jogava
// fora. Cegou a auditoria de 29/08 a 01/09 (20 pessoas na ultima noite) e o ciclo relatava
// 'nada novo', porque zero achado por FALHA e identico a zero achado por SAUDE.
// ESTREITO de proposito: so age quando sanitizar zerou TUDO e o desembrulhado tem cara de
// JSON. Prosa do TOM nunca comeca com { ou [, entao nenhuma resposta ao usuario muda.
function _resgatarEstruturado(rawResult, sanitizado) {
  if (sanitizado || !rawResult) return sanitizado;
  const dentro = _dentroDasCercas(rawResult);
  if (!/^[{[]/.test(dentro)) return sanitizado;
  return _tirarTags(dentro).trim();
}

  const sanitized = _tirarTags(rawResult)
    .replace(/^.*\b(?:feedback\s+memory|memory\s+hint|saving\s+feedback)\b.*$/gim, '')
    .replace(/^.*\b(Based on|Now let me|Let me (?:update|read|write|check|create|save|run|verify|now)|I.ll (?:update|read|write|check|create|save|run|now)|I need to (?:update|read|write|check|create|save|run))\b.*$/gim, '')
    .replace(/^.*\b(MEMORY\.md|memory\/[\w-]+\.md|\/root\/\.claude|\.claude\/projects|\/opt\/LA-Organizer\/(?!docs\b))\b.*$/gim, '')
    .replace(/^.*\b(?:vou\s+salvar\s+isso\s+na\s+mem[óo]ria|salvando\s+na\s+mem[óo]ria|saving\s+to\s+memory)\b.*$/gim, '')
    .replace(/^.*\bsav(?:e[ds]?|ing)\b.*\bmemor(?:y|ies|[óo]ria)\b.*$/gim, '')
    .replace(/^.*\bsalv(?:o|a|ei|ando)\b.*\bmem[óo]ria\s+local\b.*$/gim, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^.*(?:\bssh\s+tom\b|\bscp\b|\bpm2\b|cat\s+\.env|grep\s+SUPABASE|setup-vps-key|connection\s+string|service_role|\/mnt\/[a-z]\/|\/opt\/LA-Organizer|\bsudo\s|\bnpm\s+run\b|node\s+--).*$/gim, '')
    .replace(/\n{3,}/g, '\n\n');
  return _resgatarEstruturado(rawResult, sanitized.trim());
}

module.exports = { sanitizeOutput };

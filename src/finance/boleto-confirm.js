'use strict';
// Decide se a resposta do usuário CONFIRMA a criação da conta a partir de um boleto lido
// (intent bill_from_boleto, stage awaiting_confirm). PURO.
//
// BOLETO-CONFIRM-FAIL-OPEN (Rose 15/09 21:17): o consumidor era fail-OPEN — só recusava
// palavra de cancelamento e criava a conta pra qualquer outra coisa. A Rose respondeu "meu
// nome é Rose, tom" (corrigindo o nome errado que o TOM usou, não o boleto) e levou uma conta
// de R$ 401,45 da ESCOLA na carteira PESSOAL. A rajada de 5 mensagens é o que torna isso
// comum: a intent abre no mesmo segundo e a mensagem seguinte quase nunca é sobre o boleto.
//
// A porta irmã (detectLaunchConfirm, launch-confirm.js:82) já é fail-CLOSED desde 12/07
// (FIN-LAUNCH-CONFIRM-NEGATION-IGNORED) e 14/07 (FIN-LAUNCH-CONFIRM-ON-QUESTION). Mesma
// regra de ouro: na dúvida entre criar e não criar, NÃO cria — a intent fica aberta e o "sim"
// que vier depois ainda funciona.
//
// `conf` = veredito do detectUserConfirmation ('yes'|'no'|null).
// Retorna 'yes' (cria) | 'no' (desiste) | null (ambíguo → segue o fluxo normal).

const _NEG = /\bn[ãa]o\b|\bnao\b|\bnem\b|\bnunca\b|\bespera\b|\bpera[íi]?\b|\bcancela|\besquec|\bdeixa\b|deixa\s+pra/;
// Verbo de CRIAR a conta + as palavras de recorrência, que também são consentimento
// ("repete" responde a pergunta criando mensal em vez de única).
const _VERB = /\b(cria|criar|cadastra|cadastrar|registra|registrar|confirmad[oa]|confirmo|confirma|repete|mensal|recorrente|fix[ao])\b|todo\s*m[êe]s/;
const _QUESTION = /\?|(^|\s)(qual|quais|quando|onde|aonde|quem|quanto|de\s?quanto|cad[êe]|por\s?qu[eê]|pra\s?qu[eê])(?=$|[\s?!.,;])/;

function detectBoletoConfirm(text, conf) {
  const s = String(text || '').toLowerCase().trim();
  if (_QUESTION.test(s)) return null;            // pergunta → o LLM responde, a intent segue aberta
  if (conf === 'no' || _NEG.test(s)) return 'no'; // negação NUNCA cria
  if (conf === 'yes') return 'yes';
  if (s.length <= 40 && _VERB.test(s)) return 'yes';
  return null;                                    // assunto alheio (caso Rose) → não decide
}

module.exports = { detectBoletoConfirm };

'use strict';
// credencial-retry-gate.js — reconhece, DETERMINISTICAMENTE, uma fala em que o TOM diz que
// vai cadastrar/alterar uma credencial (ou afirma que ja cadastrou) SEM ter emitido o
// marker <<CREDENCIAL_ACTION>>. Modulo PURO: so regex sobre texto, sem I/O.
//
// O PROBLEMA (caso Hugo, 04/09 17:21)
// O TOM respondeu "Vou cadastrar:\n\n*Conta do Google Ads*\nLogin: ...\nSenha: ...\n\nConfirma?"
// sem marker nenhum. Sem marker o executor deterministico nunca roda, entao nenhuma intent
// `credencial_write` nasce — e a confirmacao do turno seguinte ("isso") caiu no auto-resolve
// GENERICO (engine.js ~10676), cujo ramo sem payload concreto manda, literalmente, "assuma
// que nao conseguiu registrar e peca pra pessoa repetir o pedido com os detalhes". Foi o
// engine que ditou o "me manda os dados de novo" — com os dados dois turnos acima, visiveis
// pro modelo. Nada foi gravado e a senha ainda foi ecoada em texto claro na resposta.
//
// Este gate alimenta DUAS defesas, nessa ordem:
//   1. RETRY NO MESMO TURNO (engine.js, antes do executor): o texto bruto da pessoa ainda
//      esta em maos, entao da pra converter a fala em marker e seguir o caminho normal —
//      o executor reescreve a resposta com os valores mascarados e abre a confirmacao.
//   2. AUTO-RESOLVE (engine.js ~10662): se mesmo assim a confirmacao chegar numa intent
//      generica, a regra manda reproduzir a proposta em marker — nunca pedir de novo.
//
// FAIL-CLOSED por construcao: sem sinal claro devolve false e o comportamento e o de hoje.
// O custo de um falso positivo e baixo (o executor so ABRE confirmacao, nunca grava direto,
// e a pessoa ve o resumo antes de aprovar); o de um falso negativo e o bug acima.
//
// LIMITE CONHECIDO, coberto por fora: uma resposta de LEITURA de credencial (o two-pass do
// <<PEDIR_CREDENCIAIS>>) traz ficha com rotulos reais e pode conter um verbo de escrita
// solto ("anotei aqui pra voce"). O gate nao distingue esse caso — quem distingue e o
// engine, que so consulta este modulo quando `_credenciaisNoTurno` ainda e false (a leitura
// liga essa flag antes). Nao remover essa guarda achando que o gate se defende sozinho.

// Verbo de ESCRITA em primeira pessoa: compromisso ("vou cadastrar") ou afirmacao de feito
// ("cadastrei"). A afirmacao de feito importa tanto quanto a promessa: sem marker ela e
// mentira — o TOM diz que gravou e nada foi gravado.
const VERBO_ESCRITA = /\b(?:vou|posso|deixa\s+eu|quer\s+que\s+eu|j[áa]\s+vou|vou\s+j[áa]|bora)\s+(?:j[áa]\s+)?(?:cadastr|registr|grav|salv|guard|anot|atualiz|edit|apag|delet|remov)\w*|\b(?:cadastrei|registrei|gravei|salvei|guardei|anotei|atualizei|editei|apaguei|deletei|removi)\b|\bcadastr(?:o|ar|ando)\b/iu;

// Rotulo de campo de credencial no inicio de linha, seguido de separador. Ancorado em linha
// de proposito: "a senha esta no cofre" no meio de uma frase nao e uma ficha de credencial.
const ROTULO_QUALQUER = /^[\s*_>#-]*(?:e-?mail|login|usu[áa]ri[oa]|user(?:name)?|senha|password|pass|token|refresh[\s_-]?token|access[\s_-]?token|api[\s_-]?key|apikey|chave(?:\s+(?:de\s+)?api)?|secret|client[\s_-]?(?:id|secret)|url|link|endpoint|conta|servi[çc]o|projeto)[\s*_]*[:=]/imu;

// Rotulo SENSIVEL: um so ja basta pra caracterizar ficha de credencial.
const ROTULO_SENSIVEL = /^[\s*_>#-]*(?:senha|password|pass|token|refresh[\s_-]?token|access[\s_-]?token|api[\s_-]?key|apikey|chave(?:\s+(?:de\s+)?api)?|secret|client[\s_-]?secret)[\s*_]*[:=]/imu;

const PALAVRA_CREDENCIAL = /\bcredenci\w+/iu;

// ---------------------------------------------------------------------------
// NAO EXISTE MAIS UM VETO POR "JA MASCARADO". Removido em 04/09 18:40 UTC, depois de o gate
// ter falhado no primeiro caso real com ele no ar.
//
// O que eu tinha escrito: `const JA_MASCARADO = /●{3,}/` vetava o gate, sob a hipotese de que
// texto com ●●●●●● so podia ser o resumo do executor e nao devia ser reprocessado.
//
// O que aconteceu de verdade (Hugo 15:40 BRT): o MODELO escreveu a confirmacao imitando o
// formato do engine — "Vou cadastrar: ... Senha: ●●●●●● ... Confirma?" — e sem marker.
// Ele copiou o ●●●●●● junto, porque a mensagem que o engine mandou no turno anterior esta no
// historico como se fosse fala dele (system.js:4039 devolve todo outbound como role
// 'assistant'). Ou seja: a marca de mascaramento nao distingue autor NENHUM — ela e
// justamente o que o modelo mais imita. As duas camadas do conserto de hoje foram vetadas por
// ela ao mesmo tempo, e o turno terminou com "me manda de novo com a senha real".
//
// O discriminador CERTO de autoria e `_credenciaisNoTurno`, no engine: todo bloco que reescreve
// `reply` com texto do proprio engine (two-pass de leitura ~11317, CredencialConfirm ~11636,
// executor ~11777/11785) liga essa flag antes, e o retry so roda com ela desligada. Neste
// ponto do pipeline `reply` e SEMPRE fala do modelo.
//
// A defesa contra gravar um valor mascarado nao mora aqui: mora no executor
// (`temValorMascarado`, lib/credencial-action.js), que e por onde as duas camadas passam.
// ---------------------------------------------------------------------------

function _contaRotulos(texto) {
  const re = new RegExp(ROTULO_QUALQUER.source, 'gimu');
  let n = 0;
  while (re.exec(texto) !== null) { n += 1; if (n >= 2) break; }
  return n;
}

/**
 * O texto e uma proposta/afirmacao de ESCRITA de credencial?
 * @param {string} texto  resposta do TOM, ou question_text de uma intent
 * @returns {boolean}
 */
function pareceEscritaDeCredencial(texto) {
  if (typeof texto !== 'string') return false;
  const t = texto.trim();
  if (!t) return false;
  if (!VERBO_ESCRITA.test(t)) return false;
  // Um rotulo sensivel basta; senao exige dois rotulos quaisquer, ou a palavra "credencial".
  if (ROTULO_SENSIVEL.test(t)) return true;
  if (PALAVRA_CREDENCIAL.test(t) && _contaRotulos(t) >= 1) return true;
  return _contaRotulos(t) >= 2;
}

module.exports = {
  pareceEscritaDeCredencial,
  VERBO_ESCRITA,
  ROTULO_QUALQUER,
  ROTULO_SENSIVEL,
  PALAVRA_CREDENCIAL,
};

'use strict';
// src/lib/claim-entrega.js
// GOVAGENT-CLAIM-ENTREGA-SEM-PROVA — gate de VERBO DE ENTREGA no relatório de governança.
//
// O INCIDENTE: em 10/08 o relatório do agente afirmou que o Rafinha **recebeu** o recado.
// No banco, `read_at` e `recipient_message_id` estavam nulos — havia registro de ENVIO e
// nenhum de entrega. A auditoria cruzada pegou; nenhuma linha de código pegava.
//
// POR QUE UM GATE DE VERBO, E NÃO CONFERÊNCIA CASO A CASO: a trava de número (afirmado ×
// fonte) não alcança isto — "recebeu" não é número, é verbo. E conferir entrega de cada
// mensagem citada em prosa livre exigiria resolver quem é "o Rafinha" e qual recado, no
// texto. O caminho barato e certo é o mesmo que o TOM já usa para não mentir sobre envio:
// **um ponto único na saída, organizado por verbo**.
//
// A POLÍTICA É REBAIXAR, NÃO BLOQUEAR. O agente perde a palavra forte, não o achado. Dizer
// "foi enviado" quando só há prova de envio é a verdade — e é o que ele deveria ter escrito.
//
// LIMITE DELIBERADO: o gate não tenta provar entrega. Ele parte do fato de que, no WhatsApp
// via UAZAPI, confirmação de leitura raramente chega ao banco — então afirmação de
// recebimento é, na prática, sempre não provada. Se um dia houver prova confiável, o lugar
// de consultá-la é aqui, e o gate deixa de rebaixar quando ela existir.

// O eixo é MENSAGEM. Verbo solto não basta: "a conta recebeu o crédito" e "o webhook recebeu
// 43 eventos" não são claims de entrega, e reescrevê-los corromperia o relatório em vez de
// torná-lo honesto. É a lição do `enviad*` que disparou dentro de FATURA — padrão que casa
// com o assunto errado é falso positivo, e falso positivo destrói a confiança na trava.
const OBJETO = '(?:recado|mensagem|aviso|relat[óo]rio|resumo|alerta|notifica[çc][ãa]o|cobran[çc]a|lembrete)';

// A reescrita tem de ser GRAMATICAL com qualquer sujeito. A 1ª versão trocava o verbo por
// "foi enviado" e produzia "o Rafinha foi enviado o recado" — texto quebrado publicado no
// grupo do Alf e do Hugo. "teve o recado enviado" encaixa em toda pessoa e número, e rebaixa
// a afirmação sem inventar prova. Só apareceu rodando contra o literal real do relatório.
const FEMININOS = /^(mensagem|notifica|cobran)/i;
const enviado = (obj) => (FEMININOS.test(obj.trim()) ? 'enviada' : 'enviado');

// `art` captura o artigo para reconstruir a frase sem perdê-lo.
const ALVO = `(o|a|os|as)?\\s*(${OBJETO})`;

const PADROES = [
  // "o Rafinha recebeu o recado" → "o Rafinha teve o recado enviado"
  { re: new RegExp(`\\brecebe(?:u|ram)\\s+${ALVO}`, 'gi'),
    troca: (_m, art, obj) => `teve ${art || 'o'} ${obj} ${enviado(obj)}` },
  // "a Kailane leu a mensagem" → "a Kailane teve a mensagem enviada"
  { re: new RegExp(`\\ble(?:u|ram)\\s+${ALVO}`, 'gi'),
    troca: (_m, art, obj) => `teve ${art || 'a'} ${obj} ${enviado(obj)}` },
  // "visualizou o aviso" → "teve o aviso enviado"
  { re: new RegExp(`\\bvisualiz(?:ou|aram)\\s+${ALVO}`, 'gi'),
    troca: (_m, art, obj) => `teve ${art || 'o'} ${obj} ${enviado(obj)}` },
  // "o recado foi entregue à Rose" → "o recado foi enviado à Rose"
  { re: new RegExp(`\\b(${OBJETO})\\s+foi\\s+entregue`, 'gi'),
    troca: (_m, obj) => `${obj} foi ${enviado(obj)}` },
];

const NOTA = '\n\n_Obs.: só o registro de envio existe no banco — entrega/leitura não confirmada._';

/** Há afirmação de ENTREGA (recebeu/leu/visualizou/foi entregue) sobre uma mensagem? Pura. */
function temClaimDeEntrega(texto) {
  const t = typeof texto === 'string' ? texto : '';
  return PADROES.some((p) => { p.re.lastIndex = 0; return p.re.test(t); });
}

/**
 * Rebaixa afirmações de entrega para envio e anexa a ressalva UMA vez.
 * @param {string} texto
 * @returns {{texto:string, rebaixou:boolean, termos:string[]}}
 */
function rebaixarClaimDeEntrega(texto) {
  if (typeof texto !== 'string' || !texto) return { texto: typeof texto === 'string' ? texto : '', rebaixou: false, termos: [] };
  const termos = [];
  let out = texto;
  for (const p of PADROES) {
    p.re.lastIndex = 0;
    out = out.replace(p.re, (...args) => {
      termos.push(String(args[0]).trim());
      return p.troca(...args);
    });
  }
  if (!termos.length) return { texto, rebaixou: false, termos: [] };
  return { texto: out + NOTA, rebaixou: true, termos };
}

module.exports = { rebaixarClaimDeEntrega, temClaimDeEntrega };

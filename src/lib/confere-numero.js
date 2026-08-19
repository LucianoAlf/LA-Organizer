'use strict';
// src/lib/confere-numero.js
// GOVAGENT-NUMERO-AFIRMADO-SEM-CONFERENCIA — camada 2 da trava anti-vacuidade.
//
// O INCIDENTE: o relatório de 10/08 somou "1 + 9" e escreveu **10**; eram **11**. A trava
// textual não pega isso — ela depende de o agente DECLARAR que não conseguiu ler. O caso
// pior não declara nada: afirma um número errado com total confiança.
//
// A defesa é comparar o número AFIRMADO com o número calculado direto na FONTE.
//
// POLÍTICA: acusar, nunca reescrever. Corrigir o número no texto esconderia que ele errou —
// e é justamente a taxa de erro dele que a gente precisa enxergar para decidir se ele
// continua com a mão no código. O conflito sai escrito no relatório.

// Só contagens. Data, dinheiro, percentual e hora ficam de fora: sem isto, "13/08" vira
// candidato a contagem e a trava passa a comparar dia do mês com número de achados.
const RUIDO = /(?:\d{1,2}\/\d{1,2}|R\$\s*[\d.,]+|\d+\s*%|\d{1,2}\s*h\b|\d{1,2}:\d{2})/gi;

const FORMAS = [
  { chave: 'achados', re: /(\d+)\s+achad[oa]s?\b/gi },
  { chave: 'achados', re: /\bachad[oa]s?:\s*(\d+)/gi },
  { chave: 'corrigidos', re: /(\d+)\s+corrigid[oa]s?\b/gi },
  { chave: 'corrigidos', re: /\bcorrigi\s+(\d+)/gi },
  { chave: 'corrigidos', re: /(\d+)\s+known\s+issues?\b/gi },
  // MEDIDO EM PRODUÇÃO (14/08, 1ª rodada real): o relatório escreve "*1 correção* no ar" e
  // "Correção (1, no ar em 3ca53dc)". Nenhum dos padrões acima casa com "correção" — a trava
  // existia e ficou muda no dia da estreia. Trava que não fala a língua do texto que audita
  // é decoração; só apareceu confrontando o literal do relatório real.
  { chave: 'corrigidos', re: /(\d+)\s+corre[çc][ãa]o|corre[çc][õo]es/gi },
  { chave: 'corrigidos', re: /\bcorre[çc][ãa]o\s*\(\s*(\d+)/gi },
];

// Preposição logo depois da contagem costuma abrir um RECORTE ("65 achados DE frustration"),
// e a única fonte que a trava tem é o TOTAL. Comparar recorte com total é alarme falso
// garantido — foi o 15/08: o 65 estava certo (45 frustration + 21 "não consegui registrar"),
// a fonte tinha 159, e o rodapé cravou "o erro é o dado".
//
// Mas preposição sozinha não decide: "10 achados NO ACERVO" é o total, escrito com preposição.
// O que separa os dois é a palavra REGIDA. Por isso a exceção de totalidade — sem ela a trava
// emudeceria pro claim que ela existe pra pegar (o teste do incidente de 10/08 usa "no
// acervo"), que é o outro jeito de perdê-la. Adjetivo solto ("10 achados abertos") também
// segue conferindo.
const RECORTE = /^\s*(?:de|da|do|das|dos|com|sem|em|na|no|nas|nos)\s+(\p{L}+)/iu;
const TOTALIDADE = /^(?:acervo|total|geral|aberto|abertos|aberta|abertas|banco|fonte|base|backlog)$/i;

function _ehRecorte(resto) {
  const m = RECORTE.exec(resto);
  return !!m && !TOTALIDADE.test(m[1]);
}

// GOVAGENT-CONFERE-ESCOPO-ABERTO (19/08). A lista de preposições acima é NEGATIVA e FECHADA:
// o default era conferir, e só as formas listadas abstinham. Mas o relatório escopa por
// qualquer recurso da prosa — adjetivo ("6 achados ANTIGOS investigados"), parêntese
// ("(23 achados)"), cluster —, enquanto a fonte de `achados` é sempre o acervo GLOBAL. Escopo
// é semântico e aberto; exceção sintática é fechada. Toda forma nova virava alarme falso:
// 15/08 fechou a porta da preposição, 19/08 entrou por outras duas ao mesmo tempo.
//
// Invertido para WHITELIST: `achados` só confere quando o número está ANCORADO em totalidade
// — a única coisa que a fonte sabe medir. Sem âncora, abstém (e a abstenção é devolvida, pra
// não repetir o pecado de 14/08 de a trava emudecer sem ninguém ver).
// `corrigidos` NÃO entra aqui: a fonte dele já é escopada no ciclo, então o default correto
// lá continua sendo conferir, com a blacklist antiga de recorte.
// A âncora pode vir DEPOIS ("10 achados no acervo", "10 achados abertos") ou ANTES, como
// rótulo colado ("Total: 10 achados", "Acervo: 157 achados"). Só o rótulo colado conta: exigir
// que a palavra de totalidade encoste no número é o que separa "Total: 10 achados" de "o maior
// grupo DO ACERVO (23 achados)", onde "acervo" rege outro substantivo e o número é do recorte.
const ANCORA_DEPOIS = /^\s*(?:(?:de|da|do|das|dos|com|sem|em|na|no|nas|nos)\s+)?(\p{L}+)/iu;
const ANCORA_ANTES = /(\p{L}+)\s*:\s*$/iu;

function _temAncoraDeTotalidade(antes, depois) {
  const d = ANCORA_DEPOIS.exec(depois);
  if (d && TOTALIDADE.test(d[1])) return true;
  const a = ANCORA_ANTES.exec(antes);
  return !!a && TOTALIDADE.test(a[1]);
}

/** Decide se a afirmação tem fonte comparável. `achados` exige âncora; `corrigidos` só evita recorte. */
function _confereEsta(chave, antes, depois) {
  if (chave === 'achados') return _temAncoraDeTotalidade(antes, depois);
  return !_ehRecorte(depois);
}

/** Separa as contagens afirmadas em conferíveis e abstidas (sem fonte comparável). Pura. */
function _separarAfirmacoes(texto) {
  const t = typeof texto === 'string' ? texto.replace(RUIDO, ' ') : '';
  const out = [];
  const abstidas = [];
  // Dedup por (chave, n): a mesma afirmação casa em mais de uma forma — "corrigi 2 known
  // issues" bate em `corrigi N` E em `N known issues`. Sem isto, uma divergência sairia
  // repetida no relatório, e aviso repetido ensina a ignorar o aviso.
  const vistos = new Set();
  for (const f of FORMAS) {
    f.re.lastIndex = 0;
    let m;
    while ((m = f.re.exec(t)) !== null) {
      const n = Number(m[1]);
      if (!Number.isFinite(n)) continue;
      const k = `${f.chave}:${n}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      // Subconjunto/recorte: a fonte não sabe medir esse universo — abstém em vez de acusar.
      if (!_confereEsta(f.chave, t.slice(0, m.index), t.slice(m.index + m[0].length))) {
        abstidas.push({ chave: f.chave, n });
        continue;
      }
      out.push({ chave: f.chave, n });
    }
  }
  return { afirmacoes: out, abstidas };
}

/** Extrai as contagens afirmadas CONFERÍVEIS. Pura. @returns {{chave:string,n:number}[]} */
function extrairAfirmacoes(texto) {
  return _separarAfirmacoes(texto).afirmacoes;
}

/**
 * Compara o afirmado com a fonte e anexa o conflito quando divergir.
 *
 * @param {string} texto relatório a publicar
 * @param {Object} fontes contagens reais; `null`/`undefined` = fonte indisponível
 * @returns {{texto:string, divergiu:boolean, conferido:boolean, conflitos:Array}}
 */
function conferirNumerosAfirmados(texto, fontes = {}) {
  if (typeof texto !== 'string' || !texto) {
    return { texto: typeof texto === 'string' ? texto : '', divergiu: false, conferido: false, conflitos: [], abstidas: [] };
  }
  const { afirmacoes, abstidas } = _separarAfirmacoes(texto);
  const conflitos = [];
  let conferido = false;

  for (const a of afirmacoes) {
    const real = fontes ? fontes[a.chave] : undefined;
    // Fonte ausente/indisponível devolve INDEFINIDO, nunca "conferido". Marcar como ok aqui
    // seria a própria doença que esta trava combate.
    if (real == null || !Number.isFinite(real)) continue;
    conferido = true;
    if (real !== a.n) conflitos.push({ chave: a.chave, afirmado: a.n, real });
  }

  if (!conflitos.length) return { texto, divergiu: false, conferido, conflitos: [], abstidas };

  const linhas = conflitos
    .map((c) => `• *${c.chave}*: o texto diz ${c.afirmado}, a fonte tem ${c.real}`)
    .join('\n');
  return {
    texto: `${texto}\n\n⚠️ *Confere não bateu com o banco:*\n${linhas}\n_O número acima não foi corrigido de propósito — o erro é o dado._`,
    divergiu: true,
    conferido: true,
    conflitos,
    abstidas,
  };
}

module.exports = { conferirNumerosAfirmados, extrairAfirmacoes };

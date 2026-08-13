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
];

/** Extrai as contagens afirmadas no texto. Pura. @returns {{chave:string,n:number}[]} */
function extrairAfirmacoes(texto) {
  const t = typeof texto === 'string' ? texto.replace(RUIDO, ' ') : '';
  const out = [];
  for (const f of FORMAS) {
    f.re.lastIndex = 0;
    let m;
    while ((m = f.re.exec(t)) !== null) out.push({ chave: f.chave, n: Number(m[1]) });
  }
  return out;
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
    return { texto: typeof texto === 'string' ? texto : '', divergiu: false, conferido: false, conflitos: [] };
  }
  const afirmacoes = extrairAfirmacoes(texto);
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

  if (!conflitos.length) return { texto, divergiu: false, conferido, conflitos: [] };

  const linhas = conflitos
    .map((c) => `• *${c.chave}*: o texto diz ${c.afirmado}, a fonte tem ${c.real}`)
    .join('\n');
  return {
    texto: `${texto}\n\n⚠️ *Confere não bateu com o banco:*\n${linhas}\n_O número acima não foi corrigido de propósito — o erro é o dado._`,
    divergiu: true,
    conferido: true,
    conflitos,
  };
}

module.exports = { conferirNumerosAfirmados, extrairAfirmacoes };

'use strict';

// #2D2 — CONFAB DE CONTAGEM (falha parcial). Caso Leo 28/06 16:09: usuário disse que o
// "Show de teclas aconteceu nos dias 26 e 27"; o TOM respondeu "Dando baixa na tarefa e
// nos DOIS eventos" mas o marker EVENT_UPDATE persistiu só 1 (ok=1 fail=0) — o 2º evento
// homônimo "Entre Teclas" ficou aberto. É confab de FALHA PARCIAL: a Camada 1 (chokepoint)
// é BINÁRIA (1 marker persistiu → nothingPersisted=false → não dispara) e o
// confab_partial_observations só OBSERVA. Nenhum compara contagem-prosa vs contagem-persistida.
//
// Este guard é PURO e CONSERVADOR (a voz do TOM é sagrada — só age no caso cristalino):
//   - Só dispara quando a prosa tem uma contagem EXPLÍCITA (dígito ou numeral por extenso,
//     ou "ambos/ambas") colada a um substantivo do DOMÍNIO, E essa contagem > o que de fato
//     persistiu, E há um verbo de AÇÃO/conclusão do domínio no turno.
//   - Contagem vaga ("os eventos", "tudo", "todos") → no-op (não dá pra provar exagero).
//   - claimed <= persisted → no-op (não exagerou; ex.: "fechei os 2" com ok=2).
// Ao disparar, REBAIXA o número INLINE (mantém a gramática: "nos dois eventos" → "em 1
// evento") em vez de cortar a cláusula (que deixava "Dei baixa em." quebrado), e anexa uma
// linha honesta única oferecendo acertar o resto.

const NUM = {
  um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

// Formas singular/plural dos substantivos de cada domínio. Só 'event' por ora (caso Leo).
const DOMAIN = {
  event: {
    nouns: [
      { re: /eventos?/i, sing: 'evento', plur: 'eventos' },
      { re: /compromissos?/i, sing: 'compromisso', plur: 'compromissos' },
      { re: /reuni[õo]es|reuni[ãa]o/i, sing: 'reunião', plur: 'reuniões' },
      { re: /shows?/i, sing: 'show', plur: 'shows' },
      { re: /apresenta[çc][õo]es|apresenta[çc][ãa]o/i, sing: 'apresentação', plur: 'apresentações' },
    ],
    nounAlt: '(?:eventos?|compromissos?|reuni[õo]es|reuni[ãa]o|shows?|apresenta[çc][õo]es|apresenta[çc][ãa]o)',
    action: /\b(?:d(?:ei|ando|ar|eu)\s+baixa|baixa\s+(?:em|na|nos|nas)|fech(?:ei|ar|ando|o|ad[oa]s?)|conclu[ií](?:d[oa]s?|í)?|cancel(?:ei|ar|ad[oa]s?|o)|(?:reagend|atualiz|marqu|complet|encerr)\w*)\b/i,
  },
};

// Preposição/artigo de abertura → forma singular (quando persisted===1).
const PREP_SING = { nos: 'em', nas: 'em', aos: 'ao', 'às': 'à', 'as': '', os: '', em: 'em', a: 'a', à: 'à', ao: 'ao' };

const _isDigit = (s) => /^\d+$/.test(s);

// Acha a 1ª contagem explícita de itens do domínio. Retorna {count, phrase, prep, noun} ou null.
function _claimedCount(reply, domain) {
  const d = DOMAIN[domain];
  if (!d) return null;
  const numAlt = Object.keys(NUM).join('|');
  // "N de M <noun>" (ex.: "3 de 4 eventos") já é uma razão HONESTA — não é exagero. Skip.
  const honestRatio = new RegExp(`\\b(?:\\d+|${numAlt})\\s+de\\s+(?:\\d+|${numAlt})\\s+${d.nounAlt}\\b`, 'i');
  if (honestRatio.test(reply)) return null;
  // (prep/artigo opcional) + (dígito|numeral) + substantivo do domínio
  const re = new RegExp(`(\\b(?:os|as|nos|nas|aos|[àa]s|em|[aà]o?)\\s+)?(\\d+|${numAlt})\\s+(${d.nounAlt})\\b`, 'i');
  const m = reply.match(re);
  if (m) {
    const tok = m[2].toLowerCase();
    const n = _isDigit(tok) ? parseInt(tok, 10) : NUM[tok];
    if (Number.isFinite(n)) return { count: n, phrase: m[0], prep: (m[1] || '').trim(), noun: m[3] };
  }
  // "ambos/ambas (os/as) <noun>" = 2 (prep opcional antes)
  const ambos = new RegExp(`(\\b(?:em|[aà]o?|nos|nas)\\s+)?amb[oa]s\\b(?:\\s+(?:os|as))?\\s+(${d.nounAlt})\\b`, 'i');
  const ma = reply.match(ambos);
  if (ma) return { count: 2, phrase: ma[0], prep: (ma[1] || '').trim(), noun: ma[2] };
  return null;
}

// Reconstrói a frase de contagem honesta, mantendo a gramática.
function _rebuild(domain, prepRaw, persisted, nounRaw) {
  const d = DOMAIN[domain];
  const nf = d.nouns.find((x) => x.re.test(nounRaw)) || { sing: nounRaw, plur: nounRaw };
  const noun = persisted === 1 ? nf.sing : nf.plur;
  let prep = (prepRaw || '').toLowerCase();
  if (persisted === 1 && Object.prototype.hasOwnProperty.call(PREP_SING, prep)) prep = PREP_SING[prep];
  const parts = [];
  if (prep) parts.push(prep);
  parts.push(String(persisted), noun);
  return parts.join(' ');
}

// enforceCountHonesty(reply, { domain, persistedCount, meta? })
//   - sem meta: retorna string (reply original ou rebaixado).
//   - meta:true: retorna { reply, fired, claimed, persisted }.
function enforceCountHonesty(reply, opts) {
  const o = opts || {};
  const domain = o.domain;
  const persisted = Number(o.persistedCount);
  const meta = !!o.meta;
  const wrap = (r, fired, claimed) => (meta ? { reply: r, fired, claimed: claimed || null, persisted } : r);

  if (!reply || typeof reply !== 'string') return wrap(reply, false);
  const d = DOMAIN[domain];
  if (!d || !Number.isFinite(persisted) || persisted < 0) return wrap(reply, false);
  // Precisa de verbo de ação do domínio (post-ação) — protege contra contagem informativa.
  if (!d.action.test(reply)) return wrap(reply, false);

  const claim = _claimedCount(reply, domain);
  if (!claim) return wrap(reply, false);
  if (claim.count <= persisted) return wrap(reply, false); // não exagerou

  const honest = _rebuild(domain, claim.prep, persisted, claim.noun);
  const fixed = reply.replace(claim.phrase, honest);
  const note = `_⚠️ Falei em ${claim.count} mas só ${persisted} entrou de verdade — me confirma pra eu acertar o resto._`;
  return wrap(`${fixed}\n\n${note}`, true, claim.count);
}

module.exports = { enforceCountHonesty, _claimedCount };

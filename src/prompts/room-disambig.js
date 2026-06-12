// Resolve a escolha de sala numa resposta curta de desambiguação.
// Quando o TOM oferece "Sala 8 Bateria / Sala 8 Teclas. Qual?" e o usuário
// responde curto ("8 teclas", "teclas", "a segunda", "2"), esta função mapeia
// a resposta de volta pra opção certa — STATELESS no prompt-builder era a raiz
// do bug Rafinha 2026-06-12 (a resposta curta caía no vazio -> "não tenho no contexto").
//
// PURO (sem IO) de propósito: testável offline em test/room-disambig.test.js.

const DIACRITICS = /[̀-ͯ]/g; // marcas de acento combinantes (pós-NFD)

const STOPWORDS = new Set([
  'sala', 'salas', 'de', 'da', 'do', 'a', 'o', 'as', 'os',
  'unidade', 'na', 'no', 'em', 'the', 'kids', // "kids" aparece em muitas salas -> fraco diferenciador
]);

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(DIACRITICS, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roomTokens(nome) {
  return normalize(nome).split(' ').filter(t => t && !STOPWORDS.has(t));
}

// message: texto curto do usuário. options: [{ id, nome, ... }] que o TOM ofereceu.
// Retorna a opção escolhida, ou null se ambíguo / sem sinal suficiente.
function resolveRoomChoice(message, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const msg = normalize(message);
  if (!msg) return null;
  const msgTokens = new Set(msg.split(' ').filter(Boolean));

  const tokensByOpt = options.map(o => roomTokens(o.nome));

  // Tokens compartilhados por TODAS as opções não distinguem (ex.: "8" em
  // "Sala 8 Bateria" e "Sala 8 Teclas") — removê-los evita falso empate.
  let shared = new Set(tokensByOpt[0] || []);
  for (let i = 1; i < tokensByOpt.length; i++) {
    const cur = new Set(tokensByOpt[i]);
    for (const t of [...shared]) if (!cur.has(t)) shared.delete(t);
  }

  // 1) Score por sobreposição de tokens DISTINTIVOS do nome no texto do usuário.
  const scores = options.map((o, i) => {
    const distinctive = tokensByOpt[i].filter(t => !shared.has(t));
    let score = 0;
    for (const t of distinctive) if (msgTokens.has(t)) score++;
    return { o, score };
  });
  const maxScore = Math.max(...scores.map(s => s.score));
  if (maxScore > 0) {
    const winners = scores.filter(s => s.score === maxScore);
    if (winners.length === 1) return winners[0].o;
    return null; // empate entre distintos -> continua ambíguo
  }

  // 2) Ordinal por palavra ("a primeira", "o segundo").
  const ordinals = {
    primeira: 1, primeiro: 1, segunda: 2, segundo: 2, terceira: 3, terceiro: 3,
    quarta: 4, quarto: 4, quinta: 5, quinto: 5,
  };
  for (const [w, n] of Object.entries(ordinals)) {
    if (msgTokens.has(w) && n <= options.length) return options[n - 1];
  }

  // 3) Número isolado que bate o índice 1-based ("2" -> 2ª opção).
  const soNum = /^\s*(\d{1,2})\s*$/.exec(String(message || ''));
  if (soNum) {
    const n = parseInt(soNum[1], 10);
    if (n >= 1 && n <= options.length) return options[n - 1];
  }

  return null;
}

module.exports = { resolveRoomChoice, roomTokens, normalize };

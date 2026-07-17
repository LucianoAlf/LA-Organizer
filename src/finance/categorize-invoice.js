'use strict';
// Cascata de categoria da fatura de cartão (17/07). PURO, sem I/O.
// Precedência: learned (memória do usuário) > rules (merchant-category) > gemini > outros.
// O LLM só preenche o vazio; nunca sobrescreve verdade conhecida. Se o Gemini falhar/vier
// vazio, o resultado é o de hoje (rules/outros) — nunca pior.
//
// Origem: Rose 16-17/07 — "as categorias vieram como outros, n teve sugestão". 30% da fatura
// caía em "outros" (ConectCar 10×, Prezunic, Abastec...). merchant-category tinha 22 regras.
const { categorizeMerchant, stripAcquirer } = require('./merchant-category');

// Sufixos de cidade/UF que a fatura cola no fim do nome SEM espaço (SmartShelvePETROPOLISBR).
// stripAcquirer já baixou pra minúscula e tirou acento.
const CITY_SUFFIX_RE = /(petropolis|riodejaneiro|riodejane|saopaulo|duquedecaxias|niteroi|belohorizonte|curitiba|salvador|brasilia|fortaleza|recife|portoalegre|br|rj|sp|mg|rs|pr|ba|pe|ce|df)+$/;

// merchantKey — chave de AGRUPAMENTO e de MEMÓRIA. É o linchpin: reduz o nome "sujo" da fatura
// ao osso da loja, pra (a) os 10 "MP*CONECTCAR" virarem UMA pergunta e (b) casar a memória
// entre importações. Heurístico: o objetivo é agrupar bem, não ser perfeito.
function merchantKey(descricao) {
  let s = stripAcquirer(descricao);                    // tira MP*/IFD*/PAG*, baixa, sem acento
  s = s.replace(/\(\s*\d+\s*\/\s*\d+\s*\)/g, ' ');      // parcela "(2/3)"
  s = s.replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, ' ');    // parcela "02/03"
  s = s.replace(/[^a-z\s]/g, ' ');                      // dígitos de loja (716), símbolos
  s = s.replace(/\b(ltda|ltd|me|epp|sa|comercio|comerci|servicos|servico|tecnologi)\b/g, ' '); // sufixos jurídicos/genéricos
  s = s.replace(/\s+/g, ' ').trim();
  // cidade GRUDADA no fim (sem espaço): corta o rabo conhecido.
  const noSpace = s.replace(/\s+/g, '');
  const trimmed = noSpace.replace(CITY_SUFFIX_RE, '');
  // se a limpeza de cidade não esvaziou a chave, usa a versão sem cidade; senão mantém.
  return trimmed.length >= 3 ? trimmed : noSpace;
}

// resolveItemCategory — a cascata. learned: Map<merchantKey, slug> (engine lê do banco e injeta).
// validSlugs: Set dos slugs válidos (pfValidSlugs('expense') + custom do user). income nunca casa.
function resolveItemCategory({ descricao, tipo, geminiHint, learned, validSlugs } = {}) {
  if (tipo === 'income') return { slug: 'outros', source: 'fallback' };
  const key = merchantKey(descricao);
  // 1) aprendido pelo usuário — vence tudo
  if (learned && learned.get(key)) return { slug: learned.get(key), source: 'learned' };
  // 2) lista curada (merchant-category)
  const byRule = categorizeMerchant(descricao, tipo);
  if (byRule) return { slug: byRule, source: 'rules' };
  // 3) palpite do Gemini — SÓ se for slug válido e não "outros"
  const hint = String(geminiHint || '').toLowerCase().trim();
  if (hint && hint !== 'outros' && validSlugs && validSlugs.has(hint)) {
    return { slug: hint, source: 'gemini' };
  }
  // 4) fallback
  return { slug: 'outros', source: 'fallback' };
}

// groupUnknowns — agrupa o que ficou gemini/fallback por merchantKey. Ordena por count DESC
// (a pergunta que resolve MAIS itens vem primeiro), total DESC como desempate. Teto 3.
// count e NÃO valor (achado 17/07): por valor, ConectCar (10×, R$135) cairia atrás de
// LUCASDONAS (1×, R$500) e nunca seria perguntado — escondendo a dor real da Rose.
function groupUnknowns(itens) {
  const map = new Map();
  for (const it of (itens || [])) {
    if (it._catSource !== 'fallback' && it._catSource !== 'gemini') continue;
    const key = merchantKey(it.descricao);
    if (!key) continue;
    const g = map.get(key) || { merchantKey: key, label: it.descricao, count: 0, total: 0, sugestao: it.categoria };
    g.count += 1;
    g.total += Number(it.valor) || 0;
    map.set(key, g);
  }
  return [...map.values()]
    .sort((a, b) => (b.count - a.count) || (b.total - a.total))
    .slice(0, 3);
}

// Sinônimos PT → slug canônico. A pessoa fala "pedágio", não "transporte". Só os casos que
// a fala real usa; slug canônico digitado direto ("transporte") também casa (está no Set).
const SYNONYMS = {
  pedagio: 'transporte', pedágio: 'transporte', onibus: 'transporte', metro: 'transporte', uber: 'transporte',
  gasolina: 'combustivel', posto: 'combustivel', combustivel: 'combustivel',
  supermercado: 'mercado', feira: 'mercado', hortifruti: 'mercado',
  remedio: 'farmacia', remedios: 'farmacia', farmacia: 'farmacia',
  restaurante: 'restaurante', comida: 'alimentacao', lanche: 'alimentacao', ifood: 'alimentacao',
  estacionamento: 'estacionamento', parking: 'estacionamento',
  roupa: 'vestuario', roupas: 'vestuario',
  presente: 'presentes', presentes: 'presentes',
  luz: 'contas_consumo', agua: 'contas_consumo', internet: 'contas_consumo', telefone: 'contas_consumo',
};

function _labelToSlug(raw, validSlugs) {
  const k = String(raw || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_').trim();
  if (validSlugs && validSlugs.has(k)) return k;      // slug canônico digitado direto
  const syn = SYNONYMS[k] || SYNONYMS[String(raw || '').toLowerCase().trim()];
  if (syn && (!validSlugs || validSlugs.has(syn))) return syn;
  return null;
}

// detectCategoryCorrections(text, unknowns, itens, validSlugs) -> [{ merchantKey, slug }]
// Formas: "1 é pedágio" / "o 1 é transporte" (número = índice 1-based do bloco unknowns) OU
// "ConectCar é transporte" (nome da loja). Aceita várias na mesma msg (vírgula/e/quebra).
// Só correção EXPLÍCITA com verbo "é/eh/e/=". Sem match → [] (o fluxo segue pro commit/cancel).
function detectCategoryCorrections(text, unknowns, itens, validSlugs) {
  const t = String(text || '').trim();
  if (!t) return [];
  const out = [];
  const seen = new Set();
  const push = (mk, slug) => { if (mk && slug && !seen.has(mk)) { seen.add(mk); out.push({ merchantKey: mk, slug }); } };
  const unk = unknowns || [];

  // padrão "<n> é <cat>" — número aponta pro item N do bloco de perguntas
  const RE_NUM = /(?:^|[,;\n]|\be\b)\s*(?:o\s+|a\s+)?(\d{1,2})\s*(?:é|eh|e|=|:)\s*([a-zA-Zà-ú ]+)/gi;
  let m;
  while ((m = RE_NUM.exec(t)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    const slug = _labelToSlug(m[2], validSlugs);
    if (idx >= 0 && idx < unk.length && slug) push(unk[idx].merchantKey, slug);
  }

  // padrão "<loja> é <cat>" — casa o nome contra os unknowns (ou qualquer item da fatura)
  const RE_NAME = /(?:^|[,;\n])\s*([a-zA-Zà-ú*][a-zA-Zà-ú0-9* ]{2,})\s+(?:é|eh)\s+([a-zA-Zà-ú ]+)/gi;
  while ((m = RE_NAME.exec(t)) !== null) {
    if (/^\d/.test(m[1].trim())) continue;             // já tratado pelo RE_NUM
    const slug = _labelToSlug(m[2], validSlugs);
    if (!slug) continue;
    const alvoKey = merchantKey(m[1]);
    // casa contra unknowns primeiro; senão contra qualquer item da fatura
    const naUnk = unk.find((u) => u.merchantKey === alvoKey || (u.merchantKey && u.merchantKey.includes(alvoKey)) || alvoKey.includes(u.merchantKey));
    if (naUnk) { push(naUnk.merchantKey, slug); continue; }
    const naFat = (itens || []).find((it) => merchantKey(it.descricao) === alvoKey);
    if (naFat) push(alvoKey, slug);
  }
  return out;
}

module.exports = { merchantKey, resolveItemCategory, groupUnknowns, detectCategoryCorrections };

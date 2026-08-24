'use strict';

// INVENTORY-BULK-ADD (Leo 18/06, finding 29b8751b) — o LLM lota N itens numa ação só
// (action:"bulk_add", ou add_item/adicionar com um array items[]/itens[]). O handler do engine
// só sabia 1 item por marker → o lote inteiro caía (90 itens do Leo nunca entraram). Este módulo
// é PURO (sem I/O): detecta a forma de lote e normaliza os itens, herdando sala/unidade
// compartilhadas. O loop de insert + a resolução de sala/unidade ficam no engine (fonte da verdade).
//
// Postel / liberal no que aceita: a skill que ensina o formato ao LLM é INTOCÁVEL (veto Alf),
// então o engine tem que tolerar as variações que o modelo emite (items|itens|lista, item|name,
// quantity|qtd, condition|estado, strings soltas, etc.).

// aliases de CAMPO por item (o LLM inventa item_name, quantity, condition…)
const ITEM_FIELD_ALIASES = {
  item_name: 'nome', itemname: 'nome', item: 'nome', name: 'nome', produto: 'nome',
  descricao_item: 'nome', titulo: 'nome',
  quantity: 'quantidade', qty: 'quantidade', qtd: 'quantidade',
  condition: 'condicao', estado: 'condicao',
  category: 'categoria',
  brand: 'marca', model: 'modelo',
  serial_number: 'numero_serie', serial: 'numero_serie', serialnumber: 'numero_serie',
  heritage_code: 'codigo_patrimonio', patrimony_code: 'codigo_patrimonio', patrimonio: 'codigo_patrimonio',
  notes: 'observacoes', observations: 'observacoes', obs: 'observacoes',
  purchase_value: 'valor_compra', price: 'valor_compra', valor: 'valor_compra',
  // sala por-item (permite lote com salas mistas; senão herda a compartilhada)
  room: 'sala_nome', sala: 'sala_nome', location: 'sala_nome', room_name: 'sala_nome',
};

const VALID_CONDICOES = ['novo', 'bom', 'regular', 'ruim'];
const BULK_ACTIONS = /^(?:bulk_add|add_items|add_bulk|bulk|adicionar_lote|cadastrar_lote)$/i;

function _pickItemsArray(src) {
  if (!src || typeof src !== 'object') return null;
  for (const k of ['items', 'itens', 'lista', 'list', 'produtos']) {
    if (Array.isArray(src[k])) return src[k];
  }
  return null;
}

// É forma de lote? bulk_add (sempre), ou qualquer ação de criar com um array de itens.
function isBulkAdd(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const action = String(payload.action || '').toLowerCase();
  const p = (payload.params && typeof payload.params === 'object') ? payload.params : payload;
  const arr = _pickItemsArray(p) || _pickItemsArray(payload);
  if (BULK_ACTIONS.test(action)) return true;         // bulk_add explícito, mesmo com 1 item
  if (arr && arr.length > 0) return true;             // add_item/create com array
  return false;
}

function _normItem(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {                      // "Pandeiro pequeno" → {nome}
    const nome = raw.trim();
    return nome ? { nome, quantidade: 1, condicao: 'bom' } : null;
  }
  if (typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const target = ITEM_FIELD_ALIASES[String(k).toLowerCase()] || String(k).toLowerCase();
    if (out[target] === undefined) out[target] = v;
  }
  if (!out.nome || String(out.nome).trim().length < 1) return null;
  out.nome = String(out.nome).trim();
  const q = parseInt(out.quantidade, 10);
  out.quantidade = Number.isInteger(q) && q > 0 ? q : 1;
  const c = String(out.condicao || '').toLowerCase();
  out.condicao = VALID_CONDICOES.includes(c) ? c : 'bom';
  return out;
}

/**
 * Extrai o lote normalizado + o escopo (sala/unidade) compartilhado.
 * @param {object} payload  o payload do marker (já com params, se houver)
 * @returns {null | {items:object[], dropped:number, salaShared:string|null, salaIdShared:any,
 *                    unidadeShared:string|null, unidadeIdShared:any}}
 */
function parseBulkAdd(payload) {
  if (!isBulkAdd(payload)) return null;
  const p = (payload.params && typeof payload.params === 'object') ? payload.params : payload;
  const rawArr = _pickItemsArray(p) || _pickItemsArray(payload) || [];
  const items = [];
  let dropped = 0;
  for (const raw of rawArr) {
    const it = _normItem(raw);
    if (it) items.push(it); else dropped++;
  }
  return {
    items,
    dropped,
    salaShared: p.sala_nome || p.sala || p.room || p.location || null,
    salaIdShared: p.sala_id || null,
    unidadeShared: p.unidade_nome || p.unidade || p.unit || null,
    unidadeIdShared: p.unidade_id || null,
  };
}

module.exports = { isBulkAdd, parseBulkAdd, BULK_ACTIONS };

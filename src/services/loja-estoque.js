'use strict';

// INVENTORY-ESTOQUE-BAIXO-FALSE-ALARM (Leo audit 24/08) — o alerta semanal chamava
// listarEstoqueBaixo() SEM unidade; em listarLojaPorUnidade o fetch de estoque era gateado por
// `if (ids.length && unidadeId)` → com unidadeId ausente o bloco era pulado → estoqueMap vazio →
// TODO produto saía com estoque_atual=0 / zerado=true / abaixo_minimo=true. Falso-alarme total
// (regra: alarme falso destrói o sinal). Este módulo é PURO e concentra a agregação + a regra de
// status; listarLojaPorUnidade passa a buscar o estoque SEMPRE (somando as unidades quando nenhuma
// é dada) e delega aqui. Comportamento por-unidade é idêntico ao anterior (zero-regressão).

// Soma quantidade por produto_id (uma ou várias unidades) → Map<produto_id, total>.
function agregarEstoque(estoqueRows) {
  const map = new Map();
  for (const e of estoqueRows || []) {
    if (!e || e.produto_id == null) continue;
    const q = Number(e.quantidade);
    map.set(e.produto_id, (map.get(e.produto_id) || 0) + (Number.isFinite(q) ? q : 0));
  }
  return map;
}

// Regra de status de um produto dado o total em estoque (idêntica ao inline antigo).
function enriquecerProduto(produto, estoqueMap) {
  const qtd = estoqueMap.get(produto.id) || 0;
  return {
    ...produto,
    estoque_atual: qtd,
    abaixo_minimo: produto.estoque_minimo > 0 && qtd < produto.estoque_minimo,
    zerado: qtd === 0,
  };
}

function enriquecerProdutos(produtos, estoqueRows) {
  const map = agregarEstoque(estoqueRows);
  return (produtos || []).map(p => enriquecerProduto(p, map));
}

module.exports = { agregarEstoque, enriquecerProduto, enriquecerProdutos };

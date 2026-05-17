const VALID_ACTIONS = ['add_item', 'move_item', 'maintenance', 'shop_movement', 'query_room', 'query_shop', 'query_rooms'];
const VALID_CATEGORIAS = ['instrumento', 'eletronico', 'mobilia', 'consumivel', 'outros'];
const VALID_CONDICOES = ['novo', 'bom', 'regular', 'ruim'];
const VALID_STATUS = ['ativo', 'manutencao', 'baixa', 'inativo'];
const VALID_MOV_TIPOS = ['entrada', 'saida', 'transferencia', 'baixa', 'manutencao'];

function validateAction(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['payload_invalido'] };
  }
  if (!VALID_ACTIONS.includes(payload.action)) {
    errors.push(`action_invalida: ${payload.action}`);
  }
  if (!payload.params || typeof payload.params !== 'object') {
    errors.push('params_ausente');
  }
  return { ok: errors.length === 0, errors };
}

function validateAddItem(p) {
  const errors = [];
  if (!p.nome || typeof p.nome !== 'string' || p.nome.trim().length < 3) errors.push('nome_invalido');
  if (!p.sala_id && !p.sala_nome) errors.push('sala_obrigatoria');
  if (!p.unidade_id && !p.unidade_nome) errors.push('unidade_obrigatoria');
  // categoria: aceita texto livre (LA Report usa "Áudio", "Climatização", "Teclados/Piano", etc — não enum)
  if (p.condicao && !VALID_CONDICOES.includes(p.condicao)) errors.push(`condicao_invalida: ${p.condicao}`);
  if (p.quantidade !== undefined && (!Number.isInteger(p.quantidade) || p.quantidade < 1)) errors.push('quantidade_invalida');
  if (p.valor_compra !== undefined && (typeof p.valor_compra !== 'number' || p.valor_compra < 0)) errors.push('valor_compra_invalido');
  return { ok: errors.length === 0, errors };
}

function validateMoveItem(p) {
  const errors = [];
  if (!p.item_id && !p.item_nome) errors.push('item_obrigatorio');
  if (!VALID_MOV_TIPOS.includes(p.tipo)) errors.push(`tipo_invalido: ${p.tipo}`);
  if (p.tipo === 'transferencia' && !p.sala_destino_id && !p.sala_destino_nome) errors.push('destino_obrigatorio_para_transferencia');
  return { ok: errors.length === 0, errors };
}

function validateMaintenance(p) {
  const errors = [];
  if (!p.item_id && !p.item_nome) errors.push('item_obrigatorio');
  if (!p.descricao || p.descricao.trim().length < 5) errors.push('descricao_obrigatoria');
  return { ok: errors.length === 0, errors };
}

function validateShopMovement(p) {
  const errors = [];
  if (!p.produto_id && !p.produto_nome) errors.push('produto_obrigatorio');
  if (!p.unidade_id && !p.unidade_nome) errors.push('unidade_obrigatoria');
  if (!Number.isInteger(p.quantidade) || p.quantidade === 0) errors.push('quantidade_invalida');
  if (!['entrada', 'saida'].includes(p.tipo)) errors.push(`tipo_invalido: ${p.tipo}`);
  return { ok: errors.length === 0, errors };
}

module.exports = {
  VALID_ACTIONS, VALID_CATEGORIAS, VALID_CONDICOES, VALID_STATUS, VALID_MOV_TIPOS,
  validateAction, validateAddItem, validateMoveItem, validateMaintenance, validateShopMovement,
};

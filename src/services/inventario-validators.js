const VALID_ACTIONS = ['add_item', 'edit_item', 'delete_item', 'move_item', 'maintenance', 'shop_movement', 'ver', 'query_room', 'query_shop', 'query_rooms'];
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
  // Mínimo absoluto: precisa de nome e de alguma forma de identificar a sala.
  // TODO o resto tem default no engine. Sem mais "campo X inválido".
  if (!p || typeof p !== 'object') return { ok: false, errors: ['params_ausente'] };
  if (!p.nome || typeof p.nome !== 'string' || p.nome.trim().length < 1) {
    return { ok: false, errors: ['nome obrigatório'] };
  }
  if (!p.sala_id && !p.sala_nome) return { ok: false, errors: ['sala obrigatória'] };
  return { ok: true, errors: [] };
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

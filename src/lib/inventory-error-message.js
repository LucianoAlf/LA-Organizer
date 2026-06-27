'use strict';

// INVENTORY-RAW-ERROR-LEAK (27/06) — traduz os códigos crus do inventario-validators.js
// numa mensagem na VOZ do TOM, em vez de despejar jargão de validador no WhatsApp
// ("Pedido inválido: action_invalida: upsert_room", "Faltam dados: descricao_obrigatoria").
// Caso Dai 26/06: sessão de inventário sob fallback Codex (Claude timeout 11×) — o modelo
// inventou action="upsert_room" (não existe em VALID_ACTIONS) e omitiu nome → erro cru vazou.
// A VOZ do TOM é sagrada: o wording final é decisão do Alf; o mecanismo (amigável, não cru)
// é o que importa aqui.

const GENERIC = 'Não consegui registrar isso no inventário agora. Me manda de novo com os detalhes (item, quantidade e sala)?';

// código (parte ANTES do ':') → mensagem amigável. O validador MISTURA snake_case
// (item_obrigatorio), frases acentuadas (nome obrigatório) e sufixos ": valor"
// (action_invalida: upsert_room) — por isso casamos pelo prefixo antes do ':'.
const MAP = {
  action_invalida: 'Não entendi a ação no inventário. Me diz o que você quer (cadastrar item, mover de sala, dar baixa ou registrar manutenção) que eu faço.',
  params_ausente: GENERIC,
  payload_invalido: GENERIC,
  'nome obrigatório': 'Faltou o nome do item. Qual é o item?',
  'sala obrigatória': 'Faltou a sala. Em qual sala e unidade fica?',
  item_obrigatorio: 'Faltou dizer qual item. Qual é?',
  sala_destino_obrigatoria: 'Faltou a sala de destino. Pra onde vai?',
  descricao_obrigatoria: 'Faltou a descrição da manutenção. O que precisa ser feito?',
  produto_obrigatorio: 'Faltou o produto da lojinha. Qual é?',
  unidade_obrigatoria: 'Faltou a unidade. Qual unidade (Barra/Recreio/CG)?',
  quantidade_invalida: 'A quantidade não ficou clara. Quantas unidades?',
  tipo_invalido: 'O tipo de movimento não ficou claro — é entrada ou saída?',
};

function friendlyInventoryError(errors) {
  const list = Array.isArray(errors)
    ? errors
    : (errors == null || errors === '' ? [] : [errors]);
  const msgs = [];
  for (const raw of list) {
    const code = String(raw).split(':')[0].trim();
    const msg = MAP[code] || GENERIC;
    if (!msgs.includes(msg)) msgs.push(msg);
  }
  return msgs.length ? msgs.join('\n') : GENERIC;
}

module.exports = { friendlyInventoryError };

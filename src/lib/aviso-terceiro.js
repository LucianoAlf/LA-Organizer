'use strict';
// src/lib/aviso-terceiro.js — AVISO-A-TERCEIRO-FORA-DO-HISTORICO (Rafinha 02/10).
// Grava no histórico de QUEM RECEBE o aviso que o TOM mandou a pedido de outra pessoa (aprovação,
// rejeição, prazo remarcado). Sem isso o TOM de quem recebe não sabe do aviso e age às cegas.
// Dependências injetadas: log(id, 'outbound', texto) e idPorTelefone(tel) → id|null.
// Nunca lança: o aviso já saiu; falha de gravação só vai pro log. Devolve true se gravou.
async function registrarAviso({ log, idPorTelefone } = {}, { collaboratorId, content, phone } = {}) {
  if (!content || typeof log !== 'function') return false;
  let id = collaboratorId || null;
  if (!id && phone && typeof idPorTelefone === 'function') {
    try { id = await idPorTelefone(phone); } catch (_) { id = null; }
  }
  if (!id) { console.warn('[AvisoTerceiro] destinatário sem cadastro — aviso fora do histórico'); return false; }
  try { await log(id, 'outbound', content); return true; } catch (e) {
    console.warn('[AvisoTerceiro] gravar no histórico falhou (aviso já enviado):', e.message);
    return false;
  }
}
module.exports = { registrarAviso };

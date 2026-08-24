// src/rituals/inventario-alertas.js
// Cron semanal de alertas operacionais — estoque baixo + itens em manutenção + revisões próximas.
// Lê do LA Report e ENTREGA por WhatsApp (via sendProativo, com quiet-gate).
//
// INVENTORY-ALERT-DEAD-DELIVERY (audit 24/08): antes inseria em `notifications` com schema errado
// (`kind`/`active` — colunas inexistentes) e, pior, NADA consumia essa fila pra entregar → os
// alertas NUNCA chegaram a ninguém. Agora envia direto pelo chokepoint proativo (sendProativo,
// que embute o silêncio), com destinatário resolvido (Rafinha; fallback director) e log quando
// falta destinatário (nunca silencioso).

const inventarioService = require('../services/inventario-service');
const supabase = require('../supabase/client');
const { sendProativo } = require('../services/send-proativo');
const { fmtEstoqueBaixo, fmtItensManutencao, fmtRevisoes } = require('./inventario-alertas-format');

// Destinatário dos alertas: Rafinha (gestão de loja/inventário). Fallback: 1º director ativo.
// NUNCA silencioso — loga quando não acha ninguém com telefone.
async function resolveDestinatario() {
  const { data: r, error: er } = await supabase
    .from('collaborators').select('id, full_name, phone')
    .ilike('full_name', '%rafinha%').eq('is_active', true).limit(1).maybeSingle();
  if (er) console.warn('[inventario-alertas] erro buscando rafinha:', er.message);
  if (r && r.id && r.phone) return r;
  console.warn('[inventario-alertas] Rafinha não encontrada/sem telefone — fallback pro director');
  const { data: dir } = await supabase
    .from('collaborators').select('id, full_name, phone')
    .eq('role', 'director').eq('is_active', true).order('full_name').limit(1).maybeSingle();
  if (dir && dir.id && dir.phone) return dir;
  console.error('[inventario-alertas] NENHUM destinatário (Rafinha/director) com telefone — alerta não enviado');
  return null;
}

async function enviarAlerta(dest, corpo, label) {
  if (!corpo) return; // nada a alertar → silêncio correto
  if (!dest) return;  // já logado em resolveDestinatario
  const r = await sendProativo(dest.id, dest.phone, corpo, { context: 'work', label: `inv:${label}` });
  if (r.enviado) console.log(`[inventario-alertas] ${label} → ${dest.full_name}`);
  else if (!r.deferido) console.warn(`[inventario-alertas] ${label} NÃO enviado: ${r.motivo}`);
}

async function runInventarioEstoqueBaixo() {
  const corpo = fmtEstoqueBaixo(await inventarioService.listarEstoqueBaixo());
  if (!corpo) return;
  await enviarAlerta(await resolveDestinatario(), corpo, 'estoque_baixo');
}

async function runInventarioManutencoesPendentes() {
  const corpo = fmtItensManutencao(await inventarioService.listarItensEmManutencao(14), Date.now());
  if (!corpo) return;
  await enviarAlerta(await resolveDestinatario(), corpo, 'manutencao');
}

async function runInventarioRevisoesProgramadas() {
  const corpo = fmtRevisoes(await inventarioService.listarRevisoesProgramadas(7));
  if (!corpo) return;
  await enviarAlerta(await resolveDestinatario(), corpo, 'revisoes');
}

module.exports = {
  runInventarioEstoqueBaixo,
  runInventarioManutencoesPendentes,
  runInventarioRevisoesProgramadas,
  resolveDestinatario,
};

// src/rituals/inventario-alertas.js
// Cron semanal de alertas operacionais — estoque baixo + manutenções pendentes + revisões próximas.
// Lê do LA Report e enfileira em la_organizer.notifications.

const inventarioService = require('../services/inventario-service');
const supabase = require('../supabase/client');

async function rafinhaId() {
  const { data } = await supabase
    .from('collaborators').select('id').ilike('full_name', '%rafinha%').eq('active', true).maybeSingle();
  return data ? data.id : null;
}

async function enfileirarNotificacao(collaboratorId, titulo, corpo) {
  if (!collaboratorId) return;
  await supabase.from('notifications').insert({
    collaborator_id: collaboratorId,
    title: titulo,
    body: corpo,
    kind: 'inventario_alerta',
    created_at: new Date().toISOString(),
  });
}

async function runInventarioEstoqueBaixo() {
  const baixos = await inventarioService.listarEstoqueBaixo();
  if (baixos.length === 0) return;
  const rafinha = await rafinhaId();
  const linhas = baixos.map(p => `• ${p.nome}: ${p.estoque_atual}/${p.estoque_minimo}`);
  const corpo = `🔴 *Estoque baixo* (${baixos.length} produto${baixos.length > 1 ? 's' : ''}):\n\n${linhas.join('\n')}\n\nPra encomendar: /loja encomenda`;
  await enfileirarNotificacao(rafinha, 'Estoque baixo', corpo);
}

async function runInventarioManutencoesPendentes() {
  const pendentes = await inventarioService.listarManutencoesPendentes(14);
  if (pendentes.length === 0) return;
  const rafinha = await rafinhaId();
  const linhas = pendentes.map(m => {
    const dias = Math.floor((Date.now() - new Date(m.data_manutencao).getTime()) / 86400000);
    const nome = (m.inventario && m.inventario.nome) || `Item ${m.item_id}`;
    return `• ${nome} — ${dias}d (${m.tipo})`;
  });
  const corpo = `🔧 *Manutenções pendentes +14d* (${pendentes.length}):\n\n${linhas.join('\n')}`;
  await enfileirarNotificacao(rafinha, 'Manutenções pendentes', corpo);
}

async function runInventarioRevisoesProgramadas() {
  const revisoes = await inventarioService.listarRevisoesProgramadas(7);
  if (revisoes.length === 0) return;
  const rafinha = await rafinhaId();
  const linhas = revisoes.map(i => {
    const data = i.proxima_revisao ? new Date(i.proxima_revisao).toLocaleDateString('pt-BR') : '?';
    return `• ${i.nome} — ${data}`;
  });
  const corpo = `🗓 *Revisões programadas (próximos 7d)* (${revisoes.length}):\n\n${linhas.join('\n')}`;
  await enfileirarNotificacao(rafinha, 'Revisões programadas', corpo);
}

module.exports = {
  runInventarioEstoqueBaixo,
  runInventarioManutencoesPendentes,
  runInventarioRevisoesProgramadas,
};

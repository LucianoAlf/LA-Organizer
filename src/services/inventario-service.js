const { laReportClient } = require('./la-report-client');
const { checkAccess } = require('./la-report-access');
const { enriquecerProdutos } = require('./loja-estoque');
const { selecionarItensParados } = require('./inventario-manutencao');

function gate(collab, dataType, fnName) {
  const access = checkAccess(collab, dataType);
  if (!access.allowed) {
    const err = new Error(access.reason);
    err.code = 'ACCESS_DENIED';
    err.fn = fnName;
    throw err;
  }
  return access;
}

function viaTomLabel(nome) {
  return `via TOM por ${nome || 'usuário desconhecido'}`;
}

function withViaTom(observacoes, nome) {
  const tag = viaTomLabel(nome);
  if (!observacoes) return tag;
  return `${tag} — ${observacoes}`;
}

// ─── LEITURA ─────────────────────────────────────────────────

async function listarUnidades() {
  const { data, error } = await laReportClient
    .from('unidades').select('id, nome').order('nome');
  if (error) throw error;
  return data || [];
}

async function listarSalasPorUnidade(unidadeId) {
  const { data, error } = await laReportClient
    .from('salas')
    .select('id, nome, tipo_sala, capacidade_maxima, codigo, ativo')
    .eq('unidade_id', unidadeId)
    .eq('ativo', true)
    .order('nome');
  if (error) throw error;
  const ids = (data || []).map(s => s.id);
  if (ids.length === 0) return [];
  const { data: counts } = await laReportClient
    .from('inventario')
    .select('sala_id', { count: 'exact', head: false })
    .in('sala_id', ids);
  const countMap = new Map();
  for (const row of counts || []) {
    countMap.set(row.sala_id, (countMap.get(row.sala_id) || 0) + 1);
  }
  return (data || []).map(s => ({ ...s, itens_count: countMap.get(s.id) || 0 }));
}

async function buscarSalaPorNome(nome, unidadeId) {
  let query = laReportClient
    .from('salas')
    .select('id, nome, tipo_sala, unidade_id, ativo, unidades(nome)')
    .ilike('nome', `%${nome}%`)
    .eq('ativo', true);
  if (unidadeId) query = query.eq('unidade_id', unidadeId);
  const { data, error } = await query.limit(5);
  if (error) throw error;
  return data || [];
}

async function detalheSala(salaId, collab) {
  if (collab) {
    const access = gate(collab, 'inventario', 'detalheSala');
    if (access.unitFilter) {
      const { data: sala } = await laReportClient.from('salas').select('unidade_id').eq('id', salaId).single();
      const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
      if (!sala || !units.includes(sala.unidade_id)) {
        const err = new Error('Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.');
        err.code = 'ACCESS_DENIED';
        throw err;
      }
    }
  }
  const [salaRes, itensRes, movRes, manutRes] = await Promise.all([
    laReportClient.from('salas').select('*, unidades(nome)').eq('id', salaId).single(),
    laReportClient.from('inventario').select('*').eq('sala_id', salaId).eq('ativo', true).order('nome'),
    laReportClient.from('inventario_movimentacoes')
      .select('*, inventario(nome, codigo_patrimonio)')
      .or(`sala_origem_id.eq.${salaId},sala_destino_id.eq.${salaId}`)
      .order('data_movimentacao', { ascending: false }).limit(20),
    laReportClient.from('inventario_manutencoes')
      .select('*, inventario(nome, codigo_patrimonio, sala_id)')
      .order('data_manutencao', { ascending: false }).limit(20),
  ]);
  if (salaRes.error) throw salaRes.error;
  const manut = (manutRes.data || []).filter(m => m.inventario?.sala_id === salaId);
  return {
    sala: salaRes.data,
    itens: itensRes.data || [],
    movimentacoes: movRes.data || [],
    manutencoes: manut,
  };
}

async function listarLojaPorUnidade(unidadeId) {
  const { data: produtos, error: e1 } = await laReportClient
    .from('loja_produtos')
    .select('id, nome, sku, preco, custo, estoque_minimo, foto_url, disponivel_whatsapp, ativo, loja_categorias(nome, icone)')
    .eq('ativo', true)
    .order('nome');
  if (e1) throw e1;
  const ids = (produtos || []).map(p => p.id);
  // Busca o estoque SEMPRE (não só quando há unidade). Sem unidade → soma todas as unidades.
  // Gatear por `&& unidadeId` zerava o estoque no alerta semanal (chamado sem unidade) →
  // todo produto saía zerado (INVENTORY-ESTOQUE-BAIXO-FALSE-ALARM). Ver loja-estoque.js.
  let estoqueRows = [];
  if (ids.length) {
    let q = laReportClient.from('loja_estoque').select('produto_id, quantidade').in('produto_id', ids);
    if (unidadeId) q = q.eq('unidade_id', unidadeId);
    const { data: estoque } = await q;
    estoqueRows = estoque || [];
  }
  return enriquecerProdutos(produtos, estoqueRows);
}

async function buscarProdutoPorNome(nome) {
  const { data, error } = await laReportClient
    .from('loja_produtos').select('id, nome, sku, preco, custo, estoque_minimo')
    .ilike('nome', `%${nome}%`).eq('ativo', true).limit(5);
  if (error) throw error;
  return data || [];
}

async function listarEstoqueBaixo(unidadeId) {
  const lista = await listarLojaPorUnidade(unidadeId);
  return lista.filter(p => p.abaixo_minimo || p.zerado);
}

async function listarManutencoesPendentes(diasMin = 14) {
  const cutoffIso = new Date(Date.now() - diasMin * 86400000).toISOString();
  const { data, error } = await laReportClient
    .from('inventario_manutencoes')
    .select('id, item_id, tipo, descricao, data_manutencao, responsavel, custo, inventario(nome, codigo_patrimonio, sala_id, salas(nome, unidade_id, unidades(nome)))')
    .lt('data_manutencao', cutoffIso)
    .order('data_manutencao');
  if (error) throw error;
  return data || [];
}

// INVENTORY-MANUTENCAO-PENDENTE-FALSO (audit 24/08): "pendente" = ITEM preso em status='manutencao'
// (não log de manutenção concluída). Retorna os parados há > diasMin. Ver inventario-manutencao.js.
async function listarItensEmManutencao(diasMin = 14) {
  const { data: itens, error } = await laReportClient
    .from('inventario')
    .select('id, nome, codigo_patrimonio, updated_at, salas(nome, unidade_id, unidades(nome))')
    .eq('status', 'manutencao').eq('ativo', true);
  if (error) throw error;
  if (!itens || !itens.length) return [];
  const ids = itens.map(i => i.id);
  const { data: logs } = await laReportClient
    .from('inventario_manutencoes')
    .select('item_id, data_manutencao, tipo, descricao')
    .in('item_id', ids)
    .order('data_manutencao', { ascending: false });
  return selecionarItensParados(itens, logs || [], { nowMs: Date.now(), diasMin });
}

async function listarRevisoesProgramadas(diasAtePrazo = 7) {
  const ate = new Date(Date.now() + diasAtePrazo * 86400000).toISOString().slice(0, 10);
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await laReportClient
    .from('inventario')
    .select('id, nome, codigo_patrimonio, proxima_revisao, sala_id, salas(nome, unidade_id, unidades(nome))')
    .gte('proxima_revisao', hoje).lte('proxima_revisao', ate)
    .eq('ativo', true).order('proxima_revisao');
  if (error) throw error;
  return data || [];
}

// ─── ESCRITA ─────────────────────────────────────────────────

async function inserirItem(input, viaTomNome) {
  const obs = withViaTom(input.observacoes, viaTomNome);
  const { data, error } = await laReportClient
    .from('inventario')
    .insert({
      nome: input.nome,
      sala_id: input.sala_id,
      unidade_id: input.unidade_id,
      categoria: input.categoria || null,
      marca: input.marca || null,
      modelo: input.modelo || null,
      numero_serie: input.numero_serie || null,
      valor_compra: input.valor_compra ?? null,
      data_compra: input.data_compra || null,
      nota_fiscal: input.nota_fiscal || null,
      fornecedor: input.fornecedor || null,
      codigo_patrimonio: input.codigo_patrimonio || null,
      condicao: input.condicao || 'bom',
      status: input.status || 'ativo',
      quantidade: input.quantidade || 1,
      foto_url: input.foto_url || null,
      observacoes: obs,
      ativo: true,
      created_by: null,  // R1
    })
    .select('id, nome, codigo_patrimonio')
    .single();
  if (error) throw error;
  return data;
}

async function registrarMovimentacao(input, viaTomNome) {
  const obs = withViaTom(input.motivo, viaTomNome);
  const { data, error } = await laReportClient
    .from('inventario_movimentacoes')
    .insert({
      item_id: input.item_id,
      tipo: input.tipo,
      sala_origem_id: input.sala_origem_id || null,
      sala_destino_id: input.sala_destino_id || null,
      motivo: obs,
      data_movimentacao: new Date().toISOString(),
      usuario_id: null,  // R1
    })
    .select('id')
    .single();
  if (error) throw error;
  if (input.tipo === 'transferencia' && input.sala_destino_id) {
    // INVENTORY-MOVE-UNIDADE-ORFA (audit 24/08): mover pra sala de OUTRA unidade atualizava só
    // sala_id → unidade_id ficava velho e o item sumia das contagens/listas que filtram por
    // unidade_id (PWA useInventarioStats). Mantém unidade_id coerente com a sala destino.
    const patch = { sala_id: input.sala_destino_id, updated_at: new Date().toISOString() };
    const { data: salaDest } = await laReportClient
      .from('salas').select('unidade_id').eq('id', input.sala_destino_id).maybeSingle();
    if (salaDest && salaDest.unidade_id) patch.unidade_id = salaDest.unidade_id;
    await laReportClient.from('inventario').update(patch).eq('id', input.item_id);
  }
  return data;
}

async function registrarManutencao(input, viaTomNome) {
  const obs = withViaTom(input.observacoes, viaTomNome);
  const { data, error } = await laReportClient
    .from('inventario_manutencoes')
    .insert({
      item_id: input.item_id,
      tipo: input.tipo || 'corretiva',
      descricao: input.descricao,
      custo: input.custo ?? null,
      data_manutencao: new Date().toISOString().slice(0, 10),
      data_proxima_revisao: input.data_proxima_revisao || null,
      responsavel: input.responsavel || null,
      fornecedor_servico: input.fornecedor_servico || null,
      observacoes: obs,
      created_by: null,  // R1
    })
    .select('id')
    .single();
  if (error) throw error;
  await laReportClient.from('inventario')
    .update({ status: 'manutencao', updated_at: new Date().toISOString() })
    .eq('id', input.item_id);
  return data;
}

async function ajustarEstoqueLoja(input, viaTomNome) {
  const obs = withViaTom(input.motivo || input.nota_fiscal || '', viaTomNome);
  const { data: existing } = await laReportClient
    .from('loja_estoque')
    .select('id, quantidade')
    .eq('produto_id', input.produto_id)
    .eq('unidade_id', input.unidade_id)
    .maybeSingle();

  let saldoApos;
  if (existing) {
    saldoApos = existing.quantidade + input.quantidade;
    if (saldoApos < 0) throw new Error('estoque_insuficiente');
    await laReportClient.from('loja_estoque')
      .update({ quantidade: saldoApos, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    if (input.quantidade < 0) throw new Error('estoque_inexistente_para_saida');
    saldoApos = input.quantidade;
    await laReportClient.from('loja_estoque')
      .insert({ produto_id: input.produto_id, unidade_id: input.unidade_id, quantidade: saldoApos });
  }

  const { data, error } = await laReportClient
    .from('loja_movimentacoes_estoque')
    .insert({
      produto_id: input.produto_id,
      unidade_id: input.unidade_id,
      tipo: input.tipo || (input.quantidade > 0 ? 'entrada' : 'saida'),
      quantidade: Math.abs(input.quantidade),
      saldo_apos: saldoApos,
      observacoes: obs,
      colaborador_id: null,  // R1
    })
    .select('id')
    .single();
  if (error) throw error;
  return { saldo_apos: saldoApos, mov_id: data.id };
}

async function uploadFotoItem(itemId, buffer, contentType) {
  const path = `${itemId}/${Date.now()}.jpg`;
  const { error } = await laReportClient.storage
    .from('inventario-fotos')
    .upload(path, buffer, { contentType: contentType || 'image/jpeg', upsert: false });
  if (error) throw error;
  const { data: pub } = laReportClient.storage.from('inventario-fotos').getPublicUrl(path);
  await laReportClient.from('inventario')
    .update({ foto_url: pub.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', itemId);
  return pub.publicUrl;
}

async function buscarItemPorNome(nome, unidadeId, collab) {
  if (collab) {
    const access = gate(collab, 'inventario', 'buscarItemPorNome');
    if (access.unitFilter && !unidadeId) {
      unidadeId = Array.isArray(access.unitFilter) ? null : access.unitFilter;
    }
  }
  let q = laReportClient
    .from('inventario')
    .select('*, salas(nome, unidade_id, unidades(nome))')
    .ilike('nome', `%${nome}%`)
    .eq('ativo', true)
    .limit(5);
  if (unidadeId) q = q.eq('unidade_id', unidadeId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

module.exports = {
  viaTomLabel, withViaTom,
  // leitura
  listarUnidades, listarSalasPorUnidade, buscarSalaPorNome, detalheSala,
  buscarItemPorNome,
  listarLojaPorUnidade, buscarProdutoPorNome,
  listarEstoqueBaixo, listarManutencoesPendentes, listarItensEmManutencao, listarRevisoesProgramadas,
  // escrita
  inserirItem, registrarMovimentacao, registrarManutencao,
  ajustarEstoqueLoja, uploadFotoItem,
};

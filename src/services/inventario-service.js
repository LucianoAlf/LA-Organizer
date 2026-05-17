const { laReportClient } = require('./la-report-client');

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
    .select('id, nome, tipo_sala, unidade_id, ativo')
    .ilike('nome', `%${nome}%`)
    .eq('ativo', true);
  if (unidadeId) query = query.eq('unidade_id', unidadeId);
  const { data, error } = await query.limit(5);
  if (error) throw error;
  return data || [];
}

async function detalheSala(salaId) {
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
  let estoqueMap = new Map();
  if (ids.length && unidadeId) {
    const { data: estoque } = await laReportClient
      .from('loja_estoque')
      .select('produto_id, quantidade')
      .eq('unidade_id', unidadeId)
      .in('produto_id', ids);
    for (const e of estoque || []) {
      estoqueMap.set(e.produto_id, (estoqueMap.get(e.produto_id) || 0) + e.quantidade);
    }
  }
  return (produtos || []).map(p => {
    const qtd = estoqueMap.get(p.id) || 0;
    return {
      ...p,
      estoque_atual: qtd,
      abaixo_minimo: p.estoque_minimo > 0 && qtd < p.estoque_minimo,
      zerado: qtd === 0,
    };
  });
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
    await laReportClient.from('inventario')
      .update({ sala_id: input.sala_destino_id, updated_at: new Date().toISOString() })
      .eq('id', input.item_id);
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

module.exports = {
  viaTomLabel, withViaTom,
  // leitura
  listarUnidades, listarSalasPorUnidade, buscarSalaPorNome, detalheSala,
  listarLojaPorUnidade, buscarProdutoPorNome,
  listarEstoqueBaixo, listarManutencoesPendentes, listarRevisoesProgramadas,
  // escrita
  inserirItem, registrarMovimentacao, registrarManutencao,
  ajustarEstoqueLoja, uploadFotoItem,
};

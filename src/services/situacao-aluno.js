'use strict';
// situacao-aluno.js — a situação operacional do aluno vinda do LA Report.
//
// ARQUITETURA (decisão do Alf, 02/09): NADA de regex pra rotear. A LLM INTERPRETA o que foi
// pedido e emite o marker; o CÓDIGO executa a RPC canônica e escreve os números. Mesmo padrão
// já provado do <<GROUP_REPORT>>: "você só dá UMA linha curta de abertura, o sistema monta com
// dados EXATOS do banco".
//
// POR QUE O RENDERIZADOR É QUEM LÊ, e não o prompt: as pegadinhas do contrato
// (`consultar-situacao-aluno-la`) viram CÓDIGO aqui. `na_comunidade_wa=null` sai como
// "não sei", nunca como "fora"; flag de anamnese sem registro sai com ressalva. Instrução se
// esquece; código não. O contrato continua sendo a skill compartilhada (TOM, Sol, Lia, app) —
// este arquivo é a implementação dela do lado do TOM.

const RECORTES = ['resumo', 'anamnese', 'instagram', 'comunidade', 'contrato', 'foto', 'telefone'];
const PAGINA_INICIAL = 15;   // primeira entrega: cabe no WhatsApp e já dá pra começar
const PAGINA_SEGUINTE = 30;  // se insistirem, vai fatiando de 30 em 30

function normalizarRecorte(r) {
  const v = String(r || '').trim().toLowerCase();
  return RECORTES.includes(v) ? v : 'resumo';
}

// Crianças primeiro (pedido do Alf): LAMK é ≤11 anos — é quem a recepção resolve falando com o
// responsável na porta. Dentro da faixa, nome, pra a lista ser estável entre as fatias.
function ordenarPessoas(pessoas) {
  const peso = (p) => (String(p && p.classificacao).toUpperCase() === 'LAMK' ? 0 : 1);
  return [...(pessoas || [])].sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  });
}

function fatiar(pessoas, pagina = 0) {
  const arr = pessoas || [];
  const p = Math.max(0, Number(pagina) || 0);
  const ini = p === 0 ? 0 : PAGINA_INICIAL + (p - 1) * PAGINA_SEGUINTE;
  const tam = p === 0 ? PAGINA_INICIAL : PAGINA_SEGUINTE;
  const itens = arr.slice(ini, ini + tam);
  const restam = Math.max(0, arr.length - (ini + itens.length));
  return { itens, restam, temMais: restam > 0, pagina: p };
}

const PENDENCIA = {
  anamnese: (p) => !p.anamnese_preenchida,
  instagram: (p) => !p.tem_instagram && !p.instagram_nao_possui,
  contrato: (p) => !p.tem_data_contrato,
  foto: (p) => !p.tem_foto,
  telefone: (p) => !p.tem_telefone,
  comunidade: (p) => p.comunidade_status === 'fora_da_comunidade',
};

function filtrarPorRecorte(pessoas, recorte) {
  const f = PENDENCIA[normalizarRecorte(recorte)];
  return f ? (pessoas || []).filter(f) : (pessoas || []);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ROTULO = {
  anamnese: 'sem anamnese', instagram: 'sem Instagram', contrato: 'sem data de contrato',
  foto: 'sem foto', telefone: 'sem telefone', comunidade: 'fora da comunidade',
};

// A LINHA DA COMUNIDADE é o coração da honestidade desta tela. Só existe "fora da comunidade"
// quando a captura é fresca; qualquer outro estado é NÃO SEI, dito com todas as letras.
function linhaComunidade(c) {
  const com = c || {};
  const naoSei = (com.sem_captura || 0) + (com.captura_desatualizada || 0) + (com.sem_grupo_configurado || 0);
  const partes = [];
  if (com.na_comunidade) partes.push(`${com.na_comunidade} na comunidade`);
  if (com.fora_da_comunidade) partes.push(`<b>${com.fora_da_comunidade} fora da comunidade</b>`);
  if (naoSei) partes.push(`${naoSei} <i>não sei (sem captura recente do grupo)</i>`);
  if (!partes.length) return null;
  return `📱 <b>Comunidade WhatsApp</b>: ${partes.join(' · ')}`;
}

function renderResumo(resumo, opts = {}) {
  const r = resumo || {};
  const pend = r.pendentes || {};
  const nome = esc(opts.grupoNome || 'a unidade');
  const linhas = [];
  linhas.push(`<h3>👥 Situação dos alunos — ${nome}</h3>`);
  linhas.push(`<p><b>${r.total_pessoas || 0} alunos ativos</b> (pessoas, não matrículas).</p>`);

  const itens = [];
  for (const [chave, rotulo] of [['anamnese', 'sem anamnese'], ['instagram', 'sem Instagram'],
    ['data_inicio_contrato', 'sem data de contrato'], ['foto', 'sem foto'], ['telefone', 'sem telefone']]) {
    const n = pend[chave];
    if (n) itens.push(`<li><b>${n}</b> ${rotulo}</li>`);
  }
  if (itens.length) linhas.push(`<p>📋 <b>Cadastro</b></p><ul>${itens.join('')}</ul>`);
  else linhas.push('<p>📋 <b>Cadastro</b>: tudo em dia.</p>');

  const com = linhaComunidade(r.comunidade);
  if (com) linhas.push(`<p>${com}</p>`);

  const versao = esc(r.regra_versao || 'desconhecida');
  const quando = r.medido_em ? ` · medido ${esc(String(r.medido_em).slice(0, 16).replace('T', ' '))}` : '';
  linhas.push(`<p><i>fonte: LA Report, regra ${versao}${quando}</i></p>`);
  return linhas.join('\n');
}

function renderLista({ recorte, pessoas, total, pagina = 0, grupoNome } = {}) {
  const rec = normalizarRecorte(recorte);
  const rotulo = ROTULO[rec] || 'com pendência';
  const nome = esc(grupoNome || 'a unidade');
  if (!total || !(pessoas || []).length) {
    return `<h3>👥 ${nome}</h3><p>Ninguém ${rotulo} — tudo em dia por aqui. 👊</p>`;
  }
  const { itens, restam } = fatiar(ordenarPessoas(pessoas), pagina);
  const li = itens.map((p) => {
    const faixa = String(p.classificacao).toUpperCase() === 'LAMK' ? '🧒' : '🎓';
    const ressalva = p.anamnese_flag_sem_registro
      ? ' <i>(marcada como preenchida, mas sem registro hoje — conferir)</i>' : '';
    return `<li>${faixa} ${esc(p.nome)}${ressalva}</li>`;
  }).join('');
  const cabeca = pagina === 0
    ? `<p><b>${total}</b> ${rotulo}. Começando pelas crianças:</p>`
    : `<p>Continuando — <b>${total}</b> ${rotulo}:</p>`;
  const rodape = restam
    ? `<p>…e mais <b>${restam}</b>. Quer que eu mande os próximos ${PAGINA_SEGUINTE}?</p>`
    : '<p>Essa foi a lista toda. 👊</p>';
  return `<h3>👥 ${nome}</h3>${cabeca}<ul>${li}</ul>${rodape}`;
}

// ── CACHE CURTO + RETRY ────────────────────────────────────────────────────────────────────
// MEDIDO em 02/09: a RPC leva 6–8s e o corte do PostgREST fica em ~8s — ela vive NO LIMITE, e
// 1 de 7 chamadas voltou `statement timeout`. Sem isto o TOM falha de forma aleatória na frente
// do time. O cache também torna a paginação de graça (a 2ª página não repaga 7s).
// Servir dado de minutos atrás é honesto porque o card SEMPRE mostra quando foi medido.
// TTL POR TIPO, e a razão é diferente em cada um (revisto em 02/09 depois que a RPC ficou 7x
// mais rápida — CG de 7,8s para ~1s):
//   resumo (o NÚMERO) → 60s. Só junta rajada de perguntas seguidas. O número anda durante o
//     dia: as anamneses do Recreio foram de 91 pra 104 em um mutirão. Cache longo aqui faria o
//     TOM repetir número velho enquanto o time trabalha.
//   lista (os NOMES) → 10 min, e agora por CONSISTÊNCIA, não por performance: a paginação
//     precisa de uma foto estável, senão a página 2 pula ou repete nome que mudou no meio.
const TTL_MS = 10 * 60 * 1000;
const TTL_POR_TIPO = { resumo: 60 * 1000, lista: TTL_MS };
const _cache = new Map();

function _chave(tipo, unidadeId) { return `${tipo}:${unidadeId}`; }

function ttlDoTipo(tipo) {
  return TTL_POR_TIPO[tipo] != null ? TTL_POR_TIPO[tipo] : TTL_MS;
}

async function consultarComCache({ tipo, unidadeId, client, agora = Date.now(), ttlMs = null }) {
  if (ttlMs == null) ttlMs = ttlDoTipo(tipo);
  const k = _chave(tipo, unidadeId);
  const hit = _cache.get(k);
  if (hit && (agora - hit.em) < ttlMs) return { data: hit.data, doCache: true, idadeMs: agora - hit.em };

  const chamar = () => (tipo === 'resumo'
    ? client.rpc('get_situacao_alunos_resumo_v1', { p_unidade_id: unidadeId })
    : client.rpc('get_situacao_alunos_v1', { p_unidade_id: unidadeId, p_apenas_pendentes: true }));

  let { data, error } = await chamar();
  if (error) {
    // Uma tentativa a mais: o timeout é de borda, não de doença. Duas falhas seguidas é falha
    // de verdade e tem que ser DITA — número de aluno inventado é pior que não responder.
    ({ data, error } = await chamar());
  }
  if (error) {
    if (hit) return { data: hit.data, doCache: true, idadeMs: agora - hit.em, degradado: error.message };
    throw new Error(error.message);
  }
  _cache.set(k, { data, em: agora });
  return { data, doCache: false, idadeMs: 0 };
}

function _limparCache() { _cache.clear(); }

module.exports = {
  RECORTES, PAGINA_INICIAL, PAGINA_SEGUINTE, TTL_MS, TTL_POR_TIPO, ttlDoTipo,
  normalizarRecorte, ordenarPessoas, fatiar, filtrarPorRecorte,
  renderResumo, renderLista, linhaComunidade,
  consultarComCache, _limparCache,
};

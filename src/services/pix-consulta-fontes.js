'use strict';
// pix-consulta-fontes.js — leitura das fontes do LA Report para a consulta de lista/número nos
// grupos, e a orquestração do turno. Par de src/services/pix-consulta.js (que é puro).
//
// Fontes (as MESMAS da pauta diária — nada muda no LA Report):
//   get_pix_migracao_v1(p_unidade_id, p_fatia=null)  -> todas as categorias e fatias da unidade
//   get_situacao_alunos_v1(p_unidade_id, p_apenas_pendentes=false) -> anamnese e contrato
// Toda consulta passa por `consultaComRetry` (uma oscilação não pode virar "não sei"), e `error`
// é SEMPRE checado: RPC com parâmetro errado devolve {data:null,error} e viraria "zero clientes"
// silencioso — a unidade pareceria vazia em vez de a fonte estar quebrada.
//
// PRIVACIDADE: o item da lista só carrega `pagador` e `alunos`. Telefone, CPF, e-mail, valor e id
// de fatura nunca saem daqui (um teste prende as chaves do objeto).

const pura = require('./pix-consulta');
const { ordenarPorPrioridade, fatiaDoCliente, FATIAS } = require('./pix-migracao');
const { filtrarPorRecorte } = require('./situacao-aluno');
const { consultaComRetry } = require('../lib/consulta-com-retry');

// Categorias que a fonte devolve hoje (medidas em 17/09 nas três unidades). Categoria NOVA que a
// fonte um dia mandar não some: cai em `outras` — melhor um número que ninguém sabe nomear do que
// um cliente invisível.
const CATEGORIAS = ['migrar', 'autorizacao_pendente', 'ja_migrou', 'aguardando_cobranca',
  'nao_mexe', 'inadimplente', 'nao_pagante', 'excecao'];
const NA_PAUTA = (l) => !!l && (l.categoria === 'migrar' || l.categoria === 'autorizacao_pendente');
const FAMILIA_ALUNO = new Set(['anamnese', 'contrato']);

function _rpcs({ laReport, unidadeId, deps }) {
  const retry = deps.retry || ((c) => consultaComRetry(c, { esperaMs: deps.esperaMs, sleep: deps.sleep }));
  const rpcPix = deps.rpcPix || (() => laReport.rpc('get_pix_migracao_v1', { p_unidade_id: unidadeId, p_fatia: null }));
  const rpcSituacao = deps.rpcSituacao || (() => laReport.rpc('get_situacao_alunos_v1', { p_unidade_id: unidadeId, p_apenas_pendentes: false }));
  return { retry, rpcPix, rpcSituacao };
}

// FATIA SÓ DO QUE ESTÁ NA PAUTA. `fatiaDoCliente` manda toda linha de fatia nula pra
// `sem_historico` — e na fonte real a fatia só vem preenchida em `migrar` (no Recreio de hoje são
// 215 linhas de ja_migrou/nao_mexe/inadimplente com fatia nula). Contar fatia sobre a fonte
// inteira transformaria essas 215 em "sem histórico" e a equipe cobraria gente que não deve nada.
function _contarPix(linhas) {
  const todas = linhas || [];
  const naPauta = todas.filter(NA_PAUTA);
  const porCategoria = new Map();
  for (const l of todas) { const c = (l && l.categoria) || 'outras'; porCategoria.set(c, (porCategoria.get(c) || 0) + 1); }
  const fatias = {};
  for (const f of FATIAS) fatias[f] = 0;
  for (const l of naPauta) { const f = fatiaDoCliente(l); fatias[f] = (fatias[f] || 0) + 1; }
  let outras = 0;
  for (const [c, n] of porCategoria) if (!CATEGORIAS.includes(c)) outras += n;
  const out = { total: todas.length, faltam: naPauta.length, fatias, outras };
  for (const c of CATEGORIAS) out[c] = porCategoria.get(c) || 0;
  return out;
}

function _dadoMaisNovo(linhas) {
  let maior = null;
  for (const l of linhas || []) {
    const v = l && l.dado_atualizado_em;
    if (v && (!maior || String(v) > String(maior))) maior = v;
  }
  return maior;
}

// YYYY-MM-DD do instante em horário de Brasília — o "hoje" do time, não o UTC do processo.
function _ymdBrt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}

// numerosDaUnidade -> { pix, anamnese, contrato, dadoEm, dadoDeHoje, motivo }
// Fonte que falhou vira `null` no seu pedaço + uma causa em `motivo`. NUNCA um zero: zero por
// falha sai idêntico a zero por saúde, e é assim que um laudo vira mentira.
async function numerosDaUnidade({ laReport, unidadeId, unidadeNome, hoje, deps = {} }) {
  const { retry, rpcPix, rpcSituacao } = _rpcs({ laReport, unidadeId, deps });
  const [rp, rs] = await Promise.all([retry(rpcPix), retry(rpcSituacao)]);

  const motivos = [];
  let pix = null;
  let dadoEm = null;
  if (rp && rp.error) {
    motivos.push(`PIX: ${rp.error.message}`);
  } else {
    const linhas = (rp && rp.data) || [];
    pix = _contarPix(linhas);
    dadoEm = _dadoMaisNovo(linhas);
  }

  let anamnese = null;
  let contrato = null;
  if (rs && rs.error) {
    motivos.push(`situação dos alunos: ${rs.error.message}`);
  } else {
    const pessoas = (rs && rs.data) || [];
    anamnese = { pendentes: filtrarPorRecorte(pessoas, 'anamnese').length, base: pessoas.length };
    contrato = { pendentes: filtrarPorRecorte(pessoas, 'contrato').length, base: pessoas.length };
  }

  const ymd = dadoEm ? _ymdBrt(dadoEm) : null;
  return {
    unidadeNome, pix, anamnese, contrato, dadoEm,
    dadoDeHoje: ymd && hoje ? ymd === String(hoje) : null,
    motivo: motivos.length ? motivos.join(' · ') : null,
  };
}

// C2 (fix round 1): ANTES, um pedido de anamnese/contrato (ou o alvo 'tudo') era servido com dado
// do PIX e título do PIX — os alunos de verdade sumiam calados, que é o defeito original com
// outra roupa. Agora cada família lê a SUA fonte.
// O item traz o RESPONSÁVEL na frente (é quem a escola cobra) e o aluno ao lado; aluno sem
// responsável cadastrado aparece com o próprio nome nos dois lugares — some ninguém.
async function _itensDeAluno({ retry, rpcSituacao, recorte }) {
  const r = await retry(rpcSituacao);
  if (r && r.error) throw new Error(`get_situacao_alunos_v1: ${r.error.message}`);
  return filtrarPorRecorte((r && r.data) || [], recorte)
    .map((p) => ({ pagador: p.responsavel_nome || p.nome, alunos: [p.nome] }))
    .sort((a, b) => String(a.pagador).localeCompare(String(b.pagador), 'pt-BR'));
}

async function _itensDePix({ retry, rpcPix, alvo }) {
  const r = await retry(rpcPix);
  if (r && r.error) throw new Error(`get_pix_migracao_v1: ${r.error.message}`);
  const linhas = (r && r.data) || [];
  let escolhidas;
  if (alvo === 'ja_migrou') escolhidas = linhas.filter((l) => l && l.categoria === 'ja_migrou');
  else if (alvo === 'autorizacao_pendente') escolhidas = linhas.filter((l) => l && l.categoria === 'autorizacao_pendente');
  else if (FATIAS.includes(alvo)) escolhidas = linhas.filter((l) => NA_PAUTA(l) && fatiaDoCliente(l) === alvo);
  else escolhidas = linhas.filter(NA_PAUTA); // 'pix' e 'tudo': tudo o que falta migrar
  return ordenarPorPrioridade(escolhidas).map((l) => ({ pagador: l.pagador_nome, alunos: l.alunos || [] }));
}

// itensDaLista -> [{ pagador, alunos }]  (LANÇA quando a fonte falha — ver o topo do arquivo)
async function itensDaLista({ laReport, unidadeId, alvo, deps = {} }) {
  const { retry, rpcPix, rpcSituacao } = _rpcs({ laReport, unidadeId, deps });
  if (FAMILIA_ALUNO.has(alvo)) return _itensDeAluno({ retry, rpcSituacao, recorte: alvo });
  return _itensDePix({ retry, rpcPix, alvo });
}

// blocosDaLista -> { blocos: [{ titulo, substantivo, itens }], falhas: [string] }
// 'tudo' manda PIX primeiro, depois anamnese, depois contrato — cada um com o seu título e a sua
// numeração de partes (quem monta as mensagens é pura.mensagensDeVariasListas).
// Uma fonte fora NÃO cala a outra: o que deu sai, e o que faltou vira aviso. Só quando NADA saiu
// é que lança (aí o grupo recebe a linha honesta de fonte fora).
async function blocosDaLista({ laReport, unidadeId, alvo, deps = {} }) {
  const { retry, rpcPix, rpcSituacao } = _rpcs({ laReport, unidadeId, deps });
  const pedidos = alvo === 'tudo'
    ? ['pix', 'anamnese', 'contrato']
    : [alvo];
  const blocos = [];
  const falhas = [];
  for (const p of pedidos) {
    try {
      const itens = FAMILIA_ALUNO.has(p)
        ? await _itensDeAluno({ retry, rpcSituacao, recorte: p })
        : await _itensDePix({ retry, rpcPix, alvo: p });
      blocos.push({ titulo: pura.tituloDoAlvo(p), substantivo: pura.substantivoDoAlvo(p), itens });
    } catch (e) {
      console.warn(`[PixConsulta] bloco ${p} unidade=${unidadeId}: ${e.message}`);
      falhas.push(`A lista de ${pura.tituloDoAlvo(p)} eu não consegui ler agora.`);
    }
  }
  if (!blocos.length) throw new Error(`nenhuma fonte respondeu (${falhas.length} falha(s))`);
  return { blocos, falhas };
}

// ── ORQUESTRAÇÃO DO TURNO DO GRUPO ────────────────────────────────────────────────────────────
// Chamada por src/services/group-chat-engine.js, ANTES do LLM. Dois caminhos bem diferentes:
//   LISTA   -> INTERCEPTA: posta as mensagens prontas e o turno acaba (o LLM não é chamado; ele
//              reescreveria/resumiria 231 nomes, que é exatamente o que não pode acontecer).
//   NÚMEROS -> NÃO intercepta: devolve `numerosContext` pro prompt, e o TOM responde na voz dele,
//              com o número certo, seja qual for a forma de perguntar.
// O gate barato mora aqui: sem token de assunto na fala (C1/I4), nenhuma RPC é disparada.
async function atenderPedidoNoGrupo({ laReport, unidadeId, unidadeNome, text, hoje, postar, deps = {} }) {
  const pedido = pura.detectarPedido(text);
  const nada = { tratou: false, ultimo: null, numerosContext: '' };

  if (pedido && pedido.tipo === 'lista') {
    if (!unidadeId) return { tratou: true, ultimo: await postar(pura.TEXTO_SEM_UNIDADE), numerosContext: '' };
    let blocos;
    let falhas;
    try {
      ({ blocos, falhas } = await (deps.blocosDaLista || blocosDaLista)({ laReport, unidadeId, alvo: pedido.alvo, deps }));
    } catch (e) {
      console.warn(`[PixConsulta] lista ${pedido.alvo} unidade=${unidadeId}: ${e.message}`);
      return { tratou: true, ultimo: await postar(pura.TEXTO_FONTE_FORA), numerosContext: '' };
    }
    const msgs = pura.mensagensDeVariasListas({ unidadeNome, blocos, avisos: falhas });
    let ultimo = null;
    for (const m of msgs) ultimo = await postar(m); // uma por vez, em ordem
    const total = blocos.reduce((s, b) => s + (b.itens || []).length, 0);
    console.log(`[PixConsulta] lista ${pedido.alvo} unidade=${unidadeId}: ${total} nomes em ${msgs.length} mensagem(ns)`);
    return { tratou: true, ultimo, numerosContext: '' };
  }

  if (!unidadeId) return nada;
  if (!pedido && !pura.precisaDeNumeros(text)) return nada;
  const n = await (deps.numerosDaUnidade || numerosDaUnidade)({ laReport, unidadeId, unidadeNome, hoje, deps });
  return { tratou: false, ultimo: null, numerosContext: pura.blocoDeNumeros({ ...n, unidadeNome }) };
}

module.exports = { numerosDaUnidade, itensDaLista, blocosDaLista, atenderPedidoNoGrupo };

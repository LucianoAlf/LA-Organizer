'use strict';
// fila-memorias.js — FILA-DE-MEMORIAS-NO-GRUPO-DE-OPS (Alf, 10/09/2026).
//
// As memórias que o TOM tira dos grupos (lesson/fact/preference) nascem desligadas e esperam um
// ok humano, porque mudam o comportamento dele na frente do time. O ato de aprovar já existia
// (group-memory.decidirMemorias), mas só DENTRO de cada grupo e só quando alguém lá pedia. O
// aviso que chegava ao Alf ia pra DM das 07:30, cortado em 3 trechos, sem como responder — e o
// Alf perguntou, com razão, "onde é que isso aparece pra eu autorizar?".
//
// Agora a fila de TODOS os grupos vai inteira pro grupo de ops (Alf + Hugo), numerada, com
// "o que muda no TOM" em cada item, e a resposta ali mesmo decide: "aprova 1 3", "descarta 2",
// "aprova todas", "memórias pendentes". Quem decide é CÓDIGO (este módulo), nunca a LLM: um número
// mal entendido aprovaria uma regra errada pro time inteiro.
//
// NUMERAÇÃO ESTÁVEL: o número é gravado na memória (`review_number`) quando a lista é postada e
// só muda na próxima lista. Aprovar a 1 não renumera as outras, e memória que nasce depois da
// lista fica sem número — não dá pra aprová-la por engano respondendo a uma lista velha.

const { ordenarPendentes, decidirMemorias, pediuPraTodosOsGrupos } = require('./group-memory');

const ROTULO = { lesson: 'regra', fact: 'fato', preference: 'preferência', decision: 'decisão', context: 'contexto' };
const DONO_DO_CANAL = (process.env.TOM_OPS_ALLOWLIST || '').split(',')[0].trim();

function _norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Grupo em ordem alfabética; dentro do grupo, a MESMA ordem do card de cada grupo.
function ordenarFila(itens) {
  const porGrupo = new Map();
  for (const it of (itens || [])) {
    if (!it) continue;
    const g = it.grupo || 'grupo';
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(it);
  }
  const grupos = [...porGrupo.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return grupos.flatMap((g) => ordenarPendentes(porGrupo.get(g)));
}

function _corta(s, max) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Texto de WhatsApp da fila. Cada item já traz `review_number`. */
function renderFila(itens) {
  const lista = (itens || []).filter((i) => i && Number.isInteger(i.review_number))
    .sort((a, b) => a.review_number - b.review_number);
  if (!lista.length) return '🧠 Nenhuma memória esperando o seu ok.';
  const blocos = lista.map((i) => {
    const linhas = [`*${i.review_number}.* _${i.grupo || 'grupo'}_ · ${ROTULO[i.memory_type] || i.memory_type || 'memória'}`];
    linhas.push(_corta(i.content, 400));
    linhas.push(i.efeito && String(i.efeito).trim()
      ? `↳ *Muda no TOM:* ${_corta(i.efeito, 240)}`
      : '↳ *Muda no TOM:* _não informado — memória de antes de 10/09_');
    if (i.evidence) linhas.push(`🗣️ _"${_corta(i.evidence, 140)}"_`);
    return linhas.join('\n');
  });
  const n = lista.length;
  return [
    `🧠 *${n === 1 ? 'Memória esperando' : 'Memórias esperando'} o seu ok* (${n})`,
    '_Só passam a valer no TOM depois de aprovadas._',
    '',
    blocos.join('\n\n'),
    '',
    'Responde aqui: *aprova 1 3*, *descarta 2* ou *aprova todas*.',
    'Se vale em qualquer grupo: *aprova 1 pra todos os grupos*.',
  ].join('\n');
}

const _VERBO = /^(aprova|aprovar|aprovo|aprovada|aprovadas|descarta|descartar|descarto|rejeita|rejeitar|rejeito)\b/;
const _LISTAR = /^(?:(?:lista|mostra|manda|ver|quais)(?: as| a)? )?(?:memorias?|licoes?)(?: pendentes?| na fila| esperando(?: aprovacao| o (?:meu|seu) ok)?)?$|^fila(?: de memorias)?$/;
const _TODOS_OS_GRUPOS = /\b(?:pra|para|em) todos os grupos\b|\btodos os grupos\b|\btodos grupos\b|\btodo grupo\b|\bqualquer grupo\b|\bem todo lugar\b/g;

// FILA-MUDA-NO-GRUPO-DE-OPS (Alf 11/09). A primeira resposta real à fila foi
// "1. aprovo / 2. aprovo / 3. aprovo" — número na frente, um por linha — e caiu fora: só
// "aprova 1 3" era lido. Aqui cada linha tem que ser EXATAMENTE número + verbo; uma linha
// fora disso devolve null e a mensagem vai pro agente, como qualquer texto ambíguo.
const _LINHA = /^(\d{1,3})\s*[.):\-–]?\s*(aprova|aprovar|aprovo|aprovada|aprovado|descarta|descartar|descarto|descartada|descartado|rejeita|rejeitar|rejeito)$/;
function _porLinha(texto) {
  const linhas = String(texto == null ? '' : texto).split(/\n+/)
    .map((l) => _norm(l).replace(/[.!?]+$/, '')).filter(Boolean);
  if (!linhas.length) return null;
  const aprovar = [];
  const descartar = [];
  for (const l of linhas) {
    const m = l.match(_LINHA);
    if (!m || Number(m[1]) < 1) return null;
    (/^aprov/.test(m[2]) ? aprovar : descartar).push(Number(m[1]));
  }
  if (aprovar.some((n) => descartar.includes(n))) return null;
  const ops = [];
  if (aprovar.length) ops.push({ acao: 'aprovar', numeros: [...new Set(aprovar)], todas: false });
  if (descartar.length) ops.push({ acao: 'descartar', numeros: [...new Set(descartar)], todas: false });
  return { tipo: 'decidir', ops, paraTodosOsGrupos: false };
}

/**
 * Lê o comando do grupo de ops. Devolve null para tudo que não for comando claro — aí a mensagem
 * segue pro agente. Ambíguo também é null: "aprova todas menos a 2" não é adivinhado.
 * @returns {null | {tipo:'listar'} | {tipo:'decidir', ops:Array<{acao:string, numeros:number[], todas:boolean}>, paraTodosOsGrupos:boolean}}
 */
function parseComandoFila(texto) {
  const t = _norm(texto).replace(/[.!?]+$/, '');
  if (!t) return null;
  if (_LISTAR.test(t)) return { tipo: 'listar' };
  const _linhas = _porLinha(texto);
  if (_linhas) return _linhas;
  if (!_VERBO.test(t)) return null;
  if (/\b(menos|exceto|fora a|fora o|tirando)\b/.test(t)) return null;
  const paraTodosOsGrupos = pediuPraTodosOsGrupos(texto);
  const limpo = t.replace(_TODOS_OS_GRUPOS, ' ');
  const partes = limpo.split(/\b(?=aprova|aprovar|aprovo|descarta|descartar|descarto|rejeita|rejeitar|rejeito)/).filter((p) => p.trim());
  const ops = [];
  for (const p of partes) {
    const acao = /^(aprova|aprovo|aprovad)/.test(p.trim()) ? 'aprovar' : 'descartar';
    const numeros = [...new Set((p.match(/\b\d{1,3}\b/g) || []).map(Number).filter((n) => n >= 1))];
    const todas = /\b(todas|tudo|todos)\b/.test(p);
    if (!numeros.length && !todas) return null;
    if (numeros.length && todas) return null;
    ops.push({ acao, numeros, todas });
  }
  if (!ops.length) return null;
  const aprov = new Set(ops.filter((o) => o.acao === 'aprovar').flatMap((o) => o.numeros));
  if (ops.some((o) => o.acao === 'descartar' && o.numeros.some((n) => aprov.has(n)))) return null;
  if (ops.filter((o) => o.todas).length && ops.length > 1) return null;
  return { tipo: 'decidir', ops, paraTodosOsGrupos };
}

// ── I/O ───────────────────────────────────────────────────────────────────────────────────

async function listarFilaGlobal(supabase) {
  const { data, error } = await supabase.from('group_memory')
    .select('id, content, memory_type, occurred_on, evidence, efeito, review_number, group:work_groups(name)')
    .eq('is_active', false).is('approved_at', null).limit(200);
  if (error) { console.error('[FilaMemorias] listar falhou:', error.message); return null; }
  return (data || []).map((r) => ({ ...r, grupo: (r.group && r.group.name) || 'grupo' }));
}

/** Grava o número de cada item. Se UM falhar, a lista não pode sair: número postado sem estar
 * gravado faria "aprova 3" cair em outra memória. */
async function numerarFila(supabase, itens) {
  const ordem = ordenarFila(itens);
  for (let k = 0; k < ordem.length; k++) {
    const { error } = await supabase.from('group_memory').update({ review_number: k + 1 }).eq('id', ordem[k].id);
    if (error) throw new Error(`não consegui numerar a fila (${error.message})`);
    ordem[k] = { ...ordem[k], review_number: k + 1 };
  }
  return ordem;
}

async function decidirFila(supabase, cmd) {
  const pendentes = await listarFilaGlobal(supabase);
  if (pendentes === null) throw new Error('não consegui ler a fila');
  const numerados = pendentes.filter((p) => Number.isInteger(p.review_number));
  const resultados = [];
  const tocados = new Set();
  for (const op of cmd.ops) {
    const pedidos = op.todas ? numerados.map((p) => p.review_number) : op.numeros;
    const alvos = numerados.filter((p) => pedidos.includes(p.review_number) && !tocados.has(p.id));
    const foraDaLista = pedidos.filter((n) => !numerados.some((p) => p.review_number === n));
    const escopo = op.acao === 'aprovar' && cmd.paraTodosOsGrupos ? 'tom' : 'group';
    let r = { feitos: [], escopoAplicado: 'group' };
    if (alvos.length) {
      r = await decidirMemorias(supabase, {
        pendentes: alvos, numeros: alvos.map((_, i) => i + 1), acao: op.acao, escopo,
      });
    }
    for (const f of r.feitos) tocados.add(f.id);
    resultados.push({ acao: op.acao, feitos: r.feitos, foraDaLista, escopoAplicado: r.escopoAplicado, pediuTodos: escopo === 'tom' });
  }
  const restam = numerados.filter((p) => !tocados.has(p.id)).map((p) => p.review_number).sort((a, b) => a - b);
  const semNumero = pendentes.length - numerados.length;
  return { resultados, restam, semNumero, havia: numerados.length };
}

function renderResultado({ resultados = [], restam = [], semNumero = 0, havia = 0 } = {}) {
  if (!havia) return 'Não tem lista numerada ainda — manda *memórias pendentes* que eu mostro a fila.';
  const linhas = [];
  for (const r of resultados) {
    const aprovar = r.acao === 'aprovar';
    if (r.feitos.length) {
      const titulo = aprovar
        ? (r.feitos.length === 1 ? '✅ *Aprovada:*' : `✅ *Aprovadas (${r.feitos.length}):*`)
        : (r.feitos.length === 1 ? '🗑️ *Descartada:*' : `🗑️ *Descartadas (${r.feitos.length}):*`);
      linhas.push(titulo);
      // O TEXTO do que foi decidido, não o número: se o número estava errado, dá pra ver na hora.
      for (const f of r.feitos) linhas.push(`• ${_corta(f.content, 140)}`);
      if (aprovar && r.escopoAplicado === 'tom') linhas.push('_Passa a valer em todos os grupos._');
      else if (aprovar && r.pediuTodos) linhas.push('_Aprovei só no grupo de origem: a promoção pra todos os grupos não está disponível._');
    }
    if (r.foraDaLista.length) linhas.push(`⚠️ Não está na lista: ${r.foraDaLista.join(', ')}.`);
  }
  if (!resultados.some((r) => r.feitos.length)) linhas.unshift('Não consegui aplicar nada.');
  if (restam.length) linhas.push(`⏳ Ainda esperando: ${restam.join(', ')}.`);
  if (semNumero > 0) linhas.push(`_${semNumero} nova(s) chegou depois da lista — entra na próxima._`);
  return linhas.join('\n');
}

/** Ponto único do grupo de ops: lista ou decide. Devolve o texto pra postar. */
async function executarComandoFila(supabase, cmd) {
  if (cmd.tipo === 'listar') {
    const itens = await listarFilaGlobal(supabase);
    if (itens === null) throw new Error('não consegui ler a fila');
    return renderFila(await numerarFila(supabase, itens));
  }
  return renderResultado(await decidirFila(supabase, cmd));
}

/** 07:30 no grupo de ops. Idempotente por dia; só grava o log com a entrega confirmada. */
async function enviarFilaDeMemorias(sb, { postar, ymd, force = false, ownerId = DONO_DO_CANAL } = {}) {
  if (typeof postar !== 'function') return { enviado: false, motivo: 'sem canal de envio' };
  if (!ownerId) return { enviado: false, motivo: 'sem owner para idempotência' };
  if (!force) {
    const { data: ja } = await sb.from('ritual_logs').select('id')
      .eq('collaborator_id', ownerId).eq('ritual_type', 'fila_memorias')
      .eq('reference_date', ymd).eq('status', 'sent').limit(1);
    if (ja && ja.length) return { enviado: false, motivo: 'já entregue hoje' };
  }
  const itens = await listarFilaGlobal(sb);
  if (itens === null) throw new Error('não consegui ler a fila');
  if (!itens.length) return { enviado: false, motivo: 'fila vazia' };
  const numerados = await numerarFila(sb, itens);
  const r = await postar(renderFila(numerados));
  if (!r) throw new Error('a lista não foi entregue no grupo');
  await sb.from('ritual_logs').insert({
    collaborator_id: ownerId, ritual_type: 'fila_memorias', reference_date: ymd,
    status: 'sent', sent_at: new Date().toISOString(), detail: `itens=${numerados.length}`,
  });
  return { enviado: true, itens: numerados.length };
}

module.exports = {
  ordenarFila, renderFila, parseComandoFila, renderResultado,
  listarFilaGlobal, numerarFila, decidirFila, executarComandoFila, enviarFilaDeMemorias,
};

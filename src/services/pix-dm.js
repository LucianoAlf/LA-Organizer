'use strict';
// pix-dm.js — PIX automático no 1:1 (Ana Paula, DM, 05/10 19:08–19:11 BRT).
//
// O CASO. "Tiveram alguns cadastros de Pix tom. Se puder atualizar a lista pra mim, vou te dizendo
// quem já foi" -> o TOM escreveu DE CABEÇA uma lista numerada de 10 nomes (as filhas da pauta que
// apareciam no contexto do prompt), sem fonte. "3 - crédito recorrente já cadastrado / 8 - Pix
// recorrente já cadastrado" -> TASK_UPDATE complete nas filhas da pauta do GRUPO: fechou as duas,
// mas SEM o marcador PIX_CADASTRO (a reconferência de 7 dias do ritual não sabia de nada) e o 3 era
// CARTÃO, não PIX. "3 tá ok / 8 tá ok" -> "Não achei nenhuma tarefa aberta… no teu nome".
//
// RAIZ: o 1:1 não tinha a lista do PIX nem o caminho do "cadastrei". Agora, igual ao grupo:
//   LISTA   — o LLM emite o MESMO <<LISTA_PIX>> do grupo; o CÓDIGO lê a MESMA fonte
//             (pix-consulta-fontes, mesma conta da lista do grupo) e escreve a lista NUMERADA.
//             O número -> cliente fica guardado (marker_logs PIX_LISTA_DM) pra resposta seguinte.
//   AVISO   — "8 já cadastrado", "o 3 e o 8 já foram", "cadastrei <nome> no automático": o código
//             resolve o número contra a lista que ele MESMO mandou, relê a fonte e registra pelo
//             MESMO caminho do grupo (pix-cadastro-grupo.registrarCadastroInformado: marcador
//             PIX_CADASTRO primeiro, depois a baixa da filha pendente da pauta, se houver).
//             CARTÃO não é PIX cadastrado: a lista lê o Emusys, então a resposta é "atualiza a
//             forma de pagamento lá" — nada é registrado. "Anotei" só sai quando o código gravou.
// Mesmo padrão de deps injetáveis do resto do PIX: nenhum teste toca Supabase nem LA Report.

const pura = require('./pix-consulta');
const fontes = require('./pix-consulta-fontes');
const situ = require('./situacao-aluno');
const { detectarCadastroInformado } = require('../lib/pix-cadastro-informado');
const { stripReplyScaffold } = require('../events/detect-approval-reply');
const cadastro = require('./pix-cadastro-grupo');

const ORDEM_UNIDADES = ['campo grande', 'recreio', 'barra'].map((a) => situ.resolverUnidade(a));
const MARCADOR_LISTA = 'PIX_LISTA_DM';
const JANELA_LISTA_MS = 24 * 3600 * 1000;
const RE_CARTAO = /cart[aã]o/i;

function _norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// GATE BARATO do 1:1: sem o assunto na fala, nenhuma leitura e nenhum bloco no prompt.
function falaDePix(texto) {
  const t = _norm(stripReplyScaffold(String(texto || '')).userText);
  return /\bpix\b|\bautomatico\b|\bmigracao\b/.test(t);
}

// ── LEITURA DA RESPOSTA POR NÚMERO (puro) ──────────────────────────────────────────────────────
// Conservador de propósito (mesma régua do "cadastrei" do grupo): baixa errada é pior que deixar
// o LLM perguntar. Só vira aviso quando: há palavra de FEITO, nenhuma negação/dúvida/pergunta,
// nenhum horário/data (o número seria ambíguo), todo número cabe na lista e a fala é curta.
const RE_FEITO = /\bcadastrad[oa]s?\b|\bok\b|\bfoi\b|\bforam\b|\bfeito\b|\bmigro(u|ram)\b|\bmigrad[oa]s?\b|\bpronto\b|\bresolvid[oa]s?\b|✅/;
const RE_DUVIDA = /\?|\bnao\b|\bnunca\b|\bainda\b|\bfalta\b|\bfaltou\b|\bacho\b|\btalvez\b|\bparece\b|\bvou\b|\bdepois\b|\bamanha\b|\bpendente\b|\bsera\b/;
const RE_HORA_DATA = /\d{1,2}\s*[:h]\s*\d{2}|\d{1,2}\/\d{1,2}/;
const RE_NUMERO = /(?:^|[\s,;(])(?:o |a |n[o°º]\.?\s?|numero\s)?(\d{1,3})(?=$|[\s\-–—:.,;)])/g;
const TETO_PALAVRAS = 40;

// -> [{ numero, forma: 'pix' | 'cartao' | null }] | null
function lerRespostaPorNumero(texto, { tamanho } = {}) {
  const t = _norm(stripReplyScaffold(String(texto || '')).userText).trim();
  if (!t || !(tamanho > 0)) return null;
  if (t.split(/\s+/).length > TETO_PALAVRAS) return null;
  if (!RE_FEITO.test(t) || RE_DUVIDA.test(t) || RE_HORA_DATA.test(t)) return null;
  const achados = [];
  for (const m of t.matchAll(RE_NUMERO)) achados.push({ numero: Number(m[1]), ini: m.index });
  if (!achados.length) return null;
  const out = [];
  for (let i = 0; i < achados.length; i++) {
    const { numero, ini } = achados[i];
    if (!(numero >= 1 && numero <= tamanho)) return null;
    const trecho = t.slice(ini, i + 1 < achados.length ? achados[i + 1].ini : t.length);
    const forma = /\bcredito\b|\bcartao\b/.test(trecho) ? 'cartao' : /\bpix\b|\bautomatico\b/.test(trecho) ? 'pix' : null;
    if (!out.some((o) => o.numero === numero)) out.push({ numero, forma });
  }
  return out;
}

// Gate barato do turno (engine, antes do LLM): só paga I/O quando a fala TEM forma de aviso —
// número + palavra de feito, ou o "cadastrei <nome> no automático" do grupo.
function talvezAvisoDePix(texto) {
  const u = stripReplyScaffold(String(texto || '')).userText;
  if (detectarCadastroInformado(u)) return true;
  const t = _norm(u);
  return /\d/.test(t) && RE_FEITO.test(t);
}

// ── BLOCO DO PROMPT ───────────────────────────────────────────────────────────────────────────
function blocoPixDM({ porUnidade = [] } = {}) {
  const L = ['## 💠 PIX AUTOMÁTICO NO 1:1 — fonte: LA Report, a MESMA lista dos grupos'];
  for (const u of porUnidade) L.push(pura.blocoDeNumeros(u));
  L.push('REGRAS:');
  L.push('- Pediram a lista / os nomes / "atualiza a lista" do PIX? Escreva UMA linha curta de abertura e emita <<LISTA_PIX>>{"alvo":"pix","unidade":"campo grande|recreio|barra"}<<END>> (unidade só se a pessoa disser; os mesmos alvos do grupo: "pix", "pix_avulso", "cheque", "cartao_cadastrado", "ja_migrou"…). O sistema escreve a lista NUMERADA, da fonte. NUNCA escreva os nomes você mesmo — nem a partir das tarefas "PIX automático — …" que aparecem no seu contexto.');
  L.push('- Quem já foi a pessoa diz pelo NÚMERO da lista ou com "cadastrei <nome> no automático" — quem registra é o SISTEMA. NUNCA emita TASK_UPDATE em tarefa "PIX automático — …" e nunca diga que marcou/anotou/fechou alguém do PIX por conta própria.');
  L.push('- Cartão recorrente (crédito) NÃO é PIX automático: a lista lê o Emusys, então a forma de pagamento tem que ser atualizada LÁ; quando a cobrança passar no cartão, a pessoa sai da lista sozinha.');
  return L.join('\n');
}

// ── A LISTA NUMERADA ──────────────────────────────────────────────────────────────────────────
function _rpcPadrao(laReport) {
  return (unidadeId) => laReport.rpc('get_pix_migracao_v1', { p_unidade_id: unidadeId, p_fatia: null });
}
function _depsDaUnidade(deps, laReport, unidadeId) {
  const rpc = deps.rpcPixDaUnidade || _rpcPadrao(laReport);
  return { ...deps, rpcPix: () => rpc(unidadeId) };
}

async function _guardarListaPadrao(supabase, { collaboratorId, itens }) {
  const { error } = await supabase.from('marker_logs').insert({
    collaborator_id: collaboratorId, marker_type: MARCADOR_LISTA, result: 'skipped',
    reason: `lista:${itens.length}`, raw_excerpt: JSON.stringify({ v: 1, itens: itens.map((i) => [i.n, i.chave, i.nome]) }),
  });
  if (error) { console.error(`[PixDM] guardar lista falhou: ${error.message}`); return false; }
  return true;
}
async function _ultimaListaPadrao(supabase, { collaboratorId, desdeIso }) {
  const { data, error } = await supabase.from('marker_logs').select('raw_excerpt, created_at')
    .eq('collaborator_id', collaboratorId).eq('marker_type', MARCADOR_LISTA)
    .gte('created_at', desdeIso).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`ultimaLista: ${error.message}`);
  if (!data) return null;
  const j = JSON.parse(data.raw_excerpt || '{}');
  return (j.itens || []).map(([n, chave, nome]) => ({ n, chave, nome }));
}

const RE_MARKER = /<<LISTA_PIX>>([\s\S]*?)<<END>>/gi;

// -> { reply, atendidos, falhas, itens }
async function atenderMarkersListaPixDM({ reply, laReport, supabase, unidadeIds = [], collaboratorId, deps = {} }) {
  const texto = String(reply == null ? '' : reply);
  const brutos = Array.from(texto.matchAll(RE_MARKER)).map((m) => m[1]);
  if (!brutos.length) return { reply: texto, atendidos: 0, falhas: 0, itens: [] };
  const guardar = deps.guardarLista || ((arg) => _guardarListaPadrao(supabase, arg));

  let p = {};
  try { p = JSON.parse(String(brutos[0]).trim()) || {}; } catch (_) { p = {}; }
  // No 1:1 este marcador é só do PIX: anamnese/contrato têm o <<SITUACAO_ALUNO>>; "tudo" = "pix".
  let alvos = pura.alvosDoMarker(p.alvo).map((a) => (a === 'tudo' ? 'pix' : a)).filter((a) => a !== 'anamnese' && a !== 'contrato');
  if (!alvos.length) alvos = ['pix'];
  const citada = situ.resolverUnidade(p.unidade);
  const unidades = citada ? [citada] : (unidadeIds.length ? unidadeIds : ORDEM_UNIDADES);

  const blocos = [];
  const itens = [];
  const avisos = [];
  let falhas = 0;
  for (const unidadeId of unidades) {
    const unidadeNome = situ.nomeDaUnidade(unidadeId);
    for (const alvo of alvos) {
      try {
        // eslint-disable-next-line no-await-in-loop -- ordem importa (CG, Recreio, Barra)
        const b = await fontes.blocoNumeravel({ laReport, unidadeId, alvo, deps: _depsDaUnidade(deps, laReport, unidadeId) });
        const numerados = b.itens.map((it) => {
          const n = itens.length + 1;
          itens.push({ n, chave: it.chave, nome: it.pagador });
          return { pagador: it.pagador, alunos: it.alunos, secao: it.secao, numero: n };
        });
        blocos.push({ titulo: `${pura.tituloDoAlvo(alvo)} — ${unidadeNome}`, substantivo: 'clientes', itens: numerados, resumo: b.resumo });
      } catch (e) {
        falhas++;
        console.warn(`[PixDM] lista ${alvo} unidade=${unidadeNome}: ${e.message}`);
        avisos.push(`A lista de ${unidadeNome} eu não consegui ler agora — me pede de novo daqui a pouco.`);
      }
    }
  }
  let corpo;
  if (!blocos.length) {
    corpo = 'Não consegui ler a lista do PIX agora — me pede de novo daqui a pouco. Não vou te mandar nome que eu não medi.';
  } else {
    const msgs = pura.mensagensDeVariasListas({ unidadeNome: null, blocos, avisos, limitePorMensagem: 1000, tetoMensagens: 20 });
    corpo = msgs.join('\n\n');
    if (itens.length) {
      const ok = await guardar({ collaboratorId, itens });
      corpo += ok
        ? '\n\n_Me responde com o número de quem já foi (ex.: "8 já cadastrado no PIX") que eu registro._'
        : '\n\n_Não consegui guardar a numeração desta lista — pra me dizer quem já foi, usa "cadastrei <nome> no automático"._';
    }
  }
  let primeiro = true;
  const out = texto.replace(RE_MARKER, () => {
    if (!primeiro) return '';
    primeiro = false;
    return `\n\n${corpo}\n\n`;
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { reply: out, atendidos: brutos.length, falhas, itens };
}

// ── O AVISO DE QUEM JÁ FOI (antes do LLM) ─────────────────────────────────────────────────────
// -> null (não é comigo) | { linhas: [texto], gravou: bool }
async function resolverPixDoTurno({ supabase, laReport, collaboratorId, text, unidadeIds = [], deps = {} }) {
  const ultima = deps.ultimaLista || ((arg) => _ultimaListaPadrao(supabase, arg));
  const agora = deps.agora || Date.now;

  // 1) Por número, contra a última lista que o TOM mandou NESTE 1:1.
  let pedidos = null;
  let mapa = null;
  const userText = stripReplyScaffold(String(text || '')).userText;
  if (/\d/.test(userText)) {
    try {
      mapa = await ultima({ collaboratorId, desdeIso: new Date(agora() - JANELA_LISTA_MS).toISOString() });
    } catch (e) {
      console.warn(`[PixDM] última lista não leu: ${e.message}`);
      mapa = null;
    }
    if (mapa && mapa.length) {
      const lidos = lerRespostaPorNumero(text, { tamanho: mapa.length });
      if (lidos) pedidos = lidos.map((l) => ({ ...mapa.find((m) => m.n === l.numero), forma: l.forma }));
    }
  }
  // 2) Pelo nome — a MESMA fala que o grupo reconhece.
  let porNome = null;
  if (!pedidos) {
    const det = detectarCadastroInformado(userText);
    if (!det) return null;
    porNome = det.nome;
  }

  // Relê a fonte: o que a pessoa diz é confrontado com o que o Emusys mostra AGORA.
  const unidades = pedidos
    ? [...new Set(pedidos.map((p) => String(p.chave).split(':')[0]))]
    : (unidadeIds.length ? unidadeIds : ORDEM_UNIDADES);
  const linhasFonte = [];
  for (const unidadeId of unidades) {
    try {
      // eslint-disable-next-line no-await-in-loop
      linhasFonte.push(...await fontes.linhasDaUnidade({ laReport, unidadeId, deps: _depsDaUnidade(deps, laReport, unidadeId) }));
    } catch (e) {
      console.warn(`[PixDM] fonte fora (${unidadeId}): ${e.message}`);
      return { linhas: ['Não consegui ler a lista do PIX agora pra conferir — não registrei nada. Me manda de novo daqui a pouco.'], gravou: false };
    }
  }

  if (porNome) {
    const cand = linhasFonte.filter((l) => cadastro._casaPorPalavraInteira(porNome, l.pagador_nome));
    if (!cand.length) return { linhas: [`*${porNome}* não está na lista do PIX das tuas unidades. Se já cadastrou, o Emusys confirma e sai da lista sozinho.`], gravou: false };
    if (cand.length > 1) return { linhas: [`Achei mais de um parecido: ${cand.map((l) => l.pagador_nome).join(' · ')}. Qual deles?`], gravou: false };
    pedidos = [{ n: null, chave: cand[0].pagador_chave, nome: cand[0].pagador_nome, forma: 'pix' }];
  }

  const porChave = new Map(linhasFonte.map((l) => [l.pagador_chave, l]));
  const linhas = [];
  let gravou = false;
  for (const p of pedidos) {
    const rotulo = p.n ? `${p.n}. ${p.nome}` : p.nome;
    const l = porChave.get(p.chave);
    if (!l) { linhas.push(`• ${rotulo} — já saiu da lista do Emusys, nada a fazer.`); continue; }
    if (l.categoria === 'ja_migrou') { linhas.push(`• ${rotulo} — já aparece como migrado pro PIX automático no Emusys ✅, nada a fazer.`); continue; }
    if (l.categoria === 'autorizacao_pendente') { linhas.push(`• ${rotulo} — já está cadastrado no PIX automático no Emusys, esperando a 1ª cobrança. Nada a fazer.`); continue; }
    if (l.categoria !== 'migrar') { linhas.push(`• ${rotulo} — não está na lista de quem falta migrar, nada a fazer.`); continue; }
    const cartao = p.forma === 'cartao' || (p.forma == null && RE_CARTAO.test(String(l.cobranca_automatica_cadastrada || '')));
    if (cartao) {
      linhas.push(`• ${rotulo} — cartão recorrente não é PIX automático: a lista lê o Emusys, então atualiza a forma de pagamento lá (cartão recorrente). Quando a cobrança passar no cartão, sai da lista sozinho. Aqui não registrei nada.`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await cadastro.registrarCadastroInformado({ supabase, collaboratorId, pagadorChave: p.chave, deps });
    if (r.ok) {
      gravou = true;
      linhas.push(`• ${rotulo} — ✅ anotei no PIX automático: sai da pauta e confiro no Emusys; se em 7 dias não aparecer lá, volta pra lista.`);
    } else {
      linhas.push(`• ${rotulo} — não consegui registrar agora, tenta de novo daqui a pouco.`);
    }
  }
  return { linhas, gravou };
}

// Hint pro LLM: ele só abre a mensagem; o resultado item a item o CÓDIGO anexa (nunca o LLM).
function hintDoResultado() {
  return '### 💠 PIX — O SISTEMA JÁ TRATOU ESTA MENSAGEM\nA pessoa disse quem já foi do PIX automático e o SISTEMA já conferiu na fonte e registrou o que dava. O resultado item a item vai ANEXADO automaticamente depois da sua fala. Escreva SÓ uma linha curta e calorosa de abertura (ex.: "Conferi aqui 👇"). NÃO diga você mesmo quem foi marcado/anotado/fechado, NÃO emita TASK_UPDATE nem nenhum marcador pra esses clientes.';
}

// ── A REDE: tarefa da pauta do PIX nunca se fecha pelo TASK_UPDATE do 1:1 ───────────────────────
// Foi o que aconteceu em 05/10: a filha fechou sem o marcador PIX_CADASTRO (e o 3 era cartão). A
// baixa do PIX tem dono: registrarCadastroInformado. Ações 'complete' com título "PIX automático —"
// saem do marcador; o resto do marcador fica intacto.
const RE_TASK_UPDATE = /<<TASK_UPDATE>>\s*([\s\S]*?)\s*<<END>>/gi;
const _ehConclusaoDePix = (a) => a && String(a.action || '').toLowerCase() === 'complete' && /^\s*PIX automático —/i.test(String(a.title || ''));
function tirarConclusaoDePix(reply) {
  const texto = String(reply == null ? '' : reply);
  let tirados = 0;
  const out = texto.replace(RE_TASK_UPDATE, (bloco, json) => {
    let j;
    try { j = JSON.parse(json); } catch (_) { return bloco; }
    const lista = Array.isArray(j) ? j : (j && Array.isArray(j.actions) ? j.actions : null);
    if (!lista) return bloco;
    const fica = lista.filter((a) => !_ehConclusaoDePix(a));
    if (fica.length === lista.length) return bloco;
    tirados += lista.length - fica.length;
    if (!fica.length) return '';
    return `<<TASK_UPDATE>>${JSON.stringify(Array.isArray(j) ? fica : { ...j, actions: fica })}<<END>>`;
  });
  return { reply: tirados ? out.replace(/\n{3,}/g, '\n\n').trim() : texto, tirados };
}

module.exports = {
  MARCADOR_LISTA, falaDePix, talvezAvisoDePix, lerRespostaPorNumero, blocoPixDM, atenderMarkersListaPixDM,
  resolverPixDoTurno, hintDoResultado, tirarConclusaoDePix,
};

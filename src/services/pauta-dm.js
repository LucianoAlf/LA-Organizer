'use strict';
// pauta-dm.js — a pauta de anamnese/contrato DE HOJE no 1:1 (DM), com a MESMA fonte da pauta do
// grupo.
//
// O CASO (Mayra, ADM CG, 30/09 08:32 BRT): "Tom, me manda a lista de anamneses pendentes de hoje"
// -> "Só essas duas por enquanto 👍". A pauta do grupo das 06:00 tinha 36. O bom dia dela, da Ana,
// do Clayton e do Jereh também disse "2 anamneses de hoje".
// RAIZ: o <<SITUACAO_ALUNO>> e a leitura da fonte (get_situacao_alunos_v1 + calendário do dia) só
// existiam no motor do GRUPO. No 1:1 o TOM via as filhas "HH:MM Anamnese — …" que cabiam no recorte
// de 12 tarefas de grupo do prompt (system.js, `.limit(24)` + `.slice(0, 12)`, ordenado por prazo —
// as 2 escaladas da 4ª semana entravam, as outras 34 não) e CONTAVA A AMOSTRA.
//
// O CONSERTO, sem lógica nova:
//   - quem tem aula hoje e está pendente = rituals/anamnese-pauta.pendenciasDoDia, que é a conta
//     da montagem das 06:00 (filtrarPorRecorte + rosterDoDia + pautaDoDiaPeloRoster), lida agora;
//   - a unidade = a do GRUPO de que a pessoa é membro (work_groups.la_report_unidade_id, o mesmo
//     vínculo que o motor do grupo usa) e, quando ela PERGUNTA, também collaborators.unit;
//   - a lista sai pelo MESMO marcador do grupo, <<SITUACAO_ALUNO>>, e quem escreve os nomes é o
//     CÓDIGO (arrumação por horário da pauta: pura.linhasPorHora). O LLM só dá o número.
//   - as filhas saem do recorte de tarefas do 1:1 (system.js, pura.ehFilhaDaPauta): amostra
//     cortada não pode mais virar contagem.

const situ = require('./situacao-aluno');
const pura = require('./anamnese-pauta');

// Ordem fixa de exibição — a mesma do PIX (pix-consulta-fontes.ORDEM_UNIDADES): CG, Recreio, Barra.
const ORDEM_UNIDADES = ['campo grande', 'recreio', 'barra'].map((a) => situ.resolverUnidade(a));

// collaborators.unit vem como 'campo_grande' | 'barra' | 'recreio' | 'all' | null.
function unidadeDoCadastro(unit) {
  const s = String(unit || '').replace(/_/g, ' ').trim();
  if (!s || s === 'all') return null;
  return situ.resolverUnidade(s);
}

// -> [unidadeId] na ORDEM_UNIDADES. `incluirCadastro`: quando a pessoa PERGUNTA, a unidade do
// cadastro também vale; no bom dia, só os grupos (é a "pendência dos grupos" que o briefing já
// mostrava — professor com unit='barra' não passa a receber pauta de anamnese no bom dia).
async function unidadesDoColaborador({ supabase, collab, incluirCadastro = false }) {
  const ids = new Set();
  try {
    const { data: mem, error } = await supabase.from('work_group_members')
      .select('group_id').eq('collaborator_id', collab.id);
    if (!error && mem && mem.length) {
      const { data: gs, error: e2 } = await supabase.from('work_groups')
        .select('la_report_unidade_id').in('id', mem.map((m) => m.group_id))
        .eq('active', true).not('la_report_unidade_id', 'is', null);
      if (!e2) for (const g of gs || []) ids.add(g.la_report_unidade_id);
    }
  } catch (_) { /* sem grupo: segue só com o cadastro */ }
  if (incluirCadastro) {
    const u = unidadeDoCadastro(collab && collab.unit);
    if (u) ids.add(u);
  }
  return ORDEM_UNIDADES.filter((id) => ids.has(id));
}

// GATE BARATO: sem o assunto na fala, nenhuma leitura. "pauta" sozinha também abre (é como a
// equipe chama a lista do dia).
function falaDeAnamneseOuContrato(texto) {
  const t = String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return /\banamnese|\bcontrato|\bpauta\b/.test(t);
}

// Cache curto: o número do prompt e a lista do marcador, no MESMO turno, têm que sair da MESMA
// foto — senão o TOM diz 26 e a lista traz 25. Também junta os bons-dias do mesmo tick do cron.
const TTL_MS = 3 * 60 * 1000;
const _cache = new Map();
function _limparCache() { _cache.clear(); }

async function lerPautaDaUnidade({ laReport, unidadeId, hoje, deps = {}, agora = Date.now() }) {
  const chave = `${unidadeId}:${hoje}`;
  const c = _cache.get(chave);
  if (c && agora - c.em < TTL_MS) return c.valor;
  const ler = deps.pendenciasDoDia || require('../rituals/anamnese-pauta').pendenciasDoDia;
  let valor;
  try {
    valor = await ler({ laReport, unidadeId, hoje });
  } catch (e) {
    valor = { anamnese: null, contrato: null, totalUnidade: null, motivo: (e && e.message) || String(e) };
  }
  valor = { ...valor, unidadeId, unidadeNome: situ.nomeDaUnidade(unidadeId) };
  // Falha não fica em cache: a próxima pergunta tenta a fonte de novo.
  if (!valor.motivo) _cache.set(chave, { em: agora, valor });
  return valor;
}

async function lerPautaDasUnidades({ laReport, unidadeIds, hoje, deps = {} }) {
  const out = [];
  for (const unidadeId of unidadeIds || []) {
    // eslint-disable-next-line no-await-in-loop -- ordem importa (CG, Recreio, Barra)
    out.push(await lerPautaDaUnidade({ laReport, unidadeId, hoje, deps }));
  }
  return out;
}

function _dataBr(hoje) {
  const [, m, d] = String(hoje || '').split('-');
  return d && m ? `${d}/${m}` : '';
}

const _alunos = (n) => `${n} aluno${n === 1 ? '' : 's'}`;

// ── BLOCO DO PROMPT (números) ─────────────────────────────────────────────────────────────────
// Mesmo espírito do blocoDeNumeros do grupo (pix-consulta.js): fonte que caiu vira linha DIZENDO
// isso, nunca um número; o total da unidade vai rotulado como NÃO sendo a pauta de hoje.
function blocoDaPautaDM({ porUnidade, hoje, ritual = false }) {
  const L = [`## 📋 PAUTA DE HOJE (${_dataBr(hoje)}) — ANAMNESE E CONTRATO · fonte: LA Report, a MESMA conta da pauta dos grupos, lida agora`];
  for (const u of porUnidade || []) {
    if (u.motivo || !u.anamnese) {
      L.push(`• ${u.unidadeNome}: NÃO CONSEGUI LER a fonte agora — não afirme número de anamnese/contrato dessa unidade.`);
      continue;
    }
    L.push(`• ${u.unidadeNome}: ${_alunos(u.anamnese.length)} com aula hoje ainda sem anamnese · ${_alunos((u.contrato || []).length)} sem contrato assinado`);
    if (u.totalUnidade) {
      L.push(`  (total da unidade, NÃO é a pauta de hoje: ${u.totalUnidade.anamnese} sem anamnese e ${u.totalUnidade.contrato} sem contrato, de ${u.totalUnidade.alunos} alunos ativos)`);
    }
  }
  L.push('REGRAS:');
  L.push('- Número de anamnese/contrato "de hoje" = SOMENTE os números acima, por unidade. NUNCA conte tarefas "HH:MM Anamnese — …" nem qualquer tarefa de grupo pra chegar nesse número.');
  if (ritual) {
    L.push('- No bom dia: UMA linha por unidade com o número de hoje (ex.: "📋 26 anamneses pendentes hoje no Campo Grande"). Sem nomes, sem marcador — quem quiser a lista pede.');
  } else {
    L.push('- Se pedirem os NOMES/a lista de hoje, escreva UMA linha curta de abertura e emita <<SITUACAO_ALUNO>>{"recorte":"anamnese|contrato|tudo","hoje":true,"unidade":"campo grande|recreio|barra"}<<END>> — o sistema escreve a lista organizada por horário. NÃO escreva os nomes você mesmo.');
    L.push('- Lista da unidade INTEIRA (não só quem tem aula hoje): o mesmo marcador com "hoje":false.');
  }
  return L.join('\n');
}

// ── A LISTA (o código escreve os nomes) ───────────────────────────────────────────────────────
// Organizada pro WhatsApp: título → resumo → seções → itens. As seções usam a arrumação por
// horário da pauta do grupo (pura.linhasPorHora), então a lista do 1:1 tem a mesma cara.
const SECOES = [
  { chave: 'anamnese', titulo: '📋 *Anamnese*', vazio: 'ninguém com aula hoje está sem anamnese ✅', resumo: (n) => `${_alunos(n)} sem anamnese` },
  { chave: 'contrato', titulo: '✍️ *Contrato*', vazio: 'ninguém com aula hoje está sem contrato assinado ✅', resumo: (n) => `${_alunos(n)} sem contrato assinado` },
];

function renderPautaDM({ unidadeNome, hoje, anamnese, contrato, motivo, recorte = 'tudo' }) {
  const titulo = `🗓️ *Pauta de hoje — ${unidadeNome} (${_dataBr(hoje)})*`;
  if (motivo || !anamnese) {
    return `${titulo}\nNão consegui ler a fonte agora — não vou chutar número. Me pede de novo daqui a pouco.`;
  }
  const listas = { anamnese: anamnese || [], contrato: contrato || [] };
  const secoes = SECOES.filter((s) => recorte === 'tudo' || recorte === s.chave);
  const resumo = `Com aula hoje: ${secoes.map((s) => s.resumo(listas[s.chave].length)).join(' · ')}`;
  const blocos = secoes.map((s) => {
    const l = listas[s.chave];
    if (!l.length) return `${s.titulo} — ${s.vazio}`;
    return `${s.titulo} (${l.length})\n${pura.linhasPorHora(l, l.length)}`;
  });
  return `${titulo}\n${resumo}\n\n${blocos.join('\n\n')}`;
}

// ── O MARCADOR <<SITUACAO_ALUNO>> NO 1:1 ─────────────────────────────────────────────────────
// Unidade dita no marcador vence; sem ela, as unidades da pessoa; sem nenhuma, as três.
// "hoje":false com recorte anamnese/contrato = a unidade inteira, pelo MESMO caminho da lista do
// grupo (pix-consulta-fontes.mensagensDaListaPix). Recorte que o 1:1 não atende (ficha, foto,
// instagram…) vira uma linha honesta — nunca o marcador cru no WhatsApp.
const RE_MARKER = /<<SITUACAO_ALUNO>>([\s\S]*?)<<END>>/gi;
const TETO_MARCADORES = 3;

function _recorteDoMarcador(r) {
  const v = String(r || '').trim().toLowerCase();
  if (v === 'anamnese' || v === 'contrato') return v;
  if (!v || v === 'tudo' || v === 'resumo') return 'tudo';
  return null; // ficha/foto/instagram/comunidade/telefone: não é do 1:1
}

async function atenderMarkersPautaDM({ reply, laReport, unidadeIds = [], hoje, deps = {} }) {
  const texto = String(reply == null ? '' : reply);
  const brutos = Array.from(texto.matchAll(RE_MARKER)).map((m) => m[1]);
  if (!brutos.length) return { reply: texto, atendidos: 0, falhas: 0 };
  const partes = [];
  let falhas = 0;
  for (const bruto of brutos.slice(0, TETO_MARCADORES)) {
    let p = {};
    try { p = JSON.parse(String(bruto).trim()) || {}; } catch (_) { p = {}; }
    const recorte = _recorteDoMarcador(p.recorte);
    if (!recorte) {
      partes.push('Essa consulta (ficha, foto, Instagram, comunidade) eu faço no grupo da unidade — lá eu mando o card completo.');
      continue;
    }
    const citada = situ.resolverUnidade(p.unidade);
    const alvos = citada ? [citada] : (unidadeIds.length ? unidadeIds : ORDEM_UNIDADES);
    const hojeSo = p.hoje !== false;
    for (const unidadeId of alvos) {
      const unidadeNome = situ.nomeDaUnidade(unidadeId);
      if (hojeSo) {
        // eslint-disable-next-line no-await-in-loop
        const u = await lerPautaDaUnidade({ laReport, unidadeId, hoje, deps });
        if (u.motivo) falhas++;
        partes.push(renderPautaDM({ ...u, unidadeNome, hoje, recorte }));
      } else {
        const alvosLista = recorte === 'tudo' ? ['anamnese', 'contrato'] : [recorte];
        try {
          const f = deps.mensagensDaListaPix || require('./pix-consulta-fontes').mensagensDaListaPix;
          // eslint-disable-next-line no-await-in-loop
          const { msgs } = await f({ laReport, unidadeId, unidadeNome, alvos: alvosLista, deps });
          partes.push(msgs.join('\n\n'));
        } catch (e) {
          falhas++;
          partes.push(`A lista de ${unidadeNome} eu não consegui ler agora — me pede de novo daqui a pouco.`);
        }
      }
    }
  }
  if (brutos.length > TETO_MARCADORES) partes.push('Mandei as primeiras listas — me pede as outras que eu puxo.');
  // A lista entra ONDE o primeiro marcador estava (depois da linha de abertura do TOM); os demais
  // marcadores somem.
  let primeiro = true;
  const out = texto.replace(RE_MARKER, () => {
    if (!primeiro) return '';
    primeiro = false;
    return `\n\n${partes.join('\n\n')}\n\n`;
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { reply: out, atendidos: brutos.length, falhas };
}

module.exports = {
  ORDEM_UNIDADES, unidadeDoCadastro, unidadesDoColaborador, falaDeAnamneseOuContrato,
  lerPautaDaUnidade, lerPautaDasUnidades, blocoDaPautaDM, renderPautaDM, atenderMarkersPautaDM,
  _limparCache,
};

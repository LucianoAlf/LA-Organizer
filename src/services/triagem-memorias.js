'use strict';
// triagem-memorias.js — tira da fila as memórias que REPETEM o que já existe, antes do Alf ver.
//
// O CASO (24/09). A fila das 07:30 chegou com 16 itens e 4 pares repetidos (reply-quote, guard de
// honestidade ×2, predicado de janela): a memória pendente de ontem nascia de novo hoje com outras
// palavras. Duas raízes: (1) a consolidação das 03h só conhece as memórias ATIVAS — a pendente e a
// recusada ficam invisíveis e renascem; (2) o dedup por palavras (Jaccard) não pega paráfrase.
// A Maria já resolve isso (corretor/aprovacao/triar_cobertura.py, 18/09): o Alf quer o mesmo aqui —
// "ele olha pro histórico, vê que é igual à outra e já descarta; só traz o que é diferente".
//
// COMO (mesmo desenho da Maria, medido antes de escrever):
//   1. VIZINHOS POR SENTIDO: o embedding que toda memória já grava separa bem o óbvio, mas NÃO
//      decide sozinho — medido em 24/09: duplicatas reais 0,76–0,82 e um par DIFERENTE e
//      complementar ("CNPJ desativado em 01/10" × "CNPJ segue pro passaporte") em 0,768. Por isso
//      o vetor só escolhe quem comparar (≥ 0,60, até 5), nunca descarta.
//   2. O MODELO APONTA a fonte e o grau (igual / complementa / diferente) e COPIA o trecho.
//   3. O CÓDIGO SÓ ACEITA "igual" com trecho de ≥ 12 caracteres ACHADO na fonte apontada. Sem
//      isso, "parece a mesma coisa" do modelo viraria memória boa jogada fora.
// Fontes: ativas (de qualquer data), pendentes MAIS ANTIGAS (a mais velha fica) e recusadas nos
// últimos 90 dias (a recusada não volta pela porta dos fundos). Mesmo grupo ou escopo 'tom'.
// Falha-aberta: modelo fora ou resposta torta = a memória FICA na fila (nunca some por erro).
// Descarte = o mesmo patch do "descarta N" do WhatsApp (is_active false + approved_at) e uma linha
// em marker_logs (MEMORY_TRIAGE) dizendo com qual fonte ela bateu.

const SIM_MINIMA = 0.60;
const MAX_VIZINHOS = 5;
const TETO_POR_RODADA = 10;
const TRECHO_MIN = 12;
const JANELA_RECUSADAS_DIAS = 90;

function _vetor(e) {
  if (Array.isArray(e)) return e.map(Number);
  if (typeof e === 'string' && e.trim().startsWith('[')) { try { return JSON.parse(e).map(Number); } catch (_) { return null; } }
  return null;
}
function similaridade(a, b) {
  const x = _vetor(a); const y = _vetor(b);
  if (!x || !y || x.length !== y.length || !x.length) return 0;
  let p = 0; let nx = 0; let ny = 0;
  for (let i = 0; i < x.length; i++) { p += x[i] * y[i]; nx += x[i] * x[i]; ny += y[i] * y[i]; }
  return nx && ny ? p / Math.sqrt(nx * ny) : 0;
}
function estadoDa(m) {
  if (m.is_active) return 'ativa';
  return m.approved_at ? 'recusada' : 'esperando';
}
function _mesmoAlcance(c, m) {
  return m.scope === 'tom' || c.scope === 'tom' || (c.group_id && m.group_id === c.group_id);
}

/** Até MAX_VIZINHOS memórias do acervo parecidas com a candidata (PURA). */
function vizinhosPorSentido(cand, acervo, { minSim = SIM_MINIMA, max = MAX_VIZINHOS } = {}) {
  const out = [];
  for (const m of acervo || []) {
    if (!m || m.id === cand.id || !_mesmoAlcance(cand, m)) continue;
    const est = estadoDa(m);
    // Entre duas pendentes, fica a MAIS ANTIGA: a nova é que é comparada contra a velha.
    if (est === 'esperando' && !(String(m.created_at) < String(cand.created_at))) continue;
    const sim = similaridade(cand.embedding, m.embedding);
    if (sim >= minSim) out.push({ ...m, estado: est, sim });
  }
  return out.sort((a, b) => b.sim - a.sim).slice(0, max);
}

function _norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Só aceita "igual" + trecho copiado que EXISTE na fonte apontada (PURA). -> fonte | null */
function aceitarVeredito(v, vizinhos) {
  if (!v || v.grau !== 'igual' || !v.fonte) return null;
  const rotulo = String(v.fonte).trim().toUpperCase();
  const i = Number((rotulo.match(/^F(\d+)$/) || [])[1]) - 1;
  const fonte = Number.isInteger(i) && i >= 0 ? (vizinhos || [])[i] : null;
  if (!fonte) return null;
  const trecho = _norm(v.trecho);
  if (trecho.length < TRECHO_MIN) return null;
  return _norm(fonte.content).includes(trecho) ? fonte : null;
}

function _lerJson(txt) {
  const s = String(txt == null ? '' : txt);
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

const PROMPT = [
  'Você compara UMA memória candidata do assistente TOM com memórias que já existem.',
  'Responda SÓ com JSON: {"fonte":"F1|F2|...|null","grau":"igual|complementa|diferente","trecho":"<trecho COPIADO literalmente da fonte>"}',
  'A pergunta é UMA: aprovar a candidata mudaria o que o TOM FAZ ou SABE, além do que a fonte já muda?',
  '"igual" = não mudaria nada: mesma regra ou mesmo fato, ainda que com outras palavras. Exemplo a mais, caso citado, justificativa ("porque", "caso concreto", "medição de tal dia") ou redação mais longa NÃO tornam a candidata nova.',
  '"complementa"/"diferente" = traz algo que muda o comportamento ou o conhecimento: outro número, outra data, outro estado, uma exceção, outra pessoa, outra regra.',
  'Compare também o "o que muda no TOM" das duas quando houver. Na dúvida real, "diferente". O "trecho" é copiado letra por letra da fonte escolhida.',
].join('\n');

function _mensagem(cand, vizinhos) {
  const linhas = [`CANDIDATA: ${cand.content}`];
  if (cand.efeito) linhas.push(`(o que muda no TOM: ${cand.efeito})`);
  linhas.push('', 'MEMÓRIAS QUE JÁ EXISTEM:');
  vizinhos.forEach((v, i) => linhas.push(`F${i + 1} [${v.estado}]: ${v.content}${v.efeito ? ` (o que muda no TOM: ${v.efeito})` : ''}`));
  return linhas.join('\n');
}

async function carregarAcervo(sb, { agora = Date.now() } = {}) {
  const desde = new Date(agora - JANELA_RECUSADAS_DIAS * 86400000).toISOString();
  const campos = 'id, group_id, scope, content, efeito, embedding, is_active, approved_at, created_at';
  const [ativas, outras] = await Promise.all([
    sb.from('group_memory').select(campos).eq('is_active', true).limit(1000),
    sb.from('group_memory').select(campos).eq('is_active', false).gte('created_at', desde).limit(1000),
  ]);
  if (ativas.error || outras.error) throw new Error(`acervo: ${(ativas.error || outras.error).message}`);
  return [...(ativas.data || []), ...(outras.data || [])];
}

/**
 * Tira da fila as repetidas. `pendentes` = itens da fila (com id). Devolve
 * { ficam: [...pendentes que continuam], tiradas: [{ id, fonteId, fonteEstado }], cegas }.
 * Nunca lança: falha geral devolve a fila intacta.
 */
async function triarFila(sb, pendentes, { chat, teto = TETO_POR_RODADA, aplicar = true, agora = Date.now() } = {}) {
  const lista = pendentes || [];
  const intacta = { ficam: lista, tiradas: [], cegas: 0 };
  if (!lista.length || typeof chat !== 'function') return intacta;
  let acervo;
  try { acervo = await carregarAcervo(sb, { agora }); } catch (e) {
    console.warn('[TriagemMemorias] acervo não carregou (fila segue intacta):', e.message);
    return intacta;
  }
  const porId = new Map(acervo.map((m) => [m.id, m]));
  const tiradas = [];
  const fora = new Set();
  let cegas = 0;
  // A mais NOVA é julgada primeiro contra as mais velhas — a velha é que fica.
  const ordem = [...lista].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  for (const p of ordem) {
    if (tiradas.length >= teto) break;
    const cand = porId.get(p.id) || p;
    const viz = vizinhosPorSentido(cand, acervo.filter((m) => !fora.has(m.id)));
    if (!viz.length) continue;
    let fonte = null;
    try {
      const r = await chat(PROMPT, [{ role: 'user', content: _mensagem(cand, viz) }], 400);
      const v = _lerJson(r && r.text);
      if (!v) { cegas++; continue; }
      fonte = aceitarVeredito(v, viz);
    } catch (e) { cegas++; continue; }
    if (!fonte) continue;
    if (aplicar) {
      const { error } = await sb.from('group_memory').update({ is_active: false, approved_at: new Date(agora).toISOString() }).eq('id', p.id);
      if (error) { console.warn('[TriagemMemorias] não consegui tirar', p.id, error.message); continue; }
      try {
        await sb.from('marker_logs').insert({
          marker_type: 'MEMORY_TRIAGE', result: 'executed',
          reason: `repetida:${String(p.id).slice(0, 8)} igual a ${String(fonte.id).slice(0, 8)} (${fonte.estado})`,
          raw_excerpt: String(cand.content || '').slice(0, 300),
        });
      } catch (_) { /* o registro é best-effort; o descarte já aconteceu */ }
    }
    fora.add(p.id);
    tiradas.push({ id: p.id, fonteId: fonte.id, fonteEstado: fonte.estado, sim: fonte.sim });
  }
  return { ficam: lista.filter((p) => !fora.has(p.id)), tiradas, cegas };
}

/** Linha do topo da lista das 07:30 (vazia quando nada foi tirado). */
function linhaDaTriagem({ tiradas = [], cegas = 0 } = {}) {
  const partes = [];
  if (tiradas.length) {
    const recusadas = tiradas.filter((t) => t.fonteEstado === 'recusada').length;
    partes.push(`🧹 Tirei ${tiradas.length} repetida${tiradas.length === 1 ? '' : 's'} — ${tiradas.length === 1 ? 'dizia' : 'diziam'} o mesmo que outra memória${recusadas ? ` (${recusadas} igual a uma que você já recusou)` : ''}.`);
  }
  if (cegas) partes.push(`_Não consegui conferir ${cegas} contra o histórico — ficaram na lista._`);
  return partes.join('\n');
}

module.exports = {
  similaridade, vizinhosPorSentido, aceitarVeredito, triarFila, linhaDaTriagem, carregarAcervo,
  SIM_MINIMA, TETO_POR_RODADA, TRECHO_MIN, PROMPT,
};

'use strict';
// ops-digest.js — o TOM leva os achados da auditoria ao grupo de ops SEM ninguém pedir.
//
// O buraco que isto fecha: `auditConversation` roda junto do Dream (03h), grava em
// `tom_audit_findings` e para ali. Ninguém abre a tabela. Foi assim que 209 achados ficaram
// parados sem nunca terem sido lidos.
//
// POR QUE DETERMINÍSTICO E NÃO PELO AGENTE
// Contagem e lista saem de SQL, não de LLM. Resumo de números é onde nasce confabulação, e um
// alarme diário que erra uma vez deixa de ser lido — perde-se o canal inteiro. O agente Opus 5
// segue disponível no mesmo grupo pra aprofundar sob demanda ("abre o #2 pra mim").
//
// A triagem (`finding-triage`) já rodou às 05h no health-check, então aqui o `auto_triage` está
// pronto: `suppress` = já corrigido antes do incidente (só conta), `regression` = voltou depois
// de um fix (vai pro topo, é o que mais dói).

const { entregar } = require('../lib/entrega');

const TETO_PADRAO = 5;        // itens listados; acima disso o digest diz quantos ficaram
const MAX_LITERAL = 120;      // a fala real, cortada pra caber numa linha de celular
const JANELA_HORAS = 24;      // mesma janela do Dream que gerou os achados

const CATEGORIAS = {
  dropped_request: 'pedido ignorado',
  frustration: 'frustração',
  confabulation: 'confabulação',
  wrong_refusal: 'recusa indevida',
  proactive_overreach: 'proatividade fora de hora',
  media_fail: 'falha de mídia',
};

const PESO_SEVERIDADE = { alto: 0, medio: 1, baixo: 2 };

function traduzCategoria(cat) {
  if (!cat) return 'sem categoria';
  return CATEGORIAS[cat] || String(cat).replace(/_/g, ' ');
}

/**
 * Puxa a FALA da evidência — não o resumo. O resumo é o que o auditor entendeu; a fala é o
 * que a pessoa escreveu, e já aconteceu de os dois discordarem (o resumo dizia "Confirmado",
 * ela tinha escrito "Siim"). Quando a evidência vem com transcrição, o primeiro turno do
 * USUÁRIO é o pedido original — é ele que importa.
 */
function extrairFala(evidence, max = MAX_LITERAL) {
  if (typeof evidence !== 'string') return { quem: null, texto: '' };
  const marcado = /USU[ÁA]RIO:\s*([^\n]+)/i.exec(evidence);
  let s = marcado ? marcado[1] : (evidence.split('\n').map((x) => x.trim()).find(Boolean) || '');

  // A evidência às vezes vem crua da transcrição: "[05/08 (qua) 13:15] TOM: Fechou...".
  // O timestamp já está na linha de cima do digest, e o rótulo do falante vira campo próprio —
  // saber se quem falou foi o TOM ou a pessoa é a informação central num achado de confabulação.
  s = s.replace(/^\[[^\]]*\]\s*/, '');
  let quem = null;
  const rotulo = /^(TOM|USU[ÁA]RIO)\s*:\s*/i.exec(s);
  if (rotulo) {
    if (/^tom$/i.test(rotulo[1])) quem = 'TOM';
    s = s.slice(rotulo[0].length);
  }

  // Tira `*` e crase que vêm grudados; `_` fica, que é itálico legítimo no WhatsApp e também
  // aparece em nome de coluna do banco. O "..." inicial é sobra de recorte da transcrição.
  s = s.replace(/^\.{2,}\s*/, '').replace(/[*`~]/g, '').replace(/\s+/g, ' ').trim();
  return { quem, texto: s.length > max ? `${s.slice(0, max).trimEnd()}…` : s };
}

function extrairLiteral(evidence, max = MAX_LITERAL) {
  return extrairFala(evidence, max).texto;
}

function ordena(a, b) {
  const sa = PESO_SEVERIDADE[a.severidade] != null ? PESO_SEVERIDADE[a.severidade] : 1;
  const sb = PESO_SEVERIDADE[b.severidade] != null ? PESO_SEVERIDADE[b.severidade] : 1;
  return sa - sb;
}

function linhaAchado(a) {
  const marcador = a.regressao ? '🔴' : '🆕';
  // O negrito vai no código quando o achado já virou known-issue (é a chave que se procura no
  // histórico); senão vai na categoria, pra não repetir a mesma informação duas vezes.
  const titulo = a.codigo || traduzCategoria(a.categoria);
  const quem = [a.pessoa, a.quando].filter(Boolean).join(', ');
  const linhas = [`${marcador} *${titulo}* — ${quem}`];
  if (a.literal) linhas.push(`${a.falaDe ? `${a.falaDe}: ` : ''}"${a.literal}"`);
  const rodape = [
    a.codigo ? traduzCategoria(a.categoria) : null,
    a.regressao ? 'voltou depois de corrigido' : null,
  ].filter(Boolean);
  if (rodape.length) linhas.push(rodape.join(' · '));
  return linhas.join('\n');
}

/** Monta o texto do digest. Pura: sem banco, sem LLM, sem relógio. */
function formatarDigest({ dataLabel, achados = [], suprimidos = 0, teto = TETO_PADRAO }) {
  const total = achados.length;
  if (!total) {
    const cauda = suprimidos > 0 ? ` (${suprimidos} já corrigido${suprimidos > 1 ? 's' : ''} antes)` : '';
    return `✅ *Auditoria de ${dataLabel}* — nada novo${cauda}.`;
  }

  const regressoes = achados.filter((a) => a.regressao).sort(ordena);
  const novos = achados.filter((a) => !a.regressao).sort(ordena);

  // Regressão nunca é cortada: é o único tipo que prova que um fix não pegou.
  const espaco = Math.max(1, teto - regressoes.length);
  const mostrados = novos.slice(0, espaco);
  const cortados = novos.length - mostrados.length;

  const qtdReg = regressoes.length;
  const cabecalho = `🔍 *Auditoria de ${dataLabel}* — ${total} achado${total > 1 ? 's' : ''}`
    + (qtdReg ? `, ${qtdReg} regress${qtdReg > 1 ? 'ões' : 'ão'}.` : '.');

  const blocos = [cabecalho, ...[...regressoes, ...mostrados].map(linhaAchado)];

  // Cortar é aceitável; cortar calado não — um teto silencioso faz o digest parecer completo.
  const rodape = [];
  if (cortados > 0) rodape.push(`+${cortados} não listado${cortados > 1 ? 's' : ''} — pede que eu abro.`);
  if (suprimidos > 0) rodape.push(`${suprimidos} suprimido${suprimidos > 1 ? 's' : ''}: já corrigido${suprimidos > 1 ? 's' : ''} antes do incidente.`);
  if (rodape.length) blocos.push(`_${rodape.join(' ')}_`);

  return blocos.join('\n\n');
}

// ── I/O ────────────────────────────────────────────────────────────────────────────────────

// Hora em BRT via Intl. NUNCA por toISOString().slice(): depois das 21h o UTC já virou o dia
// e o achado apareceria com a data de amanhã.
const FMT_BRT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function horaBrt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(FMT_BRT.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/** Lê a janela e devolve {achados, suprimidos} já no formato do formatador. Nunca lança. */
async function carregarDigest(sb, { horas = JANELA_HORAS } = {}) {
  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
  const { data, error } = await sb.from('tom_audit_findings')
    .select('category, severity, summary, evidence, incident_at, last_seen, promoted_code, auto_triage, collaborators(preferred_name, full_name)')
    .in('status', ['novo', 'confirmado'])
    .gte('last_seen', desde)
    .order('incident_at', { ascending: false });
  if (error) throw new Error(`carregarDigest: ${error.message}`);

  const linhas = data || [];
  const suprimidos = linhas.filter((f) => (f.auto_triage || {}).decision === 'suppress').length;
  const achados = linhas
    .filter((f) => (f.auto_triage || {}).decision !== 'suppress')
    .map((f) => {
      const fala = extrairFala(f.evidence);
      return {
      categoria: f.category,
      severidade: f.severity,
      // preferred_name vem NULL em boa parte das fichas — sem o fallback o digest imprimia
      // "null" no lugar da pessoa.
      pessoa: (f.collaborators || {}).preferred_name
        || ((f.collaborators || {}).full_name || '').split(' ')[0] || null,
      quando: horaBrt(f.incident_at || f.last_seen),
      literal: fala.texto,
      falaDe: fala.quem,
      regressao: (f.auto_triage || {}).decision === 'regression',
      codigo: f.promoted_code || null,
      };
    });
  return { achados, suprimidos };
}

// Liga junto com o canal de ops; `TOM_OPS_DIGEST=0` desliga só o envio automático e mantém
// o agente respondendo sob demanda.
const DIGEST_ON = process.env.TOM_OPS_DIGEST !== '0';
// Idempotência em `ritual_logs` precisa de um collaborator_id. O digest é do grupo, então usa
// o dono do canal (primeiro da allowlist) como âncora — mesmo padrão do health_report.
const DIGEST_OWNER = (process.env.TOM_OPS_ALLOWLIST || '').split(',')[0].trim();

/** '2026-08-08' → '08/08'. Fatia string, nunca Date: montar Date de YMD desloca o dia. */
function labelDia(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}/${m[2]}` : String(ymd || '');
}

/**
 * Monta e entrega o digest no grupo. `postar` é injetado pelo dispatcher (evita ciclo de
 * require com o group-chat-engine e deixa o envio testável).
 * Só grava o log com a entrega CONFIRMADA — `postar` resolvendo com valor truthy, ver
 * src/lib/entrega.js. Se o envio falhar, o próximo tick da janela retenta.
 */
async function enviarOpsDigest(sb, {
  postar, ymd, force = false, horas = JANELA_HORAS, ownerId = DIGEST_OWNER,
} = {}) {
  if (!DIGEST_ON) return { enviado: false, motivo: 'desligado' };
  if (typeof postar !== 'function') return { enviado: false, motivo: 'sem canal de envio' };
  if (!ownerId) return { enviado: false, motivo: 'sem owner para idempotência' };

  if (!force) {
    const { data: ja } = await sb.from('ritual_logs').select('id')
      .eq('collaborator_id', ownerId).eq('ritual_type', 'ops_digest')
      .eq('reference_date', ymd).eq('status', 'sent').limit(1);
    if (ja && ja.length) return { enviado: false, motivo: 'já entregue hoje' };
  }

  const { achados, suprimidos } = await carregarDigest(sb, { horas });
  await entregar(postar, formatarDigest({ dataLabel: labelDia(ymd), achados, suprimidos }),
    'o digest de auditoria');
  await sb.from('ritual_logs').insert({
    collaborator_id: ownerId, ritual_type: 'ops_digest', reference_date: ymd,
    status: 'sent', sent_at: new Date().toISOString(),
    detail: `achados=${achados.length} suprimidos=${suprimidos}`,
  });
  return { enviado: true, achados: achados.length, suprimidos };
}

module.exports = {
  formatarDigest, extrairLiteral, extrairFala, traduzCategoria, horaBrt, carregarDigest,
  enviarOpsDigest, labelDia, TETO_PADRAO, JANELA_HORAS,
};

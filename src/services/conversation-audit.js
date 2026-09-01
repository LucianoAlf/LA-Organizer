// src/services/conversation-audit.js
// Auditoria de Qualidade de Conversa — detecta falhas REAIS do usuário com o TOM
// (confabulação, recusa indevida, mídia falha, pedido largado, frustração) a partir
// da conversa de 24h de cada pessoa. Acoplado ao Dream (03h, dispatcher.js).
// Alta precisão: lista vazia é o resultado normal. Dedupe por assinatura + contador.
// Funções recebem `sb` (supabase) e `chat` (provider) injetados → fáceis de testar.
'use strict';
const crypto = require('crypto');
const qaIsolation = require('./qa-isolation');

const VALID_CATEGORIES = new Set([
  'confabulation', 'wrong_refusal', 'media_fail', 'dropped_request', 'frustration',
  'proactive_overreach',
]);
const VALID_SEVERITY = new Set(['alto', 'medio', 'baixo']);
// Status "fechados": um finding triado como um destes NUNCA deve re-surgir como novo.
const CLOSED_STATUSES = new Set(['resolvido', 'falso_positivo', 'wontfix', 'corrigido']);
const SEV_RANK = { alto: 0, medio: 1, baixo: 2 };

/** Normaliza o resumo pra assinatura: sem acento/pontuação/número, minúsculo, colapsado, 60 chars. */
function normalizeSummary(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Assinatura de dedupe: categoria + colaborador + CHAVE do achado.
 * `chave` ausente = comportamento LEGADO (resumo normalizado) — é o que permite continuar
 * achando as linhas gravadas antes de 19/08. Ver chaveDoAchado. */
function signatureFor(category, collaboratorId, summary, chave = null) {
  const base = chave != null ? chave : normalizeSummary(summary);
  return crypto.createHash('sha1')
    .update(`${category}:${collaboratorId}:${base}`)
    .digest('hex');
}

// AUDIT-SIGNATURE-INSTAVEL (medido 19/08). A assinatura era sha1 do RESUMO — texto LIVRE
// escrito pelo LLM. Bastava ele reescrever a frase ("TOM nao registrou o gasto" vs "O TOM nao
// registrou o gasto") pro achado virar linha NOVA: medido 398 de 399 achados com occurrences=1,
// e falso positivo triado ontem voltando hoje como 🆕. O trabalho de triagem não acumulava —
// esta é a maior fonte isolada do ruído que o dono sente.
//
// A chave passa a ser o INCIDENTE, não a redação:
//   • âncora confiável (incident_confidence 'high') → o created_at exato da mensagem. Duas
//     redações do mesmo incidente colapsam. Normalizado por toISOString porque o Postgres
//     devolve "+00:00" e o JS escreve ".000Z" — comparar string crua não bate.
//   • sem âncora → CONJUNTO DE TOKENS do resumo (ordenado, sem artigo/preposição/dígito),
//     imune a ordem e a reformulação leve. Degrada, não quebra.
const _STOP_CHAVE = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'e', 'que', 'em', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'pra', 'para', 'com', 'por', 'pelo', 'pela',
  'se', 'ele', 'ela', 'seu', 'sua', 'mas', 'foi', 'ser']);

function _normalizarPleno(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Conjunto ordenado de tokens fortes do resumo. "nao" fica (3 chars): negação é o sentido. */
function _resumoTokenSet(s) {
  const toks = _normalizarPleno(s).split(' ').filter((t) => t.length >= 3 && !_STOP_CHAVE.has(t));
  return [...new Set(toks)].sort().join(' ');
}

/** Chave estável do achado — o INCIDENTE quando dá, o sentido do resumo quando não dá. */
function chaveDoAchado(finding) {
  const f = finding || {};
  if (f.incident_confidence === 'high' && f.incident_at) {
    let iso = f.incident_at;
    try { iso = new Date(f.incident_at).toISOString(); } catch (_) {}
    return `at:${iso}`;
  }
  return `rs:${_resumoTokenSet(f.summary)}`;
}

/** Extrai o bloco {...} da saída do LLM e valida cada finding. Nunca lança.
 * fallbackOccurredAt (AUDIT-NO-OCCURRED-AT, 12/06): quando o LLM não devolve occurred_at,
 * usa o timestamp da última msg da janela analisada como proxy — assim o achado tem QUANDO
 * aconteceu e a triagem pode comparar com corrigido_em dos known-issues (auto-supressão). */
function parseFindings(raw, fallbackOccurredAt = null) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return []; }
  const list = Array.isArray(obj && obj.findings) ? obj.findings : [];
  return list.filter(f =>
    f && VALID_CATEGORIES.has(f.category) &&
    typeof f.evidence === 'string' && f.evidence.trim().length > 0 &&
    typeof f.summary === 'string' && f.summary.trim().length > 0,
  ).map(f => ({
    category: f.category,
    severity: VALID_SEVERITY.has(f.severity) ? f.severity : 'medio',
    summary: String(f.summary).slice(0, 200),
    evidence: String(f.evidence).slice(0, 1000),
    occurred_at: f.occurred_at || fallbackOccurredAt || null,
  }));
}

// AUDIT-OUTBOUND-TUDO-VIRA-FALA-DO-TOM (medido 19/08). Todo outbound era rotulado "TOM:", mas
// boa parte do outbound NÃO é fala conversacional do TOM: é AVISO AUTOMÁTICO montado por
// template do engine — lembrete, cobrança de ritual, RSVP de terceiro, devolutiva de delegação,
// repasse de recado. O auditor lia "✅ Ana, o Mayra concluiu a tarefa que você pediu" como o TOM
// afirmando ter feito algo, e fabricava confabulação. É a irmã 1:1 do
// AUDIT-GROUP-OUTRO-AGENTE-VIRA-TOM: lá era outro AGENTE, aqui é outra ORIGEM.
//
// Casar por template é EXATO, não heurístico: estas strings nascem no código (dispatcher e
// internal-api), não da prosa do LLM. Ancoradas em `^` pra não pegar o TOM citando o texto.
// `ref_type` (task/event) cobre os lembretes direto pelo banco.
const AVISO_AUTOMATICO_RE = [
  /^⏰\s*\*?Lembrete/i,                                   // lembrete de tarefa / do grupo
  /^📅\s*\*?Lembrete/i,                                   // lembrete de evento
  /^💰\s*\*?Lembrete/i,                                   // lembrete financeiro
  /^✅\s*\*?[^\n]{1,60}?\*?\s+confirmou presen[çc]a/i,     // RSVP de terceiro
  /^✅\s*[^\n]{1,40}?,\s*[oa]\s+[^\n]{1,40}?\s+concluiu a tarefa que voc[êe] pediu/i, // devolutiva
  /^Boa!\s+[OA]\s+[^\n]{1,40}?\s+respondeu:/i,            // resposta de recado repassada
  /^Oi,\s+[^\n]{1,40}?\s*👋\s*[OA]\s+[^\n]{1,40}?\s+me pediu pra te avisar/i, // recado de terceiro
  /^🔴\s*\*/,                                             // cobrança de atrasada (ritual)
  /^🟠\s*\*/,                                             // cobrança de parada (ritual)
];

/** Quem falou nesta linha: USUÁRIO, TOM (fala dele) ou AVISO AUTOMÁTICO (template do engine). */
function rotuloDaLinha(row) {
  const m = row || {};
  if (m.direction === 'inbound') return 'USUÁRIO';
  if (m.ref_type === 'task' || m.ref_type === 'event') return 'AVISO AUTOMÁTICO';
  const txt = String(m.content || '').trim();
  return AVISO_AUTOMATICO_RE.some((re) => re.test(txt)) ? 'AVISO AUTOMÁTICO' : 'TOM';
}

// AUDIT-ACUSA-SEM-OLHAR-O-BANCO (medido 19/08). O auditor decidia "confabulou" / "largou o
// pedido" SÓ pelo texto do chat, sem nunca perguntar ao banco se a ação existiu. Foi assim que
// nasceu o achado do Anne (18/08): ele afirmou "TOM não resolveu nem encaminhou" enquanto a
// tarefa estava cancelada 53s depois e o recado tinha sido entregue. O veredito já existe e é
// gratuito — `marker_logs` grava, por turno, o que o engine executou ou rejeitou.
//
// A trilha entra INTERCALADA na transcrição, como um terceiro falante. Assim a prova aparece
// exatamente onde o julgamento acontece: logo abaixo do "✅ Cancelei" vem "SISTEMA: TASK_UPDATE
// executed". Bloco separado no fim seria fácil de ignorar; intercalado, não.
// META (LEAK_BLOCKED, PROVIDER, ACTIONABLE_NO_MARKER, CHOKEPOINT) fica de fora: é telemetria
// do guard, não ação de domínio, e só faria barulho.
const _MARKER_META = new Set(['LEAK_BLOCKED', 'UNKNOWN_MARKER_STRIPPED', 'TOOL_CALL_STRIPPED', 'PROVIDER', 'ACTIONABLE_NO_MARKER', 'CHOKEPOINT']);

/** Linhas SISTEMA a partir de marker_logs. Pura. */
function linhasDeMarkers(markerRows, stamp) {
  return (Array.isArray(markerRows) ? markerRows : [])
    .filter((m) => m && m.marker_type && !_MARKER_META.has(m.marker_type)
      && (m.result === 'executed' || m.result === 'rejected'))
    .map((m) => ({
      created_at: m.created_at,
      linha: `[${stamp(m.created_at)}] SISTEMA: ${m.marker_type} ${m.result}${m.reason ? ` (${String(m.reason).slice(0, 80)})` : ''}`,
    }));
}

/** Lê a trilha de execução do turno. Falha NUNCA derruba a auditoria — devolve []. */
async function loadMarkerTrail(sb, collaboratorId, sinceIso) {
  try {
    const { data } = await sb.from('marker_logs')
      .select('marker_type, result, reason, created_at')
      .eq('collaborator_id', collaboratorId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(120);
    return data || [];
  } catch (_) { return []; }
}

/** Carrega a conversa (AMBAS direções) das últimas `hours`h e formata em texto. */
// `ateIso` (01/09): fim da janela. Default null = agora, que e o comportamento de sempre.
// Existe pro REPROCESSAMENTO dos dias que a auditoria passou cega (29/08 a 01/09): sem um
// fim, "24h atras" so sabe olhar pro dia de hoje, e um dia perdido fica perdido pra sempre.
async function loadConversation(sb, collaboratorId, hours = 24, ateIso = null) {
  const fimMs = ateIso ? new Date(ateIso).getTime() : Date.now();
  const sinceIso = new Date(fimMs - hours * 3600 * 1000).toISOString();
  // AUDIT-JANELA-CORTA-O-FIM (19/08): era order ASC + limit(300), ou seja as 300 mensagens
  // MAIS ANTIGAS. Num dia cheio o FIM da conversa sumia — e é lá que mora a RESOLUÇÃO. O
  // auditor via o pedido e não via a resposta, e fabricava dropped_request; de quebra, lastAt
  // virava a 300ª msg e envenenava o occurred_at. Pede DESC ao banco (as mais recentes) e
  // reordena em memória, então o corte passa a cair no começo, que é onde ele é inofensivo.
  // O `.lt` so entra QUANDO ha fim de janela: sem ele a cadeia fica identica a de sempre,
  // entao nenhum chamador (nem o mock dos testes) muda de forma por causa do reprocessamento.
  let q = sb.from('conversation_history')
    .select('content, media_extracted_text, direction, created_at, ref_type')
    .eq('collaborator_id', collaboratorId)
    .gte('created_at', sinceIso);
  if (ateIso) q = q.lt('created_at', new Date(fimMs).toISOString());
  const { data } = await q
    .order('created_at', { ascending: false })
    .limit(300);
  // Slice por mensagem subiu 600→1600: o corte em 600 cortava áudios longos no meio
  // e o auditor lia o corte como "áudio do usuário foi cortado" → FALSO POSITIVO de
  // confabulação (caso Fabi 08/06). Inclui transcrição de mídia como fallback.
  // Volta pra ordem cronológica: o banco entregou do mais novo pro mais velho.
  const rows = (data || []).slice().reverse();
  // lastAt: created_at da última msg da janela — vira fallback de occurred_at dos findings.
  const lastAt = rows.length ? rows[rows.length - 1].created_at : null;
  // AUDIT-RELATIVE-DATE-BLIND (02/08, caso Rafinha): o transcript ia SEM nenhuma marca de
  // tempo, então o auditor julgava "hoje/amanhã" contra o dia em que ELE roda (D+1), não
  // contra o dia da conversa. Sábado 01/08 o Rafinha disse "vai ser amanhã", o TOM reagendou
  // certo pra domingo 02/08 — e o auditor, rodando no domingo, acusou "TOM confirmou com a
  // data de hoje". Falso-positivo que vira alarme no relatório do dono. Prefixo [DD/MM (Dia)
  // HH:MM] por linha resolve e ainda dá noção de intervalo entre as falas.
  const _stamp = (iso) => {
    try {
      const f = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(iso));
      const g = (t) => (f.find((p) => p.type === t) || {}).value || '';
      return `${g('day')}/${g('month')} (${g('weekday').replace('.', '')}) ${g('hour')}:${g('minute')}`;
    } catch (_) { return ''; }
  };
  // Conversa + trilha de execução, ordenadas juntas pelo tempo (ver AUDIT-ACUSA-SEM-OLHAR-O-BANCO).
  const _trilha = linhasDeMarkers(await loadMarkerTrail(sb, collaboratorId, sinceIso), _stamp);
  const linhas = rows
    .map(m => ({
      created_at: m.created_at,
      linha: `[${_stamp(m.created_at)}] ${rotuloDaLinha(m)}: ${String(m.content || m.media_extracted_text || '').slice(0, 1600)}`,
    }))
    .concat(_trilha)
    // Ordena por INSTANTE, não por string: o Postgres devolve "+00:00" e outras fontes ".000Z",
    // e comparar o texto cru embaralharia a intercalação (TIMESTAMP-POSTGRES-STRING-COMPARE).
    .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0))
    .map((x) => x.linha);
  // O corte de 24000 chars também cortava a CAUDA (mesmo defeito do limit ASC). Agora descarta
  // do COMEÇO, linha inteira por linha inteira, preservando o fim da conversa.
  let text = linhas.join('\n');
  if (text.length > 24000) {
    let i = 0;
    let tam = text.length;
    while (i < linhas.length - 1 && tam > 24000) { tam -= linhas[i].length + 1; i++; }
    text = linhas.slice(i).join('\n').slice(-24000);
  }
  return { text, lastAt, sinceIso };
}

// ── AUDITORIA DE GRUPO (13/08/2026) ──────────────────────────────────────────────────
// AUDIT-GRUPO-CEGO: até aqui a auditoria lia SÓ `conversation_history`. Todo o trabalho de
// grupo — onde o financeiro vive — ficava fora de qualquer varredura. O caso Rose (10 tarefas
// concluídas erradas no grupo Financeiro em 12/08) nunca poderia ter aparecido no relatório:
// o sensor apontava pro outro lado. Não é falha do agente de governança, é falha do sensor.
//
// A régua é DELIBERADAMENTE a mesma do 1:1 (mesmo prompt, mesmo parseFindings, mesma
// severidade): inventar critério novo pra grupo criaria duas noções de "achado" e tornaria
// os números incomparáveis entre si.

/** Carimbo [DD/MM (dia) HH:MM] em BRT — compartilhado com o transcript 1:1. */
function _stampBrt(iso) {
  try {
    const f = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const g = (t) => (f.find((p) => p.type === t) || {}).value || '';
    return `${g('day')}/${g('month')} (${g('weekday').replace('.', '')}) ${g('hour')}:${g('minute')}`;
  } catch (_) { return ''; }
}

/**
 * Formata mensagens de grupo no mesmo shape do transcript 1:1, com UMA diferença que importa:
 * grupo tem várias pessoas, então cada fala precisa do NOME de quem falou. Sem isso o auditor
 * lê um diálogo embaralhado e erra a atribuição — falso positivo caro.
 *
 * Fala de membro sem `sender_id` (710 das 1633 no banco — GROUPCHAT-SENDER-ID-NULL) vira
 * "alguém do grupo" em vez de sumir: omitir a linha tiraria o PEDIDO do contexto e deixaria
 * o auditor vendo a resposta do TOM sem a pergunta que a gerou.
 *
 * Pura. @param {Array} rows @returns {string}
 */
function formatGroupTranscript(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((m) => {
      if (!m) return null;
      // Ordem: TOM → colaborador cadastrado → nome do WhatsApp → anônimo.
      // wa_sender_name entra ANTES do anônimo porque no grupo "Financeiro" quem responde é a
      // MARIA (outro agente, WhatsApp próprio, sem cadastro em collaborators). Sem ele ela
      // virava "alguém do grupo" e o auditor punha a fala dela na conta do TOM — os achados
      // f2ed069e e 5e1861e0 de 15/08 são isso. Ver AUDIT-GROUP-OUTRO-AGENTE-VIRA-TOM.
      const quem = m.role === 'tom'
        ? 'TOM'
        : ((m.sender && (m.sender.preferred_name || m.sender.full_name))
          || (m.wa_sender_name && String(m.wa_sender_name).trim())
          || 'alguém do grupo');
      const txt = String(m.content || m.media_extracted_text || '').slice(0, 1600);
      if (!txt) return null;
      return `[${_stampBrt(m.created_at)}] ${quem}: ${txt}`;
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 24000);
}

/** Carrega a conversa de um GRUPO das últimas `hours`h, já formatada. */
async function loadGroupConversation(sb, groupId, hours = 24, ateIso = null) {
  const fimMs = ateIso ? new Date(ateIso).getTime() : Date.now();
  const sinceIso = new Date(fimMs - hours * 3600 * 1000).toISOString();
  // `.lt` so entra QUANDO ha fim de janela: sem ele a cadeia fica identica a de sempre.
  let q = sb.from('group_chat_messages')
    .select('content, media_extracted_text, role, created_at, wa_sender_name, sender:collaborators!group_chat_messages_sender_id_fkey(preferred_name, full_name)')
    .eq('group_id', groupId)
    .gte('created_at', sinceIso);
  if (ateIso) q = q.lt('created_at', new Date(fimMs).toISOString());
  const { data } = await q
    .order('created_at', { ascending: true })
    .limit(300);
  const rows = data || [];
  return { text: formatGroupTranscript(rows), lastAt: rows.length ? rows[rows.length - 1].created_at : null, sinceIso };
}

// SENSOR DE CEGUEIRA (01/09). Ate aqui, falha do provedor virava `return []` -- e zero achado
// por FALHA e byte-a-byte identico a zero achado por SAUDE. O gov-runner lia `ate2d: 0` e
// escrevia "nada novo" de boa fe. Foram 4 dias assim (29/08 a 01/09, 20 pessoas na ultima
// noite) sem ninguem notar, porque o silencio se parecia com sucesso.
// Agora toda falha vira LINHA NO BANCO. Nao muda o contrato (segue devolvendo [] e nunca
// lanca), mas passa a existir prova consultavel de que o detector NAO OLHOU.
async function registrarCegueira(sb, alvo, err) {
  try {
    await sb.from('marker_logs').insert({
      marker_type: 'AUDIT',
      result: 'fallback',
      reason: `audit_blind: ${String((err && err.message) || err).slice(0, 90)}`,
      raw_excerpt: `alvo=${String(alvo || '?').slice(0, 80)}`,
    });
  } catch (_) { /* sensor nunca derruba a auditoria */ }
}

// CONFERE O BANCO ANTES DE ACUSAR (01/09, finding bb00609d severidade ALTA). O auditor julgava
// confabulacao pelo MARKER DO TURNO: "nao ha SISTEMA executed para elas". E nao havia -- naquele
// turno. As tres tarefas estavam `done` no banco havia 1h45. O TOM reafirmou verdade e levou
// acusacao de mentira, com severidade ALTA. E a mesma cegueira que o chokepoint tinha ate 31/08.
// Falso positivo ALTO e o que faz a pessoa parar de ler o sensor -- e ai o dia em que ele
// estiver certo passa junto.
// Falha de consulta NAO refuta (fail-closed: na duvida o achado sobrevive).
async function _refutarConfabPeloBanco(sb, collaborator, finding) {
  try {
    if (!finding || finding.category !== 'confabulation' || !collaborator || !collaborator.id) return null;
    const { refutarPeloBanco, titulosCitados } = require('./confab-refuta-banco');
    const titulos = titulosCitados(finding.evidence);
    if (!titulos.length) return null;
    const { data, error } = await sb.from('tasks')
      .select('title, status')
      .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`)
      .limit(200);
    if (error) return null;
    const r = refutarPeloBanco({ evidencia: finding.evidence, tarefas: data || [] });
    return r && r.refuta ? r : null;
  } catch (_) { return null; }
}

/** Analisa a conversa de um GRUPO. Retorna Finding[]. NUNCA lança. */
async function auditGroupConversation(sb, chat, group, hours = 24, ateIso = null) {
  try {
    const { text: convo, lastAt } = await loadGroupConversation(sb, group.id, hours, ateIso);
    if (convo.length < 80) return []; // conversa fina demais
    const { buildAuditMessages } = require('../prompts/conversation-audit-prompt');
    const { system, messages } = buildAuditMessages(convo);
    const r = await chat(system, messages, 1200);
    // `resolveIncidentAt` casa evidência contra `conversation_history` — inaplicável aqui.
    // Sem ele, occurred_at cai no lastAt da janela, que é o mesmo fallback do 1:1.
    return parseFindings(r && r.text, lastAt);
  } catch (err) {
    console.error(`[ConvAudit] erro no grupo ${group && group.name}:`, err.message);
    await registrarCegueira(sb, `grupo:${group && group.name}`, err);
    return [];
  }
}

/** Analisa a conversa de um colaborador. Retorna Finding[]. NUNCA lança. */
async function auditConversation(sb, chat, collaborator, hours = 24, ateIso = null) {
  try {
    const { text: convo, lastAt, sinceIso } = await loadConversation(sb, collaborator.id, hours, ateIso);
    if (convo.length < 80) return []; // conversa fina demais
    const { buildAuditMessages } = require('../prompts/conversation-audit-prompt');
    const { system, messages } = buildAuditMessages(convo);
    const r = await chat(system, messages, 1200);
    const brutos = parseFindings(r && r.text, lastAt);
    const findings = [];
    for (const f of brutos) {
      const refuta = await _refutarConfabPeloBanco(sb, collaborator, f);
      if (refuta) {
        console.log(`[ConvAudit] confabulacao REFUTADA pelo banco (${collaborator.full_name}): ${refuta.motivo}`);
        continue;
      }
      findings.push(f);
    }
    for (const f of findings) {
      const inc = await resolveIncidentAt(sb, collaborator.id, f.evidence, f.occurred_at, sinceIso);
      f.incident_at = inc.incident_at;
      f.incident_confidence = inc.incident_confidence;
      // AUDIT-EVIDENCE-ANCORA-NA-FALA-DO-TOM (27/08): troca a evidência pelo par literal
      // USUÁRIO/TOM quando ela só tinha a fala do TOM. Faz o achado nascer encenável pela sonda
      // e re-verificável por quem lê. Ancorar ANTES do upsert — depois o dedupe já fechou.
      const ancorada = await ancorarEvidencia(sb, collaborator.id, f.evidence, sinceIso);
      if (ancorada) f.evidence = ancorada;
    }
    return findings;
  } catch (err) {
    console.error(`[ConvAudit] erro p/ ${collaborator.full_name}:`, err.message);
    await registrarCegueira(sb, collaborator.full_name, err);
    return [];
  }
}

/**
 * Ordena findings por severidade (alto→baixo) e ocorrências, e amostra com
 * DIVERSIDADE: até `perPerson` por colaborador na 1ª passada, depois preenche
 * até `max` com os mais graves restantes. Pura — não toca DB. Evita o relatório
 * ser dominado por 1 pessoa (caso 08/06: 5 amostras todas do mesmo chat).
 * @param {Array} findings linhas {severity, occurrences, collaborator_id, ...}
 * @param {{perPerson?:number, max?:number}} [opts]
 * @returns {{sample:Array, byPerson:Object, bySeverity:Object}}
 */
function rankFindings(findings, opts = {}) {
  const perPerson = opts.perPerson != null ? opts.perPerson : 2;
  const max = opts.max != null ? opts.max : 7;
  const sevOf = f => (f && SEV_RANK[f.severity] != null) ? f.severity : 'medio';
  const list = (Array.isArray(findings) ? findings.slice() : []).sort((a, b) => {
    const d = SEV_RANK[sevOf(a)] - SEV_RANK[sevOf(b)];
    return d !== 0 ? d : (b.occurrences || 1) - (a.occurrences || 1);
  });
  const byPerson = {};
  const bySeverity = {};
  for (const f of list) {
    bySeverity[sevOf(f)] = (bySeverity[sevOf(f)] || 0) + 1;
    const pid = (f && f.collaborator_id) || 'unknown';
    byPerson[pid] = (byPerson[pid] || 0) + 1;
  }
  const seen = {};
  const sample = [];
  for (const f of list) {              // 1ª passada: diversifica (teto por pessoa)
    if (sample.length >= max) break;
    const pid = (f && f.collaborator_id) || 'unknown';
    if ((seen[pid] || 0) >= perPerson) continue;
    seen[pid] = (seen[pid] || 0) + 1;
    sample.push(f);
  }
  for (const f of list) {              // 2ª passada: preenche até max com os mais graves
    if (sample.length >= max) break;
    if (!sample.includes(f)) sample.push(f);
  }
  return { sample, byPerson, bySeverity };
}

/** Grava 1 finding com dedupe por assinatura. Triado/fechado NÃO re-surge. NUNCA lança. */
// `opts.groupId` (13/08): achado de GRUPO. O sujeito passa a ser o grupo — quem chama
// normaliza pra `{id, full_name: group.name}`, porque o guard de QA lê `full_name` e o
// grupo do Replay Lab (`[QA] Financeiro Replay`) precisa cair fora das métricas igual aos
// perfis. `collaborator_id` fica nulo: o achado é do grupo, não de uma pessoa — atribuir a
// um membro seria inventar responsável.
async function upsertFinding(sb, collaborator, finding, opts = {}) {
  const _groupId = opts.groupId || null;
  try {
    // ---- Isolamento do Replay Lab (spec 05/08, fronteira das métricas) ----
    // Os cenários do laboratório geram exatamente os sintomas que este detector procura.
    // Sem este guard, cada bateria injeta falha FABRICADA em tom_audit_findings — e a
    // base que usamos para priorizar passaria a contar teste como incidente real.
    // Seria eu contaminando o próprio diagnóstico que orientou este trabalho.
    if (!qaIsolation.contaNasMetricas(collaborator)) {
      return 'ignorado_qa';
    }
    // LEITURA DUPLA (migração da assinatura, 19/08): procura pela chave NOVA e pela LEGADA.
    // Sem isso a troca ressuscitaria de uma vez todo falso positivo já triado — exatamente a
    // doença que o fix cura. A linha encontrada pela legada é CONVERGIDA para a nova, senão
    // ela nunca passaria a ser encontrada pelo incidente e a migração não terminaria.
    const sig = signatureFor(finding.category, collaborator.id, finding.summary, chaveDoAchado(finding));
    const sigLegado = signatureFor(finding.category, collaborator.id, finding.summary);
    const sigs = sig === sigLegado ? [sig] : [sig, sigLegado];
    const { data: rows } = await sb.from('tom_audit_findings')
      .select('id, occurrences, status, signature')
      .in('signature', sigs);
    const all = rows || [];
    // Convergir a assinatura pode esbarrar no índice único parcial (só cobre novo/confirmado)
    // quando duas linhas antigas colapsam na mesma chave. Falhar aí é inofensivo — a linha
    // segue com a assinatura velha e continua sendo achada pela leitura dupla —, então o erro
    // não pode derrubar o upsert nem virar insert de duplicata.
    const _converge = (r) => (r && r.signature && r.signature !== sig ? { signature: sig } : {});
    // Já triado como fechado (resolvido/falso_positivo/...) → NÃO re-surge: só
    // registra a reincidência no last_seen e mantém o status fechado.
    const closed = all.find(r => CLOSED_STATUSES.has(r.status));
    if (closed) {
      // Mesmo motivo do insert: o cliente NAO lanca, devolve { error }. Sem olhar, uma
      // reincidencia que nao foi gravada fica identica a uma que foi.
      const { error: e1 } = await sb.from('tom_audit_findings')
        .update({ last_seen: new Date().toISOString(), ..._converge(closed) })
        .eq('id', closed.id);
      if (e1) console.error(`[ConvAudit] last_seen NAO gravado (${closed.id}): ${String(e1.message || e1).slice(0, 120)}`);
      return 'suppressed_closed';
    }
    // Já aberto (novo/confirmado) → incrementa ocorrências.
    const open = all.find(r => r.status === 'novo' || r.status === 'confirmado');
    if (open) {
      const { error: e2 } = await sb.from('tom_audit_findings')
        .update({ occurrences: (open.occurrences || 1) + 1, last_seen: new Date().toISOString(), ..._converge(open) })
        .eq('id', open.id);
      if (e2) console.error(`[ConvAudit] ocorrencia NAO incrementada (${open.id}): ${String(e2.message || e2).slice(0, 120)}`);
      return 'incremented';
    }
    // O cliente do Supabase NAO lanca em erro de insert: devolve { data, error }. Ignorar o
    // retorno fazia o achado sumir SEM RASTRO -- detectado, contado no log ("1 achado(s)") e
    // nunca gravado. Aconteceu com 1 dos 5 achados do reprocessamento de 01/09. E a mesma
    // doenca do dia inteiro: descarte que se parece com sucesso. Agora o erro vira log e
    // retorno proprio, entao quem chama consegue distinguir "gravei" de "tentei e falhei".
    const { error: erroInsert } = await sb.from('tom_audit_findings').insert({
      collaborator_id: _groupId ? null : collaborator.id,
      group_id: _groupId,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      evidence: finding.evidence,
      occurred_at: finding.occurred_at,
      incident_at: finding.incident_at || null,
      incident_confidence: finding.incident_confidence || 'none',
      signature: sig,
      status: 'novo',
    });
    if (erroInsert) {
      console.error(`[ConvAudit] INSERT FALHOU (${collaborator && collaborator.full_name || _groupId}): ${String(erroInsert.message || erroInsert).slice(0, 160)}`);
      return 'erro_insert';
    }
    return 'inserted';
  } catch (err) {
    console.error('[ConvAudit] upsert err:', err.message);
    return 'error';
  }
}

/** Pega o trecho mais distintivo do evidence p/ ancorar na conversa.
 * Remove o carimbo e os rótulos USUÁRIO:/TOM:, escolhe a linha mais longa, colapsa espaço, 100 chars.
 *
 * AUDIT-PROBE-CARIMBO-CEGA-ANCORA (19/08): o carimbo "[18/08 (ter) 13:06] " passou a preceder o
 * rótulo no fix AUDIT-RELATIVE-DATE-BLIND (02/08), mas este replace continuou ancorado em `^`.
 * Resultado: o rótulo nunca saía, o probe carregava o carimbo, e o includes() contra
 * conversation_history.content — que NÃO tem carimbo — falhava SEMPRE. Todo achado caía em
 * low/none e o finding-triage passava a carimbar "regressão" falsa. O carimbo sai PRIMEIRO,
 * como o extrairFala do ops-digest já fazia. Só `^` — colchete no meio do texto é conteúdo. */
function pickProbe(evidence) {
  const lines = String(evidence == null ? '' : evidence)
    .split(/\n+/)
    .map(l => l
      .replace(/^\s*\[[^\]]*\]\s*/, '')
      .replace(/^\s*(USU[ÁA]RIO|TOM)\s*:\s*/i, '')
      .replace(/\s+/g, ' ').trim())
    .filter(l => l.length >= 12);
  if (!lines.length) return '';
  return lines.sort((a, b) => b.length - a.length)[0].slice(0, 100).toLowerCase();
}

/** Tempo real do incidente: acha a mensagem da conversa que contém o trecho do
 * evidence e usa o created_at dela. Fallback: occurredAt (proxy de janela). */
async function resolveIncidentAt(sb, collaboratorId, evidence, occurredAt, sinceIso) {
  const probe = pickProbe(evidence);
  if (probe) {
    const { data } = await sb.from('conversation_history')
      .select('created_at, content, media_extracted_text')
      .eq('collaborator_id', collaboratorId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(60);
    const hit = (data || []).find(m => {
      const hay = `${m.content || ''} ${m.media_extracted_text || ''}`.toLowerCase();
      return hay.includes(probe);
    });
    if (hit) return { incident_at: hit.created_at, incident_confidence: 'high' };
  }
  if (occurredAt) return { incident_at: occurredAt, incident_confidence: 'low' };
  return { incident_at: null, incident_confidence: 'none' };
}

/** AUDIT-EVIDENCE-ANCORA-NA-FALA-DO-TOM (27/08) — recupera o turno LITERAL do usuário.
 *
 * O auditor grava no `evidence` a linha do TOM (quase sempre a de SUCESSO) em vez da fala que
 * falhou. Isso (a) deixa a sonda sem cenário — 91 de 240 findings corrigidos não tinham fala do
 * usuário e caíam no replay do resumo, que era verde vácuo — e (b) faz quem re-verifica lendo o
 * evidence ver o TOM funcionando e fechar como falso positivo. Caso 62d4dc1c (Rafinha 26/08).
 *
 * O auditor ACERTA qual mensagem do TOM é (é o que já ancora o incident_at). Então o CÓDIGO usa
 * essa âncora pra buscar o turno do usuário imediatamente anterior: LLM diz ONDE, código busca O
 * QUÊ — o mesmo desenho da leitura determinística. Sem casar, devolve null: nunca fabrica.
 *
 * `extrairFalasDoUsuario` vem do gate da sonda de propósito: quem ESCREVE a evidência e quem a
 * LÊ precisam concordar sobre o que conta como fala do usuário. Duas definições divergiriam. */
const MAX_TURNO = 500;
const JANELA_TROCA_MS = 15 * 60 * 1000;   // par usuário↔TOM só vale dentro da mesma troca
async function ancorarEvidencia(sb, collaboratorId, evidence, sinceIso) {
  try {
    const { extrairFalasDoUsuario } = require('../governance/shadow-reproducibility');
    if (extrairFalasDoUsuario({ evidence }).length) return null;   // já tem fala — não mexe
    const probe = pickProbe(evidence);
    if (!probe) return null;
    const { data } = await sb.from('conversation_history')
      .select('created_at, direction, content, media_extracted_text')
      .eq('collaborator_id', collaboratorId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(60);
    const msgs = data || [];
    const casa = (m) => `${m.content || ''} ${m.media_extracted_text || ''}`.toLowerCase().includes(probe);
    const i = msgs.findIndex(casa);
    if (i < 0) return null;
    const corta = (m) => String((m && m.content) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TURNO);
    // A query vem DESC: índice MAIOR = mais antigo. "Anterior no tempo" é pra frente no array.
    let user = null; let tom = null;
    if (msgs[i].direction === 'inbound') {
      user = msgs[i];
      for (let k = i - 1; k >= 0; k--) { if (msgs[k].direction === 'outbound') { tom = msgs[k]; break; } }
    } else {
      tom = msgs[i];
      for (let k = i + 1; k < msgs.length; k++) { if (msgs[k].direction === 'inbound') { user = msgs[k]; break; } }
    }
    if (!user || !corta(user)) return null;   // sem fala do usuário não há o que ancorar
    // Mensagem PROATIVA não tem turno que a disparou: colar o inbound anterior fabrica um nexo
    // (achado no dry-run do backfill — `e4a434b2` ancorou numa fala de 5h antes, outro assunto).
    // Só vale como par se as duas mensagens forem da MESMA troca.
    if (tom) {
      const dt = Math.abs(new Date(tom.created_at) - new Date(user.created_at));
      if (!Number.isFinite(dt) || dt > JANELA_TROCA_MS) return null;
    }
    const linhas = [`USUÁRIO: ${corta(user)}`];
    if (tom && corta(tom)) linhas.push(`TOM: ${corta(tom)}`);
    return linhas.join('\n');
  } catch (_) {
    return null;   // ancorar é melhoria; nunca pode derrubar a auditoria
  }
}

module.exports = {
  normalizeSummary, signatureFor, chaveDoAchado, parseFindings, rankFindings,
  loadConversation, rotuloDaLinha, linhasDeMarkers, loadMarkerTrail, auditConversation, upsertFinding, resolveIncidentAt, pickProbe, ancorarEvidencia,
  formatGroupTranscript, loadGroupConversation, auditGroupConversation,
  CLOSED_STATUSES, SEV_RANK,
};

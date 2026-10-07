'use strict';

// CONFLITO-SO-DO-DONO (Alf 06/10 17:52 BRT). Ele criou pelo app "Reuniao semana da crianças"
// 07/10 15:30–16:30 (e9d192a4) por cima de "Jornada de Cordas" 07/10 13:00–17:00 (41a6e5af —
// dona: Quintela, source 'tom'; Alf e Rodrigo em event_participants, confirmados) e NINGUÉM
// avisou. Todos os checadores de conflito (app: QuickCreateSheet + events.ts; TOM:
// detectTemporalConflict) perguntavam só `events.collaborator_id = eu`. Mas a agenda que a
// pessoa VÊ (app: fetchEventsOwnedOrInvited; TOM: ctx.todayEvents, fix de 15/05) já era
// dono ∪ participante — o checador olhava uma agenda menor que a mostrada. Compromisso de que
// eu participo ocupa o meu horário tanto quanto o que eu criei.
//
// Este módulo é a definição ÚNICA do lado do TOM (o app tem a gêmea em
// web/src/lib/eventConflicts.ts — mudam juntas):
//   conflito = evento que eu sou DONO (status ≠ cancelled)
//            ∪ evento em que estou em event_participants com status ≠ declined (e evento ≠ cancelled)
//   que SOBREPÕE a janela (início < fim da janela E fim > início da janela; encostar não conta).
//
// Replay 30 dias (07/10): 79 eventos, 6 pares sobrepostos no mesmo dia, 3 com participação; 1
// deles (o do Alf acima) foi criado pela pessoa já sendo participante do outro — o que um
// checador correto teria pegado. O do Yuri (ensaio dele × reunião do Alf, convidado depois) é
// do lado do CONVIDADO e fica fora daqui (checar a agenda de quem é convidado é outra frente).

const FUSO = 'America/Sao_Paulo';
const DIA_TODO_MS = 12 * 3600_000;

function _ms(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// Sobreposição estrita: 13:00–14:00 e 14:00–15:00 só encostam — não é conflito.
function sobrepoe(a, b) {
  if (!a || !b) return false;
  const as = _ms(a.start_at), ae = _ms(a.end_at), bs = _ms(b.start_at), be = _ms(b.end_at);
  if (![as, ae, bs, be].every(Number.isFinite)) return false;
  return as < be && ae > bs;
}

// Dono ∪ participação (sem recusa), sem cancelado, uma vez por id, em ordem de início.
// `_participante: true` marca o que veio só pela participação (quem lê decide se importa).
function unirCompromissos(proprios, participacoes) {
  const mapa = new Map();
  for (const e of (proprios || [])) {
    if (e && e.id && e.status !== 'cancelled') mapa.set(e.id, e);
  }
  for (const p of (participacoes || [])) {
    if (!p || p.status === 'declined') continue;
    const e = p.event;
    if (!e || !e.id || e.status === 'cancelled' || mapa.has(e.id)) continue;
    mapa.set(e.id, { ...e, _participante: true });
  }
  return [...mapa.values()].sort((x, y) => String(x.start_at).localeCompare(String(y.start_at)));
}

const COLUNAS_PADRAO = 'id, title, start_at, end_at, modality, location_text, category, status, collaborator_id';

// A consulta. Duas leituras porque o PostgREST não faz OR entre a tabela e um embed; o filtro de
// janela vai nas DUAS (no embed via `event:events!inner` + `event.start_at`), então nada de puxar
// todas as participações da pessoa pra filtrar em JS. Erro de consulta SOBE: fail-open/closed é
// decisão de quem chama (o detector do TOM é fail-open, como sempre foi).
async function compromissosQueSobrepoem({ supabase, collaboratorId, startIso, endIso, colunas, excluirId = null, limite = 20 }) {
  const cols = colunas || COLUNAS_PADRAO;
  const [own, parts] = await Promise.all([
    supabase.from('events').select(cols)
      .eq('collaborator_id', collaboratorId)
      .neq('status', 'cancelled')
      .lt('start_at', endIso)
      .gt('end_at', startIso)
      .limit(limite),
    supabase.from('event_participants').select(`status, event:events!inner(${cols})`)
      .eq('collaborator_id', collaboratorId)
      .neq('status', 'declined')
      .neq('event.status', 'cancelled')
      .lt('event.start_at', endIso)
      .gt('event.end_at', startIso)
      .limit(limite),
  ]);
  if (own.error) throw new Error(own.error.message || 'events_query_error');
  if (parts.error) throw new Error(parts.error.message || 'participants_query_error');
  const janela = { start_at: startIso, end_at: endIso };
  return unirCompromissos(own.data, parts.data)
    .filter((e) => e.id !== excluirId && sobrepoe(e, janela));
}

// ── Briefing: conflitos do dia, calculados pelo código ──────────────────────
const _fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false });
const _fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
const _faixa = (e) => `${_fmtHora.format(new Date(e.start_at))}–${_fmtHora.format(new Date(e.end_at))}`;

// Pares sobrepostos entre os compromissos que COMEÇAM no dia `hojeYmd` (fuso SP). Fica fora:
// cancelado, sem horário válido, e bloco de ≥12h ("dia todo"/plantão) — este sobrepõe tudo e
// transformaria o aviso em ruído diário.
function conflitosDoDia(eventos, hojeYmd) {
  const doDia = (eventos || []).filter((e) => {
    if (!e || e.status === 'cancelled') return false;
    const s = _ms(e.start_at), f = _ms(e.end_at);
    if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s || f - s >= DIA_TODO_MS) return false;
    return _fmtDia.format(new Date(s)) === hojeYmd;
  }).sort((x, y) => _ms(x.start_at) - _ms(y.start_at) || (_ms(y.end_at) - _ms(x.end_at)));
  const pares = [];
  for (let i = 0; i < doDia.length; i += 1) {
    for (let j = i + 1; j < doDia.length; j += 1) {
      const a = doDia[i], b = doDia[j];
      if (a.id && a.id === b.id) continue;
      if (!sobrepoe(a, b)) continue;
      // a começa antes (ou junto e termina depois): se b cabe inteiro em a, "b cai dentro de a".
      const contido = _ms(b.start_at) >= _ms(a.start_at) && _ms(b.end_at) <= _ms(a.end_at);
      pares.push(contido ? { tipo: 'dentro', menor: b, maior: a } : { tipo: 'bate', primeiro: a, segundo: b });
    }
  }
  return pares;
}

function linhasDeConflitoDoDia(eventos, hojeYmd) {
  return conflitosDoDia(eventos, hojeYmd).map((p) => (p.tipo === 'dentro'
    ? `⚠️ Conflito: *${p.menor.title}* (${_faixa(p.menor)}) cai dentro de *${p.maior.title}* (${_faixa(p.maior)})`
    : `⚠️ Conflito: *${p.primeiro.title}* (${_faixa(p.primeiro)}) bate com *${p.segundo.title}* (${_faixa(p.segundo)})`));
}

// A linha vai no fim do texto que o modelo escreveu — o código não reescreve a voz do TOM, só
// acrescenta o fato que ele calculou. Linha que já está no texto não entra de novo.
function anexarConflitosAoTexto(texto, linhas) {
  const base = String(texto || '');
  const novas = (linhas || []).filter((l) => l && !base.includes(l));
  if (!novas.length) return base;
  return `${base.trimEnd()}\n\n${novas.join('\n')}`;
}

module.exports = {
  sobrepoe,
  unirCompromissos,
  compromissosQueSobrepoem,
  conflitosDoDia,
  linhasDeConflitoDoDia,
  anexarConflitosAoTexto,
};

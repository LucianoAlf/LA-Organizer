// RITUAL-AGENDA-GUARD (Alf 30/09 19:04 BRT): o fechamento perguntou "🗓️ *Jornada de Cordas*
// (13h–17h) — rolou? me confirma." num dia em que a agenda dele estava VAZIA — o evento de 30/09
// (3001604f) tinha sido cancelado em 29/09 e remarcado pra 07/10 (41a6e5af). A seção de agenda do
// prompt estava certa (cancelado filtrado). A linha veio do RESUMO SEMANAL (75020d33, gerado em
// 28/09), que guardava "Jornada de Cordas … remarcada para 30/09, 13h–17h" como fato — e o modelo
// leu isso como compromisso de hoje.
//
// Consertar a fonte (resumo semanal, ver system.js/weekly-summary-render.js) reduz a chance; esta
// rede torna o erro IMPOSSÍVEL de sair: toda linha de evento que o ritual (briefing/fechamento)
// apresenta como sendo DE HOJE tem que casar com um evento da agenda REAL de hoje daquela pessoa
// (dono ou participante que não recusou, status ≠ cancelled; mais os eventos institucionais
// ativos de hoje). Linha que não casa sai do texto, e o motivo vai pro marker_logs.
//
// Decisões de desenho (conservadoras de propósito — remover um evento REAL é pior do que deixar
// passar um alucinado, porque aí a pessoa perde a pergunta do "rolou?"):
//  • Só olha linha que se apresenta como evento de HOJE: começa com 🗓️/📅/📆 (depois de bullet ou
//    número) e tem hora ou "rolou"; OU tem *título em negrito* + hora + "rolou". Frase corrida sem
//    título estruturado não é checada. Linha que cita OUTRO dia (dd/mm ≠ hoje, "amanhã", "ontem",
//    dia da semana ≠ hoje, "semana que vem") não é "de hoje" — passa.
//  • Linha com "rolou?" pode casar também com evento NÃO cancelado dos 7 dias anteriores (cobrança
//    de evento de ontem que ninguém fechou é legítima). Cancelado nunca casa.
//  • Casamento por TÍTULO normalizado (sem acento/pontuação/caixa): contém/contido ou sobreposição
//    de palavras ≥ 60%. NÃO compara horário: o modelo escreve hora de mil jeitos (9h, 09h, 9h–10h,
//    "9h às 11h") e o título já separa o cancelado de 30/09 do remarcado de 07/10 (este não é hoje).
//  • Linha com vários títulos (*A* (13h) · *B* (17h)): só sai se NENHUM casar; parcial fica e é
//    registrado como parcial.
//  • Agenda que não carregou (erro de consulta) ≠ agenda vazia: sem agenda confiável, não remove nada.
'use strict';

const EMOJI_EVENTO = /^(?:\s*(?:[-•*·]|\d{1,2}[.)])\s*)*(?:🗓️|🗓|📅|📆)/u;
const HORA = /(?:^|[^\d])(\d{1,2})(?:h(?:\d{2})?|:\d{2})(?![\d])/i;
const ROLOU = /\brolou\b/i;
const DIA_TODO = /\bdia todo\b/i;

const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'pra', 'na', 'no', 'nas', 'nos', 'em', 'a', 'o', 'as', 'os', 'um', 'uma']);

function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function palavras(s) {
  return normalizar(s).split(' ').filter((w) => w && !STOP.has(w) && !/^\d/.test(w));
}

function titulosCasam(tituloLinha, tituloEvento) {
  const a = normalizar(tituloLinha);
  const b = normalizar(tituloEvento);
  if (!a || !b) return false;
  if (a === b) return true;
  // contém/contido — com borda de palavra, pra "rec" não casar com "recreio"
  if ((` ${a} `).includes(` ${b} `) || (` ${b} `).includes(` ${a} `)) return true;
  const pa = new Set(palavras(tituloLinha));
  const pb = new Set(palavras(tituloEvento));
  if (!pa.size || !pb.size) return false;
  let comum = 0;
  for (const w of pa) if (pb.has(w)) comum += 1;
  return comum / Math.min(pa.size, pb.size) >= 0.6 && comum >= 1;
}

// "30/09" etc. relativo a hoje. Devolve true quando a linha fala de OUTRO dia.
function citaOutroDia(linha, hojeYmd) {
  const n = normalizar(linha);
  if (/\b(amanha|ontem|anteontem|depois de amanha|semana que vem|proxima semana|mes que vem)\b/.test(n)) return true;
  const [, mm, dd] = String(hojeYmd || '').split('-').map(Number);
  const re = /(?:^|[^\d/])(\d{1,2})\/(\d{2})(?:\/\d{2,4})?(?![\d/])/g; // "3/3 confirmaram" não é data
  let m;
  while ((m = re.exec(linha)) !== null) {
    if (Number(m[1]) !== dd || Number(m[2]) !== mm) return true;
  }
  if (hojeYmd) {
    const dow = new Date(`${hojeYmd}T12:00:00Z`).getUTCDay();
    for (let i = 0; i < 7; i += 1) {
      if (i === dow) continue;
      // "segunda" / "terça-feira" / "sábado" — nome cheio, pra não confundir "sex" etc.
      if (new RegExp(`\\b${DIAS_SEMANA[i]}\\b`).test(n)) return true;
    }
  }
  return false;
}

function extrairTitulos(linha) {
  const negritos = [];
  const re = /\*([^*\n]+)\*/g;
  let m;
  while ((m = re.exec(linha)) !== null) {
    const t = m[1].trim();
    if (!t || (HORA.test(t) && palavras(t).length === 0)) continue; // "*13h*" não é título
    negritos.push(t);
  }
  if (negritos.length) return negritos;
  // Sem negrito: tira bullet/número/emoji, hora do começo e o que vem depois de " — " que for
  // hora/rolou/feito; fica o 1º pedaço que tem palavra.
  let resto = linha.replace(EMOJI_EVENTO, '').replace(/[⏰✅]/gu, ' ');
  const pedacos = resto.split(/\s+[—–-]\s+|\s+·\s+/).map((p) => p.replace(/\([^)]*\)/g, ' ').trim());
  for (const p of pedacos) {
    const semHora = p.replace(/\b\d{1,2}(?:h\d{0,2}|:\d{2})\b/gi, ' ').replace(/\b(as|às|ate|até)\b/gi, ' ');
    if (ROLOU.test(p) || /\bfeito\b/i.test(p)) continue;
    if (palavras(semHora).length) return [semHora.trim()];
  }
  return [];
}

// Uma linha é "evento de hoje" se se apresenta como tal. Devolve null quando não é.
function linhaDeEvento(linha, { hojeYmd } = {}) {
  const l = String(linha || '');
  if (!l.trim()) return null;
  const temEmoji = EMOJI_EVENTO.test(l);
  const temHora = HORA.test(l) || DIA_TODO.test(l);
  const rolou = ROLOU.test(l);
  const temNegrito = /\*[^*\n]+\*/.test(l);
  // Sem o 🗓️, só linha ESTRUTURADA (título em negrito + hora + "rolou"). Frase corrida ("Sem nada
  // marcado hoje. Rolou alguma coisa — tipo a revisão às 19h?") não tem título extraível com
  // segurança: tirar a linha inteira levaria junto o "sem nada marcado" e a pergunta aberta.
  const ehEvento = (temEmoji && (temHora || rolou)) || (rolou && temHora && temNegrito);
  if (!ehEvento) return null;
  if (citaOutroDia(l, hojeYmd)) return null;
  const titulos = extrairTitulos(l);
  if (!titulos.length) return null;
  return { titulos, rolou };
}

// agenda: [{ title }] — eventos REAIS de hoje (já filtrados). ok=false → agenda não confiável.
// recentes: [{ title }] — eventos NÃO cancelados dos 7 dias anteriores. Só valem pra linha com
// "rolou?": perguntar se rolou o evento de ontem que ninguém fechou é cobrança legítima (caso real
// do briefing do Alf em 11/09 sobre as reuniões de 10/09); o que nunca pode é evento cancelado ou
// que não existe.
function filtrarEventosForaDaAgenda(texto, { agenda, recentes = [], hojeYmd, agendaOk = true } = {}) {
  const res = { texto: texto, removidas: [], parciais: [], fired: false };
  if (typeof texto !== 'string' || !texto) return res;
  if (!agendaOk || !Array.isArray(agenda)) return res;
  const linhas = texto.split('\n');
  const saida = [];
  for (const linha of linhas) {
    const ev = linhaDeEvento(linha, { hojeYmd });
    if (!ev) { saida.push(linha); continue; }
    const base = ev.rolou ? agenda.concat(recentes || []) : agenda;
    const casados = ev.titulos.filter((t) => base.some((e) => titulosCasam(t, e.title)));
    if (casados.length === ev.titulos.length) { saida.push(linha); continue; }
    if (casados.length > 0) {
      res.parciais.push({ linha, fora: ev.titulos.filter((t) => !casados.includes(t)) });
      saida.push(linha);
      continue;
    }
    res.removidas.push({ linha, titulos: ev.titulos });
  }
  if (!res.removidas.length) return res;
  res.fired = true;
  res.texto = saida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return res;
}

function ymdBRT(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));
}

// Mesma régua da seção de agenda do prompt (system.js): eventos do dono + convites não recusados,
// status ≠ cancelled, start_at no dia (BRT); mais eventos institucionais ativos que cobrem o dia.
function addDias(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function carregarAgendaDoDia({ supabase, collaboratorId, hojeYmd }) {
  const inicioRecentes = addDias(hojeYmd, -7);
  const lo = `${inicioRecentes}T00:00:00-03:00`;
  const hi = `${hojeYmd}T23:59:59-03:00`;
  try {
    const [own, parts, school] = await Promise.all([
      supabase.from('events').select('id, title, status, start_at')
        .eq('collaborator_id', collaboratorId).gte('start_at', lo).lte('start_at', hi)
        .neq('status', 'cancelled'),
      supabase.from('event_participants')
        .select('status, event:events(id, title, status, start_at)')
        .eq('collaborator_id', collaboratorId).neq('status', 'declined'),
      supabase.from('school_events').select('id, title, event_date, end_date, status')
        .eq('status', 'active').lte('event_date', hojeYmd)
        .or(`event_date.eq.${hojeYmd},end_date.gte.${hojeYmd}`),
    ]);
    const erro = own.error || parts.error || school.error;
    if (erro) return { ok: false, agenda: [], recentes: [], erro: erro.message || String(erro) };
    const agenda = [];
    const recentes = [];
    const poe = (e, fonte) => {
      if (!e || e.status === 'cancelled') return;
      const dia = ymdBRT(e.start_at);
      if (dia === hojeYmd) agenda.push({ id: e.id, title: e.title, fonte });
      else if (dia >= inicioRecentes && dia < hojeYmd) recentes.push({ id: e.id, title: e.title, fonte, dia });
    };
    for (const e of own.data || []) poe(e, 'dono');
    for (const p of parts.data || []) poe(p.event, 'participante');
    for (const s of school.data || []) {
      const fim = s.end_date || s.event_date;
      if (s.event_date <= hojeYmd && fim >= hojeYmd) agenda.push({ id: s.id, title: s.title, fonte: 'institucional' });
    }
    return { ok: true, agenda, recentes };
  } catch (e) {
    return { ok: false, agenda: [], recentes: [], erro: e.message };
  }
}

async function registrarRemocoes({ supabase, collaboratorId, ritual, removidas }) {
  for (const r of removidas || []) {
    try {
      const { error } = await supabase.from('marker_logs').insert({
        collaborator_id: collaboratorId,
        marker_type: 'RITUAL_AGENDA_GUARD',
        result: 'rejected',
        reason: `${ritual}: evento fora da agenda de hoje (${r.titulos.join(' | ')})`.slice(0, 120),
        raw_excerpt: String(r.linha).slice(0, 500),
      });
      if (error) console.error('[RitualAgenda] marker_logs insert falhou:', error.message);
    } catch (e) { console.error('[RitualAgenda] marker_logs erro:', e.message); }
  }
}

// Ponto único que o sendRitual chama. Nunca lança; na dúvida devolve o texto como veio.
async function aplicarGuardaDeAgenda({ supabase, collaboratorId, ritual, texto, hojeYmd }) {
  try {
    const ag = await carregarAgendaDoDia({ supabase, collaboratorId, hojeYmd });
    if (!ag.ok) {
      console.warn(`[RitualAgenda] ${ritual}: agenda de hoje não carregou (${ag.erro}) — texto segue sem checagem`);
      return { texto, removidas: [], parciais: [], agendaOk: false };
    }
    const fx = filtrarEventosForaDaAgenda(texto, { agenda: ag.agenda, recentes: ag.recentes, agendaOk: true, hojeYmd });
    if (fx.parciais.length) {
      console.warn(`[RitualAgenda] ${ritual}: linha com evento parcialmente fora da agenda mantida (${fx.parciais.map((p) => p.fora.join('|')).join('; ')})`);
    }
    if (!fx.fired) return { texto, removidas: [], parciais: fx.parciais, agendaOk: true };
    if (!fx.texto.trim()) {
      console.warn(`[RitualAgenda] ${ritual}: remover deixaria a mensagem vazia — mantida`);
      return { texto, removidas: [], parciais: fx.parciais, agendaOk: true };
    }
    console.warn(`[RitualAgenda] ${ritual}: ${fx.removidas.length} linha(s) de evento fora da agenda de hoje removida(s): ${fx.removidas.map((r) => r.titulos.join('|')).join('; ')}`);
    await registrarRemocoes({ supabase, collaboratorId, ritual, removidas: fx.removidas });
    return { texto: fx.texto, removidas: fx.removidas, parciais: fx.parciais, agendaOk: true };
  } catch (e) {
    console.warn(`[RitualAgenda] ${ritual}: erro (non-fatal): ${e.message}`);
    return { texto, removidas: [], parciais: [], agendaOk: false };
  }
}

module.exports = {
  normalizar, titulosCasam, citaOutroDia, extrairTitulos, linhaDeEvento,
  filtrarEventosForaDaAgenda, carregarAgendaDoDia, registrarRemocoes, aplicarGuardaDeAgenda, ymdBRT,
};

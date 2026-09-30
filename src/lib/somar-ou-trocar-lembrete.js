"use strict";
// somar-ou-trocar-lembrete.js — horário novo numa tarefa que JÁ existe: SOMA ou TROCA? PURO.
//
// SOMAR-HORARIO-1A1 (Ana Paula, 1:1, 11/09 00:38 UTC): "Me lembra 12h e 20h". O LLM emitiu 5
// `reschedule` com new_remind_at 20h (task_comments: "Prazo: 30/09 → 26/09 (lembrete 20:00)"…) e
// cada um SOBRESCREVEU o remind_at da mesma tarefa — o 12h sumiu. Minutos depois o TOM disse
// "Agora sim — 10 registros (12h e 20h…)"; o banco tinha UM horário. O reschedule só sabia trocar.
//
// Regra (decisão do Alf, 30/09): "me lembra TAMBÉM às 20h" / "mais um lembrete" / "e às 20h
// também" / "12h e 20h" SOMA uma linha em task_reminders (mesmo teto do 35e58476: 3 por tarefa,
// 30 min entre eles); "muda pra 20h" / "passa pra 20h" TROCA (comportamento de sempre).
// A fala da pessoa manda; o campo `add_reminder` do marker só decide quando a fala é neutra.

function _norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Substituição explícita: vence tudo ("na verdade é 20h", "20h em vez de 12h", "só às 20h").
const SUBSTITUI = [
  /\bem vez d/, /\bao inves d/, /\bno lugar d/, /\bna verdade\b/, /\bcorrig/, /\berrei\b/,
  /\bso (?:as|a|o|no|na|de|pra|para|um|uma)\b/, /\bsomente\b/, /\bapenas\b/,
  /\bnao (?:e|eh|sera|vai ser) (?:mais )?(?:as|a|o)\b/, /\btira (?:o|a) d/,
];
// Soma explícita. "também" só conta colado no HORÁRIO ou no verbo de lembrar — replay 60d: a Anne
// (13/08) disse "Amanhã também, às 10h40 preciso ligar…", onde o "também" é do DIA (mais uma coisa
// amanhã), e o reschedule dela era troca legítima.
const _HORA = "(?:[01]?\\d|2[0-3])\\s*(?:h|hs|horas?|:[0-5]\\d)(?:[0-5]\\d)?";
const SOMA = [
  new RegExp(`\\btambem\\s+(?:as?\\s+)?${_HORA}`), new RegExp(`${_HORA}\\s+tambem\\b`),
  /\b(?:lembr|avis|cobr|alert)\w*\s+(?:\w+\s+)?tambem\b/, /\btambem\s+(?:me\s+|te\s+)?(?:lembr|avis|cobr|alert)/,
  // "mais um" só com o objeto do lembrete — "adia mais um dia" é TROCA de data.
  /\bmais (?:um|uma|outro|outra) (?:lembrete|aviso|alerta|horario|toque)\b/, /\bmais uma vez\b/,
  /\boutr[oa] (?:lembrete|aviso|alerta|horario|toque)\b/,
  /\b(?:adiciona|adicione|adicionar|acrescenta|acrescente|acrescentar|inclui|inclua|incluir|soma|some|somar)\b/,
  /\bale[mn] d/, /\b(?:de novo|novamente|outra vez) (?:as|a)\b/, /\bmais (?:tarde|a noite|de noite) (?:as|a)?\s*\d/,
  /^\s*e\s+(?:as?\s+)?\d{1,2}\s*(?:h|:|hs|horas)/, /\bduas vezes\b/, /\bdois lembretes\b/,
];
// Troca explícita.
const TROCA = [
  /\b(?:muda|mude|mudar|mudei|passa|passe|passar|troca|troque|trocar|altera|altere|alterar|remarca|remarque|remarcar|reagenda|reagende|adia|adie|adiar|antecipa|antecipe|antecipar|move|mova|mover|empurra|empurre|joga|jogue)\b/,
];

// Horários citados na fala, como minutos do dia (dedup). "12h", "12:30", "às 9", "9h30", "meio-dia".
function horariosDaFala(texto) {
  const s = _norm(texto);
  const out = new Set();
  const re = /(?<![\d/])([01]?\d|2[0-3])\s*(?:h|hs|horas?|:)\s*([0-5]\d)?(?![\d/])/g;
  let m;
  while ((m = re.exec(s)) !== null) out.add(Number(m[1]) * 60 + Number(m[2] || 0));
  const reAs = /\bas\s+([01]?\d|2[0-3])(?![\d/:h])/g;
  while ((m = reAs.exec(s)) !== null) out.add(Number(m[1]) * 60);
  if (/\bmeio[- ]dia\b/.test(s)) out.add(12 * 60);
  if (/\bmeia[- ]noite\b/.test(s)) out.add(0);
  return [...out].sort((a, b) => a - b);
}

// "me lembra 12h e 20h", "às 9h, 12h e 15h", "me avisa 9h e às 15h" — LISTA de horários ligada por
// "e"/vírgula, logo depois do verbo de lembrar ou de "às". Horário que é CONTEÚDO não conta (replay
// 60d: Duda 21/09 "lembrar o Arthur… alunos de 18h e 19h").
const _LISTA = new RegExp(`(?:\\b(?:lembr|avis|cobr|alert)\\w*(?:\\s+\\S+){0,3}?\\s+|\\bas\\s+)(?:as?\\s+)?(?<![\\d/])${_HORA}(?:\\s*(?:,|\\be\\b)\\s*(?:tambem\\s+)?(?:as?\\s+)?${_HORA})+`);
function falaListaHorarios(texto) {
  return _LISTA.test(_norm(texto));
}

/**
 * @param {object} p
 * @param {string} p.texto  fala REAL da pessoa (sem scaffold de citação)
 * @param {object} p.acao   ação reschedule do marker ({ new_remind_at, new_due_date, add_reminder, ... })
 * @param {string} [p.prazoAtual]  due_date atual da tarefa (YYYY-MM-DD)
 * @param {boolean} [p.jaReagendadaNoLote]  esta tarefa já recebeu um horário NESTE mesmo lote
 * @returns {{ modo: "somar"|"trocar", motivo: string }}
 */
function decidirHorarioNovo({ texto, acao, prazoAtual = null, jaReagendadaNoLote = false } = {}) {
  const a = acao || {};
  if (typeof a.new_remind_at !== "string" || !a.new_remind_at.trim()) return { modo: "trocar", motivo: "sem_horario_novo" };
  const s = _norm(texto);
  if (SUBSTITUI.some((re) => re.test(s))) return { modo: "trocar", motivo: "fala_substitui" };
  // Estrutural (mesma regra do grupo, 35e58476): a MESMA tarefa com 2º horário no MESMO lote não é
  // correção — cada reschedule sobrescrevia o anterior (Ana: 5 no mesmo id, sobrou 1).
  if (jaReagendadaNoLote) return { modo: "somar", motivo: "mesma_tarefa_no_lote" };
  const novoPrazo = typeof a.new_due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.new_due_date) ? a.new_due_date : null;
  const mudouPrazo = !!novoPrazo && novoPrazo !== (prazoAtual || null);
  // "também" solto é ambíguo em mensagem de vários itens (replay: Anne 03/08, "Me lembre também que
  // preciso pagar o cartão" com 2 reschedules que MOVIAM o prazo) — com prazo mudando, é troca.
  if (SOMA.some((re) => re.test(s))) return mudouPrazo ? { modo: "trocar", motivo: "fala_soma_mas_prazo_muda" } : { modo: "somar", motivo: "fala_soma" };
  if (TROCA.some((re) => re.test(s))) return { modo: "trocar", motivo: "fala_troca" };
  const flag = a.add_reminder === true || a.add_reminder === "true" || a.mode === "add" || a.modo === "somar";
  if (flag) return { modo: "somar", motivo: "marker_add_reminder" };
  if (falaListaHorarios(texto) && horariosDaFala(texto).length >= 2) return { modo: "somar", motivo: "fala_lista_horarios" };
  return { modo: "trocar", motivo: "padrao" };
}

// ─── texto de confirmação: SÓ o que ficou gravado ─────────────────────────────────────────────
function _brt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  const h = String(Number(p.hour) % 24).padStart(2, "0");
  return { t: d.getTime(), dia: `${p.day}/${p.month}`, hora: p.minute === "00" ? `${h}h` : `${h}h${p.minute}` };
}
function _junta(partes) {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}
function listaDeHorarios(isos) {
  const hs = (Array.isArray(isos) ? isos : []).map(_brt).filter(Boolean).sort((a, b) => a.t - b.t);
  if (!hs.length) return "";
  const mesmoDia = hs.every((h) => h.dia === hs[0].dia);
  return mesmoDia ? `${hs[0].dia} às ${_junta(hs.map((h) => h.hora))}` : _junta(hs.map((h) => `${h.dia} ${h.hora}`));
}

/**
 * Uma linha por tarefa. `itens`: [{ titulo, horarios: [iso gravado], recusados: [iso barrado pelo teto],
 * falhas: [iso que o banco recusou] }].
 */
function textoLembretesSomados(itens) {
  const linhas = [];
  for (const it of Array.isArray(itens) ? itens : []) {
    const titulo = String((it && it.titulo) || "tarefa").slice(0, 80);
    const grav = listaDeHorarios(it.horarios);
    const rec = listaDeHorarios(it.recusados);
    const n = (Array.isArray(it.horarios) ? it.horarios : []).length;
    if (grav) linhas.push(`🔔 *${titulo}* — ${n === 1 ? "lembrete gravado" : `${n} lembretes gravados`}: ${grav}.`);
    if (rec) {
      const nr = (Array.isArray(it.recusados) ? it.recusados : []).length;
      linhas.push(`⚠️ ${rec} não entr${nr === 1 ? "ou" : "aram"}${grav ? "" : ` em *${titulo}*`} — no máximo 3 lembretes por tarefa, com 30 min entre eles.`);
    }
    const fal = listaDeHorarios(it.falhas);
    if (fal) linhas.push(`⚠️ Não consegui gravar o lembrete de ${fal}${grav || rec ? "" : ` em *${titulo}*`} — me pede de novo?`);
  }
  return linhas.join("\n");
}

module.exports = { decidirHorarioNovo, horariosDaFala, falaListaHorarios, textoLembretesSomados, listaDeHorarios };

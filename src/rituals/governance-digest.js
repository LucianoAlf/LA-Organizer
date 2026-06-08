// src/rituals/governance-digest.js
// Fase 6a — montador do DIGEST de governança (1 mensagem hierárquica que substitui
// os 4 pings da manhã: scorecard + compromissos + tarefas + rodapé).
//
// Este módulo é PURO (sem I/O): recebe as seções JÁ formatadas (o fetch + render
// de eventos/tarefas continua nas funções do dispatcher, que serão chamadas em
// "modo seção") e cuida de: (1) seção 🏆 scorecard com badges/gamificação,
// (2) montagem hierárquica com separadores, (3) guard de tamanho do WhatsApp
// (~4000 chars) cortando a cauda de menor prioridade → "+ mais na dashboard".
//
// Funções puras → testáveis com node --test. Rodar: node --test src/rituals/governance-digest.test.js
'use strict';

const HR = '━━━━━━━━━━━━━━━━━━━━━';
const DEFAULT_MAX = 4000;

// ── Badge / classificação de um scorecard de líder ──────────────────────────
// Alinhado ao dashboard (scorecard-classify.ts): 🔴 atenção / 🟡 de olho / 🟢 ritmo.
// badge = semente de gamificação (🥇 topo, 📈 subindo forte). delta = pp vs semana
// anterior (opcional). Sem tarefas → ritmo (não pune quem não tem o que fechar).
function badgeForScorecard(sc) {
  const closure = sc.closure_rate ?? 0;
  const overdue = sc.tasks_overdue ?? 0;
  const stuck = sc.tasks_stuck ?? 0;
  const closed = sc.tasks_closed ?? 0;
  const delta = typeof sc.delta_closure === 'number' ? sc.delta_closure : null;
  const noTasks = closed === 0 && overdue === 0 && stuck === 0;

  let dot, label;
  if (!noTasks && (closure < 0.60 || overdue >= 3 || stuck >= 2)) { dot = '🔴'; label = 'atenção'; }
  else if (!noTasks && (closure < 0.85 || overdue >= 1)) { dot = '🟡'; label = 'de olho'; }
  else { dot = '🟢'; label = 'no ritmo'; }

  let badge = '';
  if (dot === '🟢' && closure >= 0.85 && !noTasks) badge = '🥇';
  if (delta != null && delta >= 10) badge = (badge ? badge + ' ' : '') + '📈';

  return { dot, label, badge };
}

// ── Seção 🏆 Scorecard (semáforo dos líderes de verdade + badges) ────────────
// scorecards: [{ leader_name, closure_rate(0-1), tasks_overdue, tasks_stuck,
//                tasks_closed, delta_closure? }]. Ordena pior→melhor.
function formatScorecardSection(scorecards) {
  const rows = (scorecards || []).filter(Boolean);
  if (rows.length === 0) return '';
  const order = { 'atenção': 0, 'de olho': 1, 'no ritmo': 2 };
  const ranked = rows.map((sc) => ({ sc, b: badgeForScorecard(sc) }));
  ranked.sort((a, b) =>
    (order[a.b.label] - order[b.b.label]) || ((a.sc.closure_rate ?? 0) - (b.sc.closure_rate ?? 0))
  );
  const lines = ranked.map(({ sc, b }) => {
    const pct = Math.round((sc.closure_rate ?? 0) * 100);
    const od = sc.tasks_overdue ? ` · ${sc.tasks_overdue} atras.` : '';
    const badge = b.badge ? ` ${b.badge}` : '';
    const name = String(sc.leader_name || '—').split(' ')[0];
    return `${b.dot} *${name}* — ${pct}%${od}${badge}`;
  });
  return `🏆 *Scorecard da semana*\n${lines.join('\n')}`;
}

// ── Montagem do digest com guard de tamanho ─────────────────────────────────
// header/footer: strings (sempre mantidos). sections: [{ text, droppable? }] na
// ORDEM de exibição. Se estourar maxChars, corta da CAUDA as seções droppable=true
// (uma a uma) e adiciona uma nota "+ mais na dashboard". Retorna { message, dropped }.
function assembleDigest({ header, sections, footer, maxChars = DEFAULT_MAX } = {}) {
  const all = (sections || []).filter((s) => s && s.text && String(s.text).trim());
  const render = (list) => [header, ...list.map((s) => s.text), footer]
    .filter((x) => x && String(x).trim())
    .join(`\n\n${HR}\n\n`);

  let full = render(all);
  if (full.length <= maxChars) return { message: full, dropped: [] };

  // Estourou: tira as droppable da cauda até caber.
  const kept = all.slice();
  const dropped = [];
  for (let i = kept.length - 1; i >= 0 && render(withNote(kept, dropped)).length > maxChars; i--) {
    if (kept[i].droppable) {
      dropped.unshift(kept[i]);
      kept.splice(i, 1);
    }
  }
  return { message: render(withNote(kept, dropped)), dropped };
}

// Acrescenta a nota de cauda cortada (se houve corte) como uma "seção" final leve.
function withNote(kept, dropped) {
  if (!dropped.length) return kept;
  const n = dropped.length;
  return [...kept, { text: `_+ ${n} bloco${n > 1 ? 's' : ''} a mais na dashboard 📊_` }];
}

module.exports = { badgeForScorecard, formatScorecardSection, assembleDigest, HR, DEFAULT_MAX };

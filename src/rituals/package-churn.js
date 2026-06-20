// src/rituals/package-churn.js
// DETECTOR de churn de pacote de grupo (B, 20/06). Sinal exato da dor recorrente da Rose:
// o motor de recorrência criou, em 12-13/06, VÁRIOS containers (is_group) pro MESMO pacote
// ("Conciliação de Cartões" tinha 4-5), e cada tela ressuscitava o lixo de um jeito.
// O motor parou de duplicar desde 13/06 — então isto é uma REDE DE SEGURANÇA: se voltar a
// duplicar algum dia, o health-check flagra no MESMO dia (antes da Rose achar). Funções puras.

'use strict';

// Espelha packageInMonth do PWA (web/src/lib/groupWorkspace.ts) — a MESMA regra que decide
// se um container-instância aparece no painel do mês. Container duplicado = >1 visível no mesmo
// (grupo, título) no mês corrente. Mantém este detector alinhado ao que o usuário REALMENTE vê.
function packageVisibleThisMonth(status, dueYmd, ym) {
  if (status === 'cancelled') return false;
  if (dueYmd && dueYmd.slice(0, 7) === ym) return true;          // vence no mês corrente
  if (status !== 'done' && (!dueYmd || dueYmd.slice(0, 7) < ym)) return true; // ciclo aberto (sem prazo / mês passado)
  return false;
}

// rows: [{ group_id, group_name?, title, status, due_date }] — JÁ filtrados na query
// (is_group=true, instância [recurrence_rule null], data_classification='real', não-cancelado).
// → [{ group_id, group_name, title, count }] só com count>1 (pacote duplicado visível no mês).
function findDuplicatePackages(rows, ym) {
  const byKey = new Map();
  for (const r of rows || []) {
    if (!packageVisibleThisMonth(r.status, r.due_date, ym)) continue;
    const k = `${r.group_id}|${r.title}`;
    if (!byKey.has(k)) byKey.set(k, { group_id: r.group_id, group_name: r.group_name || null, title: r.title, count: 0 });
    byKey.get(k).count++;
  }
  return [...byKey.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count);
}

module.exports = { packageVisibleThisMonth, findDuplicatePackages };

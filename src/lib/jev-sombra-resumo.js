'use strict';
// src/lib/jev-sombra-resumo.js — PURO. Resume as linhas da sombra do Jev (ver lib/jev-sombra.js).
const CONF_ALTA = 0.9;
// skill do pickSkill → assuntos que ela ensina (marcadores conferidos nos arquivos de skills/, 09/10)
const COBRE = {
  'checklist-tarefas': ['tarefas', 'agenda', 'recados'], gerencia: ['recados', 'tarefas'], pedagogico: ['recados', 'tarefas'],
  'operacoes-tecnicas': ['manutencao', 'tarefas'], 'planejamento-semanal': ['consulta'], 'consultar-projeto': ['projetos', 'consulta'],
  'governanca-completa': ['consulta'], 'financeiro-pessoal': ['financeiro'], 'criar-compromisso': ['agenda'],
  'criar-recorrencia': ['tarefas'], 'lembrete-recorrente': ['tarefas'], 'habitos-pessoais': ['habitos'], none: ['conversa'],
};
// ação do Jev → marcadores do TOM que fazem essa ação
const MARCADOR = {
  tarefa_criar: /TASK_UPDATE|TASK_CREATE/, tarefa_concluir: /TASK_UPDATE/, tarefa_reagendar: /TASK_UPDATE/, tarefa_cancelar: /TASK_UPDATE/,
  tarefa_delegar: /TASK_UPDATE/, evento_criar: /EVENT_CREATE/, evento_concluir: /EVENT_UPDATE/, evento_rsvp: /EVENT_UPDATE/,
  evento_editar: /EVENT_UPDATE/, recado: /COORDINATION_REQUEST/, manutencao_registrar: /INVENTORY_ACTION|TASK_UPDATE/,
  gasto_registrar: /FINANCE_ACTION/, habito: /HABIT_ACTION|TASK_TO_HABIT/,
};
const acao = (l) => (l.caixa === 'confirmacao_do_tom' ? l.caixa_jev : l.caixa);
const alta = (l) => Math.min(l.conf_gaveta ?? 0, l.conf_caixa ?? l.conf_gaveta ?? 0) >= CONF_ALTA;

function resumir(linhas) {
  const ok = linhas.filter((l) => l.gaveta);
  const erros = linhas.length - ok.length;
  const ms = ok.map((l) => l.ms || 0).sort((a, b) => a - b);
  const custo = ok.reduce((s, l) => s + (l.custo || 0), 0);
  const out = [];
  out.push(`🔎 Sombra do Jev · ${linhas.length} turnos · ${erros} sem resposta do Jev · p50 ${ms[Math.floor(ms.length / 2)] || 0} ms · US$ ${custo.toFixed(4)}`);
  out.push('', 'Por assunto (Jev) · pickSkill cobre · TOM emitiu marcador:');
  const por = {};
  for (const l of ok) {
    const p = (por[l.gaveta] = por[l.gaveta] || { n: 0, cobre: 0, emitiu: 0, alta: 0 });
    p.n++; if ((COBRE[l.skill_pick] || []).includes(l.gaveta)) p.cobre++; if (l.tom_marcador) p.emitiu++; if (alta(l)) p.alta++;
  }
  for (const [g, p] of Object.entries(por).sort((a, b) => b[1].n - a[1].n)) out.push(`• ${g}: ${p.n} (conf ≥0,9: ${p.alta}) · pickSkill ${p.cobre}/${p.n} · TOM marcou ${p.emitiu}/${p.n}`);

  const pedidos = ok.filter((l) => MARCADOR[acao(l)] && alta(l));
  const semMarcador = pedidos.filter((l) => !l.tom_marcador);
  const outroMarcador = pedidos.filter((l) => l.tom_marcador && !MARCADOR[acao(l)].test(l.tom_marcador));
  out.push('', `Jev viu pedido de gravação (conf ≥0,9): ${pedidos.length} · TOM sem marcador: ${semMarcador.length} · TOM com outro marcador: ${outroMarcador.length}`);
  for (const l of semMarcador.slice(0, 15)) out.push(`  – sem marcador · ${acao(l)}${l.fala_curta ? ' (fala curta)' : ''} · "${String(l.fala).slice(0, 80)}"${l.tom_acionavel ? ' · ACTIONABLE_NO_MARKER' : ''}`);
  for (const l of outroMarcador.slice(0, 10)) out.push(`  – outro marcador · Jev ${acao(l)} × TOM ${l.tom_marcador} · "${String(l.fala).slice(0, 70)}"`);

  const conversaComMarcador = ok.filter((l) => ['conversa', 'consulta'].includes(l.gaveta) && alta(l) && l.tom_marcador);
  out.push('', `TOM gravou e o Jev achou que era só ${'conversa/consulta'} (conf ≥0,9): ${conversaComMarcador.length}`);
  for (const l of conversaComMarcador.slice(0, 10)) out.push(`  – ${l.tom_marcador} · "${String(l.fala).slice(0, 80)}"`);

  const asm = linhas.filter((l) => l.tom_acionavel && !l.tom_marcador);
  out.push('', `ACTIONABLE_NO_MARKER do TOM: ${asm.length} · Jev deu ação de gravação em ${asm.filter((l) => MARCADOR[acao(l)]).length}`);
  const semCaixa = ok.filter((l) => ['projetos', 'consulta', 'financeiro'].includes(l.gaveta) && alta(l) && !l.tom_marcador);
  out.push('', `Assuntos sem gravação no TOM (o que ele só conversa): ${semCaixa.length}`);
  for (const l of semCaixa.slice(0, 15)) out.push(`  – ${l.gaveta} · "${String(l.fala).slice(0, 80)}"`);
  return out.join('\n');
}

module.exports = { resumir, COBRE, MARCADOR };

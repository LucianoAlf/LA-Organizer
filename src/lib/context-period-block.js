'use strict';
// CTX-LEITURA-DETERMINISTICA — fatia 1 (27/08). Renderiza o bloco de CONSULTA do período que o
// usuário citou, alimentado pela RPC `tom_tarefas_por_periodo` (fonte única).
//
// O ponto do bloco não é mostrar mais tarefas — é dar ao TOM uma lista cujo VAZIO é confiável.
// O bloco de briefing é cortado (max_daily_tasks, teto de caracteres) e por isso "não vejo nada"
// ali nunca provou ausência. Aqui a lista é a resposta COMPLETA daquele período: se veio vazia,
// negar é honesto; se veio cheia, negar é erro. É a diferença entre não ter visto e ter olhado.

const MAX_ITENS = 30;
const MAX_DESC = 160;

function _fmtBr(ymd) {
  const s = String(ymd || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s;
}

function renderBlocoPeriodo(periodo, tarefas, hojeYmd) {
  if (!periodo || !periodo.de || !periodo.ate) return '';
  const lista = Array.isArray(tarefas) ? tarefas : [];
  const umDia = periodo.de === periodo.ate;
  const quando = umDia ? _fmtBr(periodo.de) : `${_fmtBr(periodo.de)} a ${_fmtBr(periodo.ate)}`;
  const cab = `## 🔎 Consulta do período: ${periodo.rotulo} (${quando})`;

  const linhas = [cab];
  if (!lista.length) {
    linhas.push(
      `**Nenhuma tarefa com prazo neste período.** Esta consulta foi direto ao banco e é COMPLETA `
      + `para ${quando} — pode afirmar que não há nada NESTE período (e só nele; não vale pra outras datas).`,
    );
    return linhas.join('\n');
  }

  const mostradas = lista.slice(0, MAX_ITENS);
  linhas.push(
    `**${lista.length} tarefa(s)** — consulta direto ao banco, COMPLETA para ${quando}. `
    + `Esta é a resposta certa sobre este período: não diga que não há nada.`,
  );
  mostradas.forEach((t, i) => {
    const sid = String((t && t.id) || '').slice(0, 8);
    const feito = t && t.status === 'done' ? '✅ ' : '';
    const atrasada = t && t.status !== 'done' && t.due_date && hojeYmd && t.due_date < hojeYmd ? '🔴 ' : '';
    const ctx = t && t.context === 'personal' ? 'pessoal' : t && t.context === 'work' ? 'trabalho' : '';
    const dia = umDia ? '' : ` 📅 ${_fmtBr(t && t.due_date)}`;
    linhas.push(`${i + 1}. [id=${sid}] ${atrasada}${feito}${(t && t.title) || '(sem título)'}${ctx ? ` (${ctx})` : ''}${dia}`);
    const desc = String((t && t.description) || '').trim().replace(/\s+/g, ' ');
    if (desc) linhas.push(`   ↳ ${desc.length > MAX_DESC ? desc.slice(0, MAX_DESC) + '…' : desc}`);
  });
  // Truncar aqui seria reintroduzir o bug original — então o corte, se houver, é declarado.
  if (lista.length > mostradas.length) {
    linhas.push(`_(+${lista.length - mostradas.length} além das ${MAX_ITENS} listadas — o total acima é o número real.)_`);
  }
  return linhas.join('\n');
}

module.exports = { renderBlocoPeriodo, MAX_ITENS };

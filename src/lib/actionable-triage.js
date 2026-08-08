'use strict';
// actionable-triage.js — separa o ACTIONABLE_NO_MARKER que IMPORTA do ruído.
//
// O detector grava quando o TOM verbaliza uma ação e nenhum marker é executado no turno. Ele
// funciona: apontou `MEMORY_SAVE schema_invalid` (Matheus 04/08) e um `<<FINANCE_ENTRY>>`
// inventado que o parser removeu (Rose 25/07). O problema é a proporção — na medição de 14
// dias, 4 reais entre 18 alertas. Ruído nessa taxa faz o alerta parar de ser lido, e ele vai
// TODO DIA pro WhatsApp do Alf e do Hugo no relatório das 07h.
//
// A LIÇÃO QUE ESTE ARQUIVO CARREGA: eu classifiquei esses mesmos 18 como "zero reais" olhando
// se o dado existia no banco no fim. Existia — mas a memória do Matheus só entrou na TERCEIRA
// tentativa; as duas primeiras foram `rejected`. **Olhar o estado final esconde a falha; quem
// conta a verdade é o marker do TURNO.** Por isso a classificação aqui é feita sobre os
// markers da janela, nunca sobre "o dado está lá".

// Verbo no passado/gerúndio = o TOM afirmou que fez. É o que precisa de prova.
// Sem \b: em JS ele é ASCII e não casa depois de "ã"/"í" (buraco que já custou meses aqui).
const AFIRMOU_FEITO_RE = new RegExp(
  '(?:^|[^\\p{L}])(?:anotado|anotei|registrado|registrei|salvo|salvei|criado|criei|agendado|'
  + 'agendei|marcado|marquei|reagendado|reagendei|atualizado|atualizei|fechado|fechei|'
  + 'registrando|salvando|anotando|criando|agendando)(?![\\p{L}])', 'iu');

// Pergunta no fim = o TOM está coletando, não prometendo. "confirma qual dos dois que já crio"
// é pedido de informação, não ação pendente.
const TERMINA_EM_PERGUNTA_RE = /\?\s*["'*_)\]]*\s*$/;

// Marcadores de listagem: o TOM está MOSTRANDO o que existe, não mudando nada.
const EH_LISTAGEM_RE = /(?:^|\n)\s*(?:[•\-*]|\d+[.)]|[⏰📋🔴🟠🟡✅👉])\s/;

// Tipos que não provam ação: são metadados do próprio pipeline.
const MARKERS_NAO_PROBATORIOS = new Set([
  'LEAK_BLOCKED', 'UNKNOWN_MARKER_STRIPPED', 'TOOL_CALL_STRIPPED', 'PROVIDER',
  'REACT', 'ACTIONABLE_NO_MARKER', 'CHOKEPOINT', 'CONFIRM_NOEXEC',
]);

/**
 * Classifica um alerta a partir do texto do TOM e dos markers do MESMO turno.
 * `markers`: [{ marker_type, result, reason }] da janela do turno.
 * Devolve { real, motivo, detalhe } — `real:true` é o que merece ir pro relatório.
 */
function classificarActionable(replyDoTom, markers = []) {
  const reply = String(replyDoTom || '').replace(/^text:/i, '').trim();
  const lista = Array.isArray(markers) ? markers : [];

  // 1) FALHA VISÍVEL — o mais grave e o mais acionável: ele TENTOU e o marker foi recusado.
  // Vem antes de tudo: um turno pode ter uma gravação certa e outra rejeitada (Matheus 10:01),
  // e a que falhou é a que interessa.
  const falhou = lista.find((m) => m && m.result === 'rejected'
    && m.marker_type && m.marker_type !== 'ACTIONABLE_NO_MARKER');
  if (falhou) {
    return {
      real: true,
      motivo: 'marker_rejeitado',
      detalhe: `${falhou.marker_type}${falhou.reason ? ` (${falhou.reason})` : ''}`,
    };
  }

  // 2) Ação persistida no turno — inclui o auto-retry, que é recuperação legítima.
  const ok = lista.find((m) => m && m.result === 'executed'
    && m.marker_type && !MARKERS_NAO_PROBATORIOS.has(m.marker_type));
  if (ok) return { real: false, motivo: 'persistido_no_turno', detalhe: ok.marker_type };

  // 3) Sem texto não há promessa a cobrar.
  if (!reply) return { real: false, motivo: 'sem_texto', detalhe: null };

  // 4) Pergunta no fim: coleta de informação, não promessa.
  if (TERMINA_EM_PERGUNTA_RE.test(reply)) return { real: false, motivo: 'pergunta', detalhe: null };

  // 5) Sem verbo de "já fiz", não há o que provar. Pega a conversa solta ("A frota chegou,
  // Alf! 🛸") e o compromisso futuro ("quando tiver pronto é só mandar"), que não é ação feita.
  if (!AFIRMOU_FEITO_RE.test(reply)) return { real: false, motivo: 'sem_afirmacao_de_feito', detalhe: null };

  // 6) Afirmou algo E é listagem → está relatando o que já existe no banco, não criando.
  if (EH_LISTAGEM_RE.test(reply)) return { real: false, motivo: 'listagem', detalhe: null };

  return { real: true, motivo: 'afirmou_sem_persistir', detalhe: null };
}

module.exports = { classificarActionable, AFIRMOU_FEITO_RE };

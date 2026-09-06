'use strict';

// A ANCORA DO BRIEFING (06/09/2026) — irma da que o fechamento ja tinha em engine.js.
//
// CASO BIANCA (03/09). O briefing listou "1. ⏰ 19h — Revisar relatorios dos pacientes". Ela
// respondeu "Relatorios revisados" e ouviu "nao achei nenhuma tarefa com esse nome". A recusa
// estava CERTA: aquela tarefa esta concluida desde 28/07. Rodando o prompt do dia: o contexto
// tinha ZERO tarefa dela, e a linha veio de uma MEMORIA ("Bianca precisa revisar relatorios as
// 19h"). O fechamento ja tinha lista deterministica; o briefing nao tinha. Sem ancora, memoria
// vira item numerado — e item numerado, pra quem le, e promessa de que aquilo existe e pode ser
// fechado. Deu dois achados de auditoria com a mesma raiz.
//
// POR QUE AQUI E NAO NO TEMPLATE. O texto do briefing mora em `skills/`, que e veto do dono — a
// voz do TOM nao se mexe pra consertar bug. A ancora do fechamento nunca precisou de `skills/`:
// ela e uma secao que o ENGINE acrescenta ao system prompt, com a lista que ELE calculou. Este
// modulo faz a mesma coisa pro briefing, pelo mesmo caminho.
//
// O CASO VAZIO E O PRINCIPAL, e e por isso que esta funcao nunca devolve string vazia. Zero
// tarefa foi exatamente a situacao da Bianca: uma secao que simplesmente nao aparece devolve ao
// modelo a liberdade que causou o defeito. Quem nao tem o que numerar precisa ouvir "nao numere"
// mais alto que quem tem.
//
// E ela NAO afirma que o dia esta livre: nao ter tarefa NUMERAVEL nao e a mesma coisa que nao ter
// nada acontecendo (evento, habito e recado seguem existindo, cada um com a sua regra). Afirmar
// folga a partir de uma lista vazia seria trocar um chute por outro.

const CABECALHO = '### 🔢 ITENS DO BRIEFING (USE EXATAMENTE esta numeração e títulos)';

const PROIBICAO = 'NÃO numere nada que não esteja nesta lista. Memória, hábito, observação, '
  + 'evento e recado NÃO são tarefa e não recebem número — item numerado é lido como tarefa que '
  + 'existe e pode ser fechada, e a pessoa vai tentar fechar.';

// `falhou` e o TERCEIRO estado, e ele existe porque os outros dois sao afirmacoes. "Nao ha
// tarefa numeravel" e uma afirmacao sobre o dia da pessoa; se o calculo da lista quebrou, eu nao
// sei se ha ou nao — dizer que nao ha seria trocar um chute por outro, agora com a assinatura do
// engine embaixo. A proibicao de numerar vale ainda MAIS aqui: e o unico caso em que nem eu sei
// o que existe.
function secaoDoBriefing(itens, { falhou = false } = {}) {
  const lista = (Array.isArray(itens) ? itens : []).filter((i) => i && i.title);
  if (falhou) {
    return `${CABECALHO}

Não consegui montar a lista de tarefas desta pessoa agora. ${PROIBICAO}

`
      + 'Não afirme que o dia está livre nem que existe algo pendente: eu não sei.';
  }
  if (!lista.length) {
    return `${CABECALHO}\n\nHoje não há nenhuma tarefa numerável para esta pessoa. ${PROIBICAO}\n\n`
      + 'Isso NÃO quer dizer que o dia está livre: só quer dizer que não há item para numerar.';
  }
  // Titulo multi-linha quebraria a numeracao: a linha 2 do titulo viraria uma linha solta que o
  // modelo pode ler como outro item. Achata pra uma linha so.
  const linhas = lista
    .map((i, k) => `${i.index || k + 1}. ${String(i.title).replace(/\s*\n+\s*/g, ' ').trim()}`)
    .join('\n');
  return `${CABECALHO}\n${linhas}\n\n${PROIBICAO}`;
}

module.exports = { secaoDoBriefing };

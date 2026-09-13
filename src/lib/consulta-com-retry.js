'use strict';
// consulta-com-retry.js — FONTE-CAI-E-A-PAUTA-DESISTE (auditoria cruzada 13/09).
//
// Em 12/09 às 15:00 a consulta do LA Report falhou UMA vez e o lembrete da hora não saiu ("não cobro
// sem a fonte" — comportamento certo: afirmar sem a fonte é pior). Só que a falha era passageira:
// testado em 13/09, a mesma RPC devolve 340 linhas. Uma tentativa a mais teria salvo a cobrança
// daquela hora, e as unidades não teriam ficado sem o aviso.
//
// Regra: só a CONSULTA é repetida — nada aqui escreve. Se a segunda também falhar, devolve o erro
// igualzinho, e o caminho de falha-fechada de sempre segue valendo. `sleep` é injetável pra o teste
// não dormir. PURO (a consulta vem de fora).

async function consultaComRetry(consulta, opts = {}) {
  const tentativas = Math.max(1, Number(opts.tentativas) || 2);
  const esperaMs = Number.isFinite(opts.esperaMs) ? opts.esperaMs : 800;
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : ((ms) => new Promise((r) => setTimeout(r, ms)));
  let ultimo = null;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await consulta();
      if (!r || !r.error) return Object.assign({}, r || {}, { tentativas: i });
      ultimo = r;
    } catch (e) {
      // Exceção (rede, cliente) é a MESMA coisa que erro da RPC pra quem chama: a fonte não respondeu.
      ultimo = { data: null, error: { message: (e && e.message) || String(e) } };
    }
    if (i < tentativas) await sleep(esperaMs);
  }
  return Object.assign({}, ultimo || { data: null, error: { message: 'sem resposta' } }, { tentativas });
}

module.exports = { consultaComRetry };

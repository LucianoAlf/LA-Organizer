// audit-cegueira.js -- a trava que impede o ciclo de dizer "nada novo" tendo ficado CEGO.
//
// O buraco que isto fecha (01/09): de 29/08 a 01/09 a auditoria falhou pra 15-20 pessoas por
// noite (`all_providers_failed`), o `catch` devolvia [] e o relatorio saia "Auditoria de 01/09
// -- nada novo". Zero achado por FALHA e byte-a-byte identico a zero achado por SAUDE, entao
// ninguem notou por 4 dias. O sensor em conversation-audit.js grava a cegueira; esta trava
// garante que ela CHEGA no grupo.
//
// Deterministica de proposito, como as irmas (tirarFalaDeRestart, rebaixarClaimDeEntrega):
// prosa de LLM nao e garantia. Se houve cegueira, a frase tranquilizadora cai e entra a
// medida real. Se nao houve, o texto passa intacto -- byte por byte.
const NADA_NOVO_RE = /\b(?:nada\s+novo|nenhum\s+achado\s+novo|sem\s+achados?\s+novos?|nada\s+a\s+relatar|tudo\s+limpo)\b/gi;

function rebaixarNadaNovoComCegueira(texto, cegos) {
  const t = typeof texto === 'string' ? texto : '';
  const n = Number(cegos) || 0;
  if (!t || n <= 0) return { texto: t, rebaixou: false, cegos: n };
  const pessoas = n === 1 ? '1 conversa' : `${n} conversas`;
  const aviso = `\n\n_\u26a0\ufe0f Este ciclo NAO conseguiu auditar ${pessoas}: o provedor falhou. `
    + `O que esta escrito acima vale so pro que deu pra olhar._`;
  // A frase tranquilizadora sai; sem isso o aviso vira contradicao dentro da mesma mensagem
  // (licao Ana 30/06: anexar SEM remover e pior que remover).
  const semFrase = t.replace(NADA_NOVO_RE, 'nada novo NO QUE DEU PRA OLHAR');
  return { texto: semFrase + aviso, rebaixou: true, cegos: n };
}

module.exports = { rebaixarNadaNovoComCegueira, NADA_NOVO_RE };

// RESUMO-SEMANAL-VIROU-AGENDA (Alf 30/09 19:04 BRT): o resumo semanal 75020d33 (gerado domingo
// 27/09 22:08 BRT) guardou "Jornada de Cordas … remarcada para 30/09, 13h–17h" como FATO. O
// evento foi cancelado em 29/09 e remarcado pra 07/10, a agenda do prompt estava certa — mas o
// resumo entrava no prompt DUAS vezes ("O que sei sobre" e depois do perfil) com o compromisso
// velho, e o fechamento de 30/09 perguntou "rolou?" de um evento que não existia mais.
//
// O resumo é um RETRATO do passado. Compromisso futuro já tem fonte própria e viva (a seção de
// agenda); no resumo ele só pode estar igual (redundante) ou velho (veneno). Então:
//  • na GERAÇÃO: o prompt proíbe compromisso futuro, e o texto do modelo passa pelo mesmo filtro
//    determinístico antes de gravar (o modelo pode desobedecer; o filtro não);
//  • na LEITURA: o bloco sai com cabeçalho "retrato de DD/MM — … a agenda real é a seção de
//    agenda" e as linhas com data DEPOIS do dia do retrato são tiradas (vale pras linhas velhas
//    que já estão gravadas, sem editar o banco).
// Régua: data estritamente MAIOR que o dia (BRT) em que o retrato foi gerado. O gerador roda
// domingo 22h — o que é do próprio dia já passou; o que vem depois é agenda, não memória.
// Linha com QUALQUER data futura sai inteira (ex.: "de 23/09 → 28/09 → 25/09"): é a opção simples
// e segura — reescrever em tempo verbal passado exigiria outro LLM, e o fato vivo está na agenda.
'use strict';

// Mês com 2 dígitos de propósito: "3/3 confirmaram" é fração, não data.
const DATA_DDMM = /(?:^|[^\d/])(\d{1,2})\/(\d{2})(?:\/(\d{2,4}))?(?![\d/])/g;
const TITULO_DA_SEMANA = /^\s*(?:#+\s*)?\*{1,2}[^*\n]*\b(?:semana|semanal|resumo)\b[^*\n]*\*{1,2}\s*$/i;

function ymdBRT(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d);
}

function ddmm(ymd) {
  const [, m, d] = String(ymd || '').split('-');
  return d && m ? `${d}/${m}` : '';
}

function addDias(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Dia do retrato: quando foi gerado (created_at, em BRT). Sem created_at: fim da janela (week_start+7).
function diaDoRetrato(ws) {
  if (!ws) return null;
  return ymdBRT(ws.created_at) || (ws.week_start ? addDias(String(ws.week_start).slice(0, 10), 7) : null);
}

// Datas dd/mm(/aaaa) da linha, resolvidas pro ano mais próximo do retrato.
function datasDaLinha(linha, retratoYmd) {
  const out = [];
  const anoRef = Number(String(retratoYmd).slice(0, 4));
  const tRef = new Date(`${retratoYmd}T12:00:00Z`).getTime();
  DATA_DDMM.lastIndex = 0;
  let m;
  while ((m = DATA_DDMM.exec(linha)) !== null) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    let ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : anoRef;
    const mk = (a) => `${a}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    if (!m[3]) {
      // 05/01 num retrato de dezembro é janeiro do ano seguinte (e vice-versa).
      const t = new Date(`${mk(ano)}T12:00:00Z`).getTime();
      if (t - tRef > 183 * 864e5) ano -= 1;
      else if (tRef - t > 183 * 864e5) ano += 1;
    }
    out.push(mk(ano));
  }
  return out;
}

function neutralizarCompromissosFuturos(texto, retratoYmd) {
  const res = { texto: String(texto || ''), removidas: [] };
  if (!texto || !/^\d{4}-\d{2}-\d{2}$/.test(String(retratoYmd || ''))) return res;
  const ficam = [];
  for (const linha of String(texto).split('\n')) {
    // Título da janela ("**Resumo semanal — semana até 17/08/2026**") descreve o período, não é
    // compromisso — e o gerador roda domingo 22h BRT, quando a data UTC já é segunda.
    if (TITULO_DA_SEMANA.test(linha)) { ficam.push(linha); continue; }
    const futuras = datasDaLinha(linha, retratoYmd).filter((d) => d > retratoYmd);
    if (futuras.length) res.removidas.push({ linha, datas: futuras });
    else ficam.push(linha);
  }
  if (res.removidas.length) res.texto = ficam.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return res;
}

function cabecalhoDoRetrato(ws) {
  const dia = diaDoRetrato(ws);
  const semana = ws && ws.week_start ? ` (semana a partir de ${ddmm(String(ws.week_start).slice(0, 10))})` : '';
  return `**Retrato de ${ddmm(dia) || '?'}${semana} — compromissos aqui podem ter mudado; a agenda real é a seção de agenda.** ` +
    'Isto é memória do passado: NUNCA liste nada deste bloco como compromisso de hoje nem pergunte "rolou?" a partir dele.';
}

// Bloco pronto pro prompt (linhas). Vazio se não há resumo.
function renderResumoSemanal(ws) {
  if (!ws || !ws.summary) return [];
  const dia = diaDoRetrato(ws);
  const { texto, removidas } = neutralizarCompromissosFuturos(ws.summary, dia);
  const linhas = [cabecalhoDoRetrato(ws), texto];
  if (removidas.length) {
    linhas.push(`_(${removidas.length} linha(s) com compromisso depois de ${ddmm(dia)} tirada(s) deste retrato — o que ainda vale está na seção de agenda.)_`);
  }
  return linhas;
}

function promptDoResumoSemanal({ nome, historyText, hojeYmd }) {
  const hoje = ddmm(hojeYmd);
  return `Você é um assistente que cria resumos semanais de contexto para ${nome}.
Hoje é ${hoje}. Este resumo é um RETRATO DO PASSADO (a semana que termina hoje) — ele vai ser lido nas próximas semanas, quando os planos já podem ter mudado.

Com base no histórico de conversa abaixo (última semana), escreva um resumo conciso em português (máximo 300 palavras) cobrindo:
- Principais tarefas e compromissos que ACONTECERAM (ou deviam ter acontecido) na semana
- Decisões importantes tomadas
- Contexto pessoal relevante mencionado
- Padrões ou temas recorrentes

REGRA DE DATAS (obrigatória):
- NÃO registre compromisso FUTURO (data depois de ${hoje}) como fato. Evento marcado, remarcado ou confirmado pra depois de hoje NÃO entra no resumo — a agenda do sistema é a fonte viva disso e muda (cancela, remarca).
- Se for indispensável citar algo futuro, NÃO escreva a data dele; escreva só "tinha compromisso agendado — conferir a agenda".
- Compromissos da semana que passou: tempo verbal passado, com a data em que eram ("estava marcado pra 25/09").

NÃO invente informações. Se algo não ficou claro, omita. Seja direto e útil.

HISTÓRICO:
${historyText}

RESUMO:`;
}

module.exports = {
  ymdBRT, diaDoRetrato, datasDaLinha, neutralizarCompromissosFuturos,
  cabecalhoDoRetrato, renderResumoSemanal, promptDoResumoSemanal,
};

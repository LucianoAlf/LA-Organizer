'use strict';
// governanca-resumo.js — a segunda seção do relatório das 07h: o que foi FEITO e o que REINCIDIU.
//
// Até 09/08 o relatório só contava o que está quebrado. Com o agente de governança no ar,
// metade da história é o que já foi consertado — e principalmente o que VOLTOU depois de
// consertado. Sem essa metade, quem lê vê "3 alertas" todo dia e não sabe dizer se o sistema
// está melhorando ou andando em círculo.
//
// A linha de reincidência é o velocímetro do próprio agente: é ela que denuncia fix pontual
// que não pega na raiz. Ver src/lib/placar-governanca.js.

const { calcularPlacar, ehDoAgente, temMarcaDoAgente, MARCA_AGENTE } = require('./placar-governanca');

const HORAS_PADRAO = 24;
const MAX_CODIGOS = 2;   // WhatsApp num celular; lista longa não é lida

function _n(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function _diasEntre(ymdA, ymdB) {
  const a = YMD_RE.exec(String(ymdA || '')); const b = YMD_RE.exec(String(ymdB || ''));
  if (!a || !b) return null;
  // Aritmética em UTC sobre YMD já resolvido em BRT — sem conversão de fuso não há como
  // deslocar o dia (LOCALYMD-UTC-SHIFT). Vira mês e ano sem tropeçar.
  const ms = Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3]);
  return Math.round(ms / 86400000);
}
function _ddmm(ymd) { const m = YMD_RE.exec(String(ymd || '')); return m ? `${m[3]}/${m[2]}` : ''; }
const _FMT_BRT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Monta a seção. PURA: recebe números prontos, não fala com banco.
 * Devolve '' quando não há dados — a seção some do relatório em vez de imprimir lixo.
 */
function formatarResumoGovernanca(dados) {
  if (!dados || typeof dados !== 'object') return '';

  const correcoes = Array.isArray(dados.correcoes) ? dados.correcoes.filter(Boolean) : [];
  const fechados = _n(dados.achadosFechados);
  const placar = dados.placar && typeof dados.placar === 'object' ? dados.placar : null;
  const reincidentes = placar && Array.isArray(placar.reincidentes) ? placar.reincidentes : [];
  const emParada = placar && Array.isArray(placar.emParada) ? placar.emParada : [];

  // GOVRESUMO-JANELA-ROTULO-ENGANA (14/08): o rótulo "(24h)" fazia o leitor entender "hoje".
  // A janela é ROLANTE — às 07:00 ela cobre ontem-07:00 → hoje-07:00 — e o ciclo do dia só
  // roda às 08:00. Em 14/08 esta DM anunciou a correção de ONTEM como se fosse a de hoje,
  // enquanto o grupo, uma hora depois, anunciou a verdadeira: dois relatórios do mesmo
  // sistema se contradizendo na frente do dono.
  //
  // Irmão do GOVRESUMO-CICLO-ALARME-FALSO: lá a janela do produtor não era a do consumidor
  // ao dizer "não rodou"; aqui é ao dizer "o que rodou".
  //
  // A correção é o RÓTULO, não a janela: datar o que está sendo mostrado, para quem lê
  // descobrir sozinho que é o ciclo de ontem. Sem data conhecida, não inventa.
  const _ymdDaCorrecao = (() => {
    const ts = correcoes.map((c) => c && c.corrigido_em).filter(Boolean).sort().pop();
    if (!ts) return null;
    try { return _FMT_BRT.format(new Date(ts)); } catch (_) { return null; }
  })();
  const linhas = [_ymdDaCorrecao
    ? `📊 *Governança — ciclo de ${_ddmm(_ymdDaCorrecao)}*`
    : '📊 *Governança (últimas 24h)*'];

  // O caso mais valioso do relatório: o ciclo parou de rodar e ninguém percebeu.
  //
  // GOVRESUMO-CICLO-ALARME-FALSO (10/08): a linha só pode falar de PARADA, nunca de "ainda não
  // rodou hoje". Este relatório sai às 07:00 e o ciclo dispara às 08:00 — quem lê às 07:00 lendo
  // "não rodou" aprende a ignorar a linha, e ela morre justo pro dia em que a parada for real.
  // Com a data e a contagem de dias, a frase deixa de ser adjetivo e vira medida verificável.
  if (!dados.cicloRodou) {
    const dias = _diasEntre(dados.ultimoCicloYmd, dados.hojeYmd);
    linhas.push(dias != null && dias > 0
      ? `⚠️ O ciclo de governança *não roda desde ${_ddmm(dados.ultimoCicloYmd)}* (${dias} dia${dias > 1 ? 's' : ''}) — nenhum achado está sendo tratado.`
      : '⚠️ O ciclo de governança *não rodou* — nenhum achado está sendo tratado.');
    return linhas.join('\n');
  }

  if (correcoes.length) {
    const codigos = correcoes.slice(0, MAX_CODIGOS).map((c) => c.codigo).filter(Boolean).join(', ');
    const resto = correcoes.length > MAX_CODIGOS ? ` +${correcoes.length - MAX_CODIGOS}` : '';
    linhas.push(`🚀 ${correcoes.length} correção(ões): ${codigos}${resto}`);
  }
  // Zero não entra: "0 achados fechados" é ruído, não informação.
  if (fechados > 0) linhas.push(`🧹 ${fechados} achado(s) antigo(s) fechado(s) na varredura`);
  if (!correcoes.length && fechados === 0) {
    // Refutar é entrega; rodada sem alvo também. Nunca relatar como fracasso.
    linhas.push('➖ Rodou e não havia alvo para corrigir.');
  }

  if (reincidentes.length) {
    const det = reincidentes.slice(0, MAX_CODIGOS).map((r) => `${r.codigo} (${_n(r.vezes)}x)`).join(', ');
    linhas.push(`♻️ *Reincidiu:* ${det}`);
    if (emParada.length) {
      linhas.push(`🛑 Em parada (2x): ${emParada.slice(0, MAX_CODIGOS).join(', ')} — precisa de raiz, não de fix.`);
    }
  } else {
    const n = placar ? _n(placar.fechados) : 0;
    linhas.push(n > 0
      ? `♻️ Nenhuma reincidência — ${n} conserto(s) do agente de pé.`
      : '♻️ Nenhuma reincidência.');
  }

  return linhas.join('\n');
}

/**
 * Busca os números das últimas `horas`. Nunca lança: sem dados o relatório sai sem a seção,
 * que é melhor que o relatório inteiro falhar por causa dela.
 */
async function carregarResumoGovernanca(sb, { horas = HORAS_PADRAO, ymd = null } = {}) {
  try {
    const desde = new Date(Date.now() - horas * 3600_000).toISOString();
    const desde90 = new Date(Date.now() - 90 * 86400000).toISOString();

    const [kisRes, findRes, kis90Res, ritualRes] = await Promise.all([
      sb.from('tom_known_issues').select('codigo, fix_resumo, corrigido_em')
        .not('corrigido_em', 'is', null).gte('corrigido_em', desde),
      // `verified_note` é obrigatório aqui: sem ele não dá pra separar o que o AGENTE fechou
      // do que humano fechou à mão. Em 09/08 a diferença era 83 contra 48.
      sb.from('tom_audit_findings').select('id, verified_note').gte('verified_at', desde),
      sb.from('tom_known_issues').select('codigo, corrigido_em, fix_resumo')
        .not('corrigido_em', 'is', null).gte('corrigido_em', desde90),
      // ÚLTIMA rodada, não "a rodada de hoje" (GOVRESUMO-CICLO-ALARME-FALSO): quem consome isto
      // às 07:00 pergunta antes das 08:00 em que o ciclo dispara, e "de hoje" seria sempre vazio.
      sb.from('ritual_logs').select('reference_date').eq('ritual_type', 'gov_agent')
        .eq('status', 'sent').order('created_at', { ascending: false }).limit(1),
    ]);

    // Findings dos 90 dias para o placar (mesma janela do ciclo, senão a taxa não bate).
    const { data: findPlacar } = await sb.from('tom_audit_findings')
      .select('promoted_code, incident_at, auto_triage')
      .not('promoted_code', 'is', null).gte('incident_at', desde90);

    // Dia civil de BRT, nunca toISOString().slice(0,10) — em UTC, depois das 21h "hoje" já é
    // amanhã e o relatório da noite acusaria uma parada que não existe (LOCALYMD-UTC-SHIFT).
    const hojeYmd = ymd || _FMT_BRT.format(new Date());
    const ultimoCicloYmd = (ritualRes.data && ritualRes.data[0] && ritualRes.data[0].reference_date) || null;
    const diasParado = _diasEntre(ultimoCicloYmd, hojeYmd);

    return {
      // Saudável = rodou hoje ou ontem. Dia civil em vez de "últimas N horas" porque a janela de
      // retry vai até as 12h: com limite em horas, o MESMO ciclo saudável passa ou não conforme
      // a hora em que o relatório sair.
      cicloRodou: diasParado != null && diasParado <= 1,
      ultimoCicloYmd,
      hojeYmd,
      correcoes: (kisRes.data || []).filter(ehDoAgente),
      achadosFechados: (findRes.data || []).filter((f) => f && temMarcaDoAgente(f.verified_note)).length,
      placar: calcularPlacar(kis90Res.data || [], findPlacar || []),
    };
  } catch (e) {
    console.warn('[governanca-resumo] não consegui montar a seção:', e.message);
    return null;
  }
}

module.exports = { formatarResumoGovernanca, carregarResumoGovernanca, MARCA_AGENTE, HORAS_PADRAO };

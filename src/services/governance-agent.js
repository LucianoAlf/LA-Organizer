'use strict';
// governance-agent.js — o ciclo diário do agente de governança.
//
// Reusa o spawn do canal de ops (ops-agent.js): CLI `claude` com ferramentas, cwd no repo,
// sanitizador markdown→WhatsApp, split em mensagens, typing sustentado e drain hook de
// restart — tudo provado em produção em 08/08. O que é novo aqui é o PROTOCOLO e o PLACAR.
//
// Spec: docs/superpowers/specs/2026-08-08-agente-governanca-design.md

const fs = require('fs');
const path = require('path');
const opsAgent = require('./ops-agent');
const { calcularPlacar, MARCA_AGENTE } = require('../lib/placar-governanca');
const { entregar } = require('../lib/entrega');

// Os .md são resolvidos a partir DESTE arquivo, não de um caminho absoluto de produção: em
// /opt/LA-Organizer dá exatamente o mesmo lugar, e localmente o teste consegue ler o protocolo
// de verdade em vez de exercitar só o caminho de erro.
const RAIZ = path.join(__dirname, '..', '..');
const PROTOCOLO_PATH = process.env.TOM_GOV_PROTOCOLO || path.join(RAIZ, 'docs/ops/PROTOCOLO-GOVERNANCA.md');
const ESCADA_PATH = process.env.TOM_GOV_ESCADA || path.join(RAIZ, 'docs/ops/ESCADA-GOVERNANCA.md');
// Um ciclo é refutar + reproduzir + corrigir + suíte inteira. 10 min (o default do canal de
// ops) não cobre: a suíte sozinha leva minutos. 02/09: o teto de correção subiu de 1 pra 2 e
// o tempo acompanha (30 → 60 min) — trabalho que estoura o tempo morre SEM COMMIT.
const GOV_TIMEOUT_MS = Number(process.env.TOM_GOV_TIMEOUT_MS || 60 * 60 * 1000);
const GOV_ON = process.env.TOM_GOV_AGENT === '1';
const GOV_OWNER = (process.env.TOM_OPS_ALLOWLIST || '').split(',')[0].trim();
const JANELA_FINDINGS_DIAS = Number(process.env.TOM_GOV_JANELA_DIAS || 2);

function lerArquivo(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch (e) { console.warn(`[GovAgent] não li ${p}: ${e.message}`); return ''; }
}

/** Protocolo + escada. String vazia = protocolo ausente, e aí o ciclo não pode rodar. */
function montarBriefing() {
  const protocolo = lerArquivo(PROTOCOLO_PATH);
  if (!protocolo) return '';
  return [protocolo, lerArquivo(ESCADA_PATH)].filter(Boolean).join('\n\n---\n\n');
}

/** Placar do banco: KIs fechados pelo agente cruzados com os findings triados como regressão. */
async function carregarPlacar(sb) {
  const desde = new Date(Date.now() - 90 * 86400000).toISOString();
  const [kisRes, findRes] = await Promise.all([
    sb.from('tom_known_issues').select('codigo, corrigido_em, fix_resumo')
      .not('corrigido_em', 'is', null).gte('corrigido_em', desde),
    sb.from('tom_audit_findings').select('promoted_code, incident_at, auto_triage')
      .not('promoted_code', 'is', null).gte('incident_at', desde),
  ]);
  return calcularPlacar(kisRes.data || [], findRes.data || []);
}

const STATUS_FECHADOS = ['resolvido', 'falso_positivo', 'wontfix', 'corrigido', 'descartado'];

/**
 * Tamanho e idade do ACERVO de achados abertos. Sem isto o agente só enxerga a janela curta:
 * medido em 09/08, eram 206 abertos e só 1 nos últimos 2 dias — ele rodaria a seco enquanto
 * 106 achados de +30 dias apodreciam. Nunca lança: sem acervo o ciclo roda como antes.
 */
// 30/08 e 02/09: uma linha gravada como 'high' (origem: sombra) ficava fora da contagem e o
// briefing dizia "0 de severidade alta" com 1 no banco — a rodada escolhia alvo achando que
// não havia alto nenhum. O dado foi normalizado pra 'alto'; a contagem aceita o sinônimo
// porque o agente e a sombra também escrevem nessa tabela, fora do VALID_SEVERITY do auditor.
const SEVERIDADE_ALTA = new Set(['alto', 'alta', 'high']);

async function carregarAcervo(sb) {
  try {
    const { data } = await sb.from('tom_audit_findings')
      .select('severity, incident_at')
      .not('status', 'in', `(${STATUS_FECHADOS.join(',')})`);
    const linhas = Array.isArray(data) ? data : [];
    const agora = Date.now();
    const idade = (r) => {
      const t = Date.parse((r && r.incident_at) || '');
      return Number.isFinite(t) ? (agora - t) / 86400000 : null;
    };
    return {
      total: linhas.length,
      alto: linhas.filter((r) => r && SEVERIDADE_ALTA.has(String(r.severity || '').toLowerCase())).length,
      ate2d: linhas.filter((r) => { const d = idade(r); return d !== null && d <= 2; }).length,
      ate7d: linhas.filter((r) => { const d = idade(r); return d !== null && d <= 7; }).length,
      mais30d: linhas.filter((r) => { const d = idade(r); return d !== null && d > 30; }).length,
    };
  } catch (e) {
    console.warn('[GovAgent] não consegui medir o acervo:', e.message);
    return null;
  }
}

/** O pedido que vai ao agente. O protocolo inteiro vai no briefing; aqui vai o estado do dia. */
function montarPedido(placar, acervo) {
  const p = placar || { fechados: 0, reincidentes: [], emParada: [], taxa: 0 };
  const parada = p.emParada.length
    ? `\n\n🛑 EM PARADA — NÃO corrija nada destas famílias, elas já voltaram 2x depois de um fix seu: `
      + `${p.emParada.join(', ')}. Para cada uma, leve ao grupo a proposta de raiz, não um novo fix pontual.`
    : '';
  const reincid = p.reincidentes.length
    ? `\nReincidiram: ${p.reincidentes.map((r) => `${r.codigo} (${r.vezes}x)`).join(', ')}.`
    : '';
  // Sem acervo medido, o bloco some inteiro — melhor calar do que imprimir "undefined achados".
  const blocoAcervo = (acervo && Number.isFinite(acervo.total))
    ? `\n\nACERVO ABERTO HOJE: ${acervo.total} achados — ${acervo.alto} de severidade alta, `
      + `${acervo.ate2d} nos últimos 2 dias, ${acervo.mais30d} com mais de 30 dias.`
    : '';
  return `Rode o ciclo de governança de hoje, seguindo o protocolo do seu briefing na ordem.

ETAPA 1 já foi medida pra você (confira no banco se quiser, mas não repita o trabalho):
- Known-issues fechados por você (${MARCA_AGENTE}): ${p.fechados}
- Reincidentes: ${p.reincidentes.length}${reincid}
- Taxa de reincidência: ${(p.taxa * 100).toFixed(0)}%${parada}

Agora siga da ETAPA 2 em diante.${blocoAcervo}

TETO DE CORREÇÃO: **DUAS correções por rodada** (subiu de 1 em 02/09 — o acervo entrava mais
rápido do que saía). Escolha o 1º achado de preferência dos últimos ${JANELA_FINDINGS_DIAS} dias,
porque sinal fresco é mais fácil de reproduzir; se não houver, pegue o de maior severidade.
Refute antes de acreditar e só corrija o que reproduzir com teste vermelho. A 2ª correção só
entra depois que a 1ª está COMMITADA com a suíte no baseline, e tem que ser de OUTRA raiz
(outro KI, outro arquivo) — duas portas da mesma raiz contam como uma. Commit cada correção
assim que a suíte passar: trabalho sem commit morre no teto de tempo. Não passe de 2 porque
ninguém revisa cinco mudanças de engine por dia.

VARREDURA DO ACERVO: refutar NÃO muda código, então não consome revisão — aqui não há teto,
feche quantos conseguir no tempo que tiver. Vá pelos mais ANTIGOS primeiro: quase todos são
anteriores a dezenas de correções e devem cair como "já corrigido". Cada um exige a mesma
ETAPA 3 (grep no src/, literal do banco, datar o fix): sem prova, deixe aberto.

⚠️ Severidade **alto** fica FORA da varredura em massa — não feche nenhum deles em lote. Se um
alto merece encerramento, trate como o achado da rodada, com relatório próprio.

No relatório: detalhe a correção, e resuma a varredura em números ("fechei N antigos: X já
corrigidos, Y falso-positivo"). Não liste um por um — é WhatsApp.`;
}

/**
 * Roda o ciclo e entrega no grupo. `postar` e `rodar` são injetados (testável, sem ciclo de
 * require com o group-chat-engine). Só grava o log com a entrega CONFIRMADA: se o envio
 * falhar, o próximo tick da janela retenta.
 *
 * Confirmada = `postar` resolveu com valor truthy (ver src/lib/entrega.js). Isso é contrato,
 * não detalhe: enquanto era só "o await não lançou", o `postOpsResult` devolvendo null fechava
 * o dia sem nada ter chegado ao grupo, e o gate de idempotência bloqueava o retry.
 */
async function rodarCicloGovernanca(sb, { postar, ymd, force = false, rodar = null } = {}) {
  if (!GOV_ON) return { rodou: false, motivo: 'desligado' };
  if (typeof postar !== 'function') return { rodou: false, motivo: 'sem canal de envio' };
  if (!GOV_OWNER) return { rodou: false, motivo: 'sem owner para idempotência' };

  if (!force) {
    const { data: ja } = await sb.from('ritual_logs').select('id')
      .eq('collaborator_id', GOV_OWNER).eq('ritual_type', 'gov_agent')
      .eq('reference_date', ymd).eq('status', 'sent').limit(1);
    if (ja && ja.length) return { rodou: false, motivo: 'já rodou hoje' };
  }

  // Sem protocolo o briefing cairia no do canal de ops e o ciclo rodaria SEM as etapas — sem
  // placar, sem etapa 2.5, sem "reproduza antes de corrigir" — e sem nada falhar. Um agente
  // com Bash na VPS e sem as travas é pior que agente nenhum: aqui ele para e avisa.
  const briefing = montarBriefing();
  if (!briefing) {
    console.error(`[GovAgent] protocolo ausente em ${PROTOCOLO_PATH} — ciclo abortado`);
    // O log fecha o dia pra não repetir o aviso a cada tick — mas só se o aviso TIVER chegado.
    // Fechar sem entrega significaria ninguém nunca ficar sabendo que o agente está parado.
    await entregar(postar, '⚠️ Não rodei o ciclo de governança: não achei o arquivo do protocolo '
      + `(${PROTOCOLO_PATH}). Sem ele eu rodaria sem as travas, então preferi parar. `
      + 'É problema de deploy — o .md não subiu.', 'o aviso de protocolo ausente');
    await registrarLog(sb, ymd, 'abortado: protocolo ausente');
    return { rodou: false, motivo: 'sem protocolo' };
  }

  const placar = await carregarPlacar(sb);
  const acervo = await carregarAcervo(sb);
  const executar = rodar || ((pedido) => opsAgent.runOpsAgent(pedido, {
    quem: 'o ciclo automático de governança', briefing, timeoutMs: GOV_TIMEOUT_MS,
  }));

  const r = await executar(montarPedido(placar, acervo), { briefing });
  const texto = (r && typeof r.text === 'string' && r.text.trim())
    ? r.text
    : '⚠️ Rodei o ciclo de governança e voltei sem texto — isso é bug meu, não resultado. Não mexi em nada.';

  await entregar(postar, texto, 'o relatório do ciclo');
  await registrarLog(sb, ymd,
    `fechados=${placar.fechados} reincidentes=${placar.reincidentes.length} parada=${placar.emParada.length}`
    + `${acervo ? ` acervo=${acervo.total}` : ''}`
    + sufixoDeCusto(r && r.custo));
  return { rodou: true, motivo: 'ok', placar, acervo };
}

/**
 * O que a rodada custou, vindo do `total_cost_usd` do CLI. Só entra quando é número: `null`
 * (JSON sem o campo) tem que sair do log em vez de virar "custo=null", senão quem for somar
 * não distingue rodada de graça de campo ausente. Pelo mesmo motivo o teste do zero existe —
 * `if (custo)` mandaria o zero pro mesmo buraco do null.
 * 6 casas = precisão de microdólar; o `Number()` corta os zeros à direita.
 */
function sufixoDeCusto(custo) {
  return typeof custo === 'number' && Number.isFinite(custo)
    ? ` custo=${Number(custo.toFixed(6))}` : '';
}

/**
 * Fecha o dia. Grava também no caso do protocolo ausente, de propósito: o cron bate a cada
 * 5min até as 12h e sem isso o grupo levaria ~48 avisos iguais de um problema que não se
 * resolve sozinho.
 */
function registrarLog(sb, ymd, detail) {
  return sb.from('ritual_logs').insert({
    collaborator_id: GOV_OWNER, ritual_type: 'gov_agent', reference_date: ymd,
    status: 'sent', sent_at: new Date().toISOString(), detail,
  });
}

module.exports = {
  rodarCicloGovernanca, montarPedido, montarBriefing, carregarPlacar, carregarAcervo,
  GOV_TIMEOUT_MS, JANELA_FINDINGS_DIAS,
};

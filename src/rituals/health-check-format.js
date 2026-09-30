'use strict';
// health-check-format.js — textos (puros) de checks do relatório das 07h que moravam dentro de
// health-check.js (que importa supabase/client, só-na-VPS). Formato ORGANIZADO (Alf, 30/09):
// título em negrito na 1ª linha, um item por linha com "• ", corte na palavra.
const { cortarNaPalavra } = require('../lib/texto-curto');

// LICOES-PENDENTES-REPORTA-O-TETO (09/09/2026). O check lia com `.limit(20)` e o resumo
// contava `arr.length` — então o número relatado era o TETO DA CONSULTA, não o total da fila.
// Amostra e total entram separados.
function resumirLicoesPendentes(licoes, total = null) {
  const arr = Array.isArray(licoes) ? licoes : [];
  if (!arr.length) return { status: 'ok', detail: 'Nenhuma lição esperando aprovação' };
  // `total` do banco quando veio; senão a amostra — que é o que o chamador antigo passa.
  const n = typeof total === 'number' && total >= arr.length ? total : arr.length;
  const itens = arr.slice(0, 3).map((l) => {
    const [, m, d] = String(l.dia || '').split('-');
    const data = d ? `${d}/${m}` : (l.dia || '?');
    return `• “${cortarNaPalavra(l.conteudo, 110)}” — ${l.grupo}, ${data}`;
  });
  const soLicoes = arr.every((l) => !l.tipo || l.tipo === 'lesson');
  const plural = soLicoes
    ? (n === 1 ? 'lição' : 'lições')
    : (n === 1 ? 'memória' : 'memórias');
  const caminho = 'a lista inteira, com o que muda no TOM, vai pro grupo LA ORGANIZER - TOM às 07:30; responde lá';
  // O resto é o TOTAL menos o que apareceu (antes subtraía 3 fixo: com 2 na amostra e 6 na fila
  // dizia "+3" e sumia uma).
  const resto = n - itens.length;
  itens.push(resto > 0 ? `• (+${resto}) — ${caminho}` : `• ${caminho[0].toUpperCase()}${caminho.slice(1)}`);
  return { status: 'warning', detail: `⛔ *${n} ${plural} esperando seu ok*\n${itens.join('\n')}` };
}

// CHECK 10 — o texto. `recurring` = [[mensagem normalizada, contagem], ...] já ordenado.
function formatarErrosRecorrentes(recurring) {
  const arr = Array.isArray(recurring) ? recurring : [];
  if (!arr.length) return { status: 'ok', detail: 'Sem erros recorrentes nas últimas 24h' };
  const itens = arr.map(([m, c]) => `• ${c}× ${cortarNaPalavra(m, 90)}`);
  return { status: 'warning', detail: `⚙️ *Erros repetidos no log (24h)*\n${itens.join('\n')}` };
}

// CHECK — erro de banco repetido no log dos rituais (cron). `recurring` = [[msg, contagem], ...].
// Nasceu do CHECKLISTS-PESSOAIS-PARADOS (30/09/2026): 3,5 meses de "column ... does not exist" mudo.
function formatarErrosDeBancoRituais(recurring) {
  const arr = Array.isArray(recurring) ? recurring : [];
  if (!arr.length) return { status: 'ok', detail: 'Sem erro de banco nos rituais nas últimas 24h' };
  const itens = arr.map(([m, c]) => `• ${c}× ${cortarNaPalavra(m, 110)}`);
  itens.push('• Vem do cron (logs/rituals.log): não aparece em recurring_errors');
  return { status: 'warning', detail: `🗄️ *Erros de banco nos rituais (24h)*\n${itens.join('\n')}` };
}

module.exports = { resumirLicoesPendentes, formatarErrosRecorrentes, formatarErrosDeBancoRituais };

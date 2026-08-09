'use strict';
// write-date-label.js — CONFAB-WRITE-DATE-NO-RELLABEL (Anne 05/08, severidade alta).
//
// O TOM grava a data CERTA e narra a data ERRADA. Anne pediu "me lembre no dia 7"; o
// marker gravou 2026-08-07 e a fala saiu "anotei o lembrete pra amanhã" — numa quarta.
// Ela leu "amanhã" como "manhã", concluiu que ele tinha errado o que estava certo, e
// gastou três turnos corrigindo. O dado nunca esteve errado; a narração esteve.
//
// POR QUE O BURACO EXISTE. O prompt fecha só o lado da LEITURA: toda task do contexto
// chega com o dia-relativo pré-computado ("07/08 sex (em 2d)") e a REGRA DE OURO manda
// repetir o rótulo, nunca calcular. Do lado da ESCRITA não há equivalente — quando o
// TOM CRIA ou REAGENDA, a data nasce no marker no mesmo sopro da fala, sem rótulo
// pronto nenhum, e o LLM narra de cabeça.
//
// ESTE MÓDULO É O ESPELHO DO QUE JÁ EXISTE. O engine já corrige o DADO pela fala do
// usuário (auto-align em engine.js:10941, weekday override em 4907). Faltava a volta:
// corrigir a FALA pelo dado gravado. Mesma família, direção inversa.
//
// PURO de propósito: quem sabe o que foi realmente gravado é o engine, e ele injeta.
//
// Na dúvida NÃO AGE. Errar aqui é reescrever a fala de alguém, o que custa mais caro
// que o rótulo torto — então cada guarda devolve `corrigiu:false` com um motivo, e o
// chamador loga. Nunca inventa data: o que sai é função do que entrou.

const _DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// `\b` em JS é ASCII e não casa depois de "ã" — daí os lookarounds \p{L} (a lição do
// GROUPCHAT-DATE-SELF-POISONING). O lookbehind também é o que impede "manhã" de casar
// dentro de "amanhã": a letra anterior barra o match.
const RE_ROTULO = /(?<!\p{L})(amanhã|amanha|hoje|ontem)(?!\p{L})/giu;

// Uma data numérica logo depois do rótulo ("amanhã, quinta 02/07") é o território do
// date-claim.js, não daqui. Além disso a fala já entrega a data absoluta ao leitor.
const RE_DATA_COLADA = /^.{0,20}?\d{1,2}\/\d{1,2}/su;

const _YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// Aritmética em UTC sobre YMD já resolvido em BRT: sem conversão de fuso, não há como
// deslocar o dia (LOCALYMD-UTC-SHIFT).
function _asUtc(ymd) {
  const m = _YMD.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Como uma PESSOA diria essa data hoje. Não é o formatRelativeDate de dates.js: aquele
 * produz "07/08 sex (em 2d)", rótulo de contexto para o LLM ler. Este é português para
 * a pessoa ouvir, no formato que o próprio TOM usa quando acerta ("dia 7 (sexta)").
 * Passa de 6 dias o dia-da-semana confunde mais do que ajuda — vai a data seca.
 */
function rotuloDeFala(ymd, hojeYmd) {
  const alvo = _asUtc(ymd);
  const hoje = _asUtc(hojeYmd);
  if (!alvo || !hoje) return '';
  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  if (dias === -1) return 'ontem';
  const dd = String(alvo.getUTCDate()).padStart(2, '0');
  const mm = String(alvo.getUTCMonth() + 1).padStart(2, '0');
  if (dias >= 2 && dias <= 6) return `${_DIAS[alvo.getUTCDay()]} (${dd}/${mm})`;
  return `${dd}/${mm}`;
}

function _casaCapitalizacao(original, novo) {
  const primeira = original[0];
  if (primeira !== primeira.toUpperCase() || primeira === primeira.toLowerCase()) return novo;
  return novo[0].toUpperCase() + novo.slice(1);
}

/**
 * Confere o rótulo relativo da fala contra a data que o turno REALMENTE gravou e, se
 * discordarem, troca só o rótulo — o resto da frase (tom, tamanho, emoji) é intocado.
 *
 * @param {string} texto        a resposta que iria pro WhatsApp
 * @param {string} dataYmd      YYYY-MM-DD do que foi gravado, em BRT
 * @param {string} hojeYmd      YYYY-MM-DD de hoje, em BRT
 * @returns {{texto:string, corrigiu:boolean, de?:string, para?:string, motivo:string|null}}
 */
function corrigeRotuloDeEscrita(texto, dataYmd, hojeYmd) {
  const original = typeof texto === 'string' ? texto : '';
  const esperado = rotuloDeFala(dataYmd, hojeYmd);
  if (!original || !esperado) return { texto: original, corrigiu: false, motivo: 'entrada_invalida' };

  const achados = [...original.matchAll(RE_ROTULO)];
  if (achados.length === 0) return { texto: original, corrigiu: false, motivo: 'sem_rotulo' };
  // Dois rótulos e uma data só: não dá pra saber qual deles é o dela. Caso Dudu 10/06
  // — "cancelo essa de hoje" fala da consulta, "amanhã de manhã" do lembrete novo.
  if (achados.length > 1) return { texto: original, corrigiu: false, motivo: 'rotulo_ambiguo' };

  const [m] = achados;
  const dito = m[0];
  const depois = original.slice(m.index + dito.length);
  if (RE_DATA_COLADA.test(depois)) return { texto: original, corrigiu: false, motivo: 'data_colada' };

  // Compara sem acento pra "amanha" digitado sem til contar como acerto.
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (norm(dito) === norm(esperado)) return { texto: original, corrigiu: false, motivo: 'ja_correto' };

  const troca = _casaCapitalizacao(dito, esperado);
  return {
    texto: original.slice(0, m.index) + troca + original.slice(m.index + dito.length),
    corrigiu: true,
    de: dito.toLowerCase(),
    para: esperado,
    motivo: null,
  };
}

// Campos por onde uma data entra no banco num turno de escrita. `create` e `reschedule`
// são as duas únicas ações que gravam data — as demais (complete, cancel, delegate...)
// não têm o que narrar de prazo novo.
const _CAMPOS_DATA = ['due_date', 'new_due_date', 'remind_at', 'new_remind_at'];

const _FMT_BRT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Timestamp com fuso (Z ou ±HH:MM) precisa virar o dia CIVIL de São Paulo: "01:00Z" é
// ainda o dia anterior aqui, e ler o literal apontaria o dia errado. Data seca ou
// timestamp sem fuso já vem em BRT por convenção do marker — usa o literal.
function _ymdBrt(valor) {
  const s = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : _FMT_BRT.format(d);
}

/**
 * As datas que o turno realmente gravou, em BRT. Lê das actions DEPOIS do executor —
 * o auto-align e o weekday override mutam o array antes de tocar no banco, então o que
 * está ali é o que foi persistido.
 */
function datasGravadasDasActions(actions) {
  const out = new Set();
  for (const a of (Array.isArray(actions) ? actions : [])) {
    if (!a || (a.action !== 'create' && a.action !== 'reschedule')) continue;
    for (const campo of _CAMPOS_DATA) {
      const ymd = _ymdBrt(a[campo]);
      if (ymd) out.add(ymd);
    }
  }
  return [...out];
}

module.exports = { rotuloDeFala, corrigeRotuloDeEscrita, datasGravadasDasActions };

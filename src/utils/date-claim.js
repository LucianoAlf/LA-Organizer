// src/utils/date-claim.js
// GROUPCHAT-DATE-SELF-POISONING (Rose 06/08) — o TOM afirmava a data errada e se auto-envenenava.
//
// Medição retroativa nas falas dele no chat de grupo: 26 afirmam "hoje DD/MM", 11 estão erradas
// (42%) — e sempre em RAJADA (5 seguidas em 20/06, 3 em 06/08). Os desvios foram +2 às 19h e
// -1 às 10h, o que DESCARTA fuso horário (UTC só produz +1, e só depois das 21h). O que sustenta
// a rajada é a realimentação: a fala errada vira linha no histórico e no resumo de longo prazo,
// e volta no prompt da rodada seguinte. Prova: o pool entregou "prazo 06/08 qui (HOJE)" e ele
// escreveu "prazo era ontem, 06/08" — contradisse o rótulo explícito da casa.
//
// Este módulo é PURO. neutralizaDataAfirmada tira o carimbo de data do que ENTRA no prompt
// (falas antigas dele + memória de longo prazo), para a âncora ficar sendo a única fonte de
// "hoje". detectaDataAfirmadaErrada é o velocímetro do que SAI — mede, não maquia: uma resposta
// nascida de data errada tem a aritmética toda contaminada ("2 dias" de atraso) e não é
// salvável por regex.

// Dia-da-semana opcional entre o "(" e a data: "amanhã (sex 07/08)". Caso do Alf, 05/08 —
// era quarta, "amanhã" = 06/08, e ele escreveu 07/08; o auto-retry então gravou 07/08 na
// tarefa. O detector passava batido porque só aceitava a data colada no rótulo. Pior: este é
// o formato que o TOM MAIS produz, porque é o da TABELA DE DATAS do prompt ("sex 07/08") —
// o formato mais provável era exatamente o único cego.
// Lista fechada de propósito, não `\p{L}+`: com palavra livre, "amanhã (confirmar 07/08)"
// casaria e a neutralização engoliria o "confirmar", quebrando a frase.
// Grupo NÃO-capturante — os índices 1..5 são lidos por posição no neutraliza.
const _DIA_SEMANA = String.raw`(?:(?:seg|ter|qua|qui|sex|s[áa]b|dom)[\p{L}-]*\.?[ \t]+)?`;

// `\b` em JS é ASCII: `\bamanhã\b` NÃO casa (o "ã" não é word char). Daí os lookarounds \p{L}.
// Só liga quando a data está GRUDADA no rótulo — separada apenas por espaço, "é", pontuação
// leve, tag HTML (a memória de longo prazo é HTML) ou dia-da-semana. "pra hoje? Vence 12/08"
// não casa.
const RE_DATA_AFIRMADA = new RegExp(
  // weekday tambem ANTES do separador ('Hoje é terça, 01/09' — forma real da noite da Rose
  // 31/08; o detector ficou mudo a noite inteira porque so aceitava weekday depois do parêntese).
  String.raw`(?<![\p{L}])(hoje|ontem|amanhã|amanha)(?![\p{L}])[ \t]*(?:é|eh)?[ \t]*(?:(?:seg|ter|qua|qui|sex|s[áa]b|dom)[\p{L}-]*\.?[ \t]*)?[,:–—-]?[ \t]*(?:<[a-z/][^>]{0,24}>)*[ \t]*(\()?[ \t]*`
  + _DIA_SEMANA
  + String.raw`(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?:[ \t]*(\)))?`,
  'giu');

const DELTA = { hoje: 0, ontem: -1, amanhã: 1, amanha: 1 };

// Aritmética de calendário em UTC a partir de uma string YMD já resolvida em BRT: não há
// conversão de fuso aqui, logo não há como deslocar o dia (LOCALYMD-UTC-SHIFT).
function _desloca(hojeYmd, delta) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hojeYmd || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + delta);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Remove o "DD/MM" que ele gruda em hoje/ontem/amanhã, preservando o resto da frase.
// Só devolve o ")" quando ele não fazia par com um "(" consumido — senão sobra parêntese órfão.
function neutralizaDataAfirmada(texto) {
  if (!texto) return '';
  return String(texto).replace(RE_DATA_AFIRMADA, (_m, rotulo, abre, _dd, _mm, fecha) => (
    fecha && !abre ? `${rotulo}${fecha}` : rotulo
  ));
}

// Velocímetro: lista as afirmações de data que discordam do calendário real.
function detectaDataAfirmadaErrada(texto, hojeYmd) {
  if (!texto || !hojeYmd) return [];
  const achados = [];
  const re = new RegExp(RE_DATA_AFIRMADA.source, RE_DATA_AFIRMADA.flags);
  let m;
  while ((m = re.exec(String(texto)))) {
    const rotulo = m[1].toLowerCase();
    const esperado = _desloca(hojeYmd, DELTA[rotulo]);
    if (!esperado) continue;
    const disse = `${m[3].padStart(2, '0')}/${m[4].padStart(2, '0')}`;
    if (disse !== esperado) achados.push({ rotulo, disse, esperado });
  }
  return achados;
}

module.exports = { neutralizaDataAfirmada, detectaDataAfirmadaErrada };

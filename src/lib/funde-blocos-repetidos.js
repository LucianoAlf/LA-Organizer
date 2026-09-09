'use strict';
// funde-blocos-repetidos.js — SEGUNDO-BLOCO-DO-MESMO-MARKER-VIRA-LIXO (Alf, 09/09/2026 19:19).
//
// O Alf pediu dois compromissos. O TOM respondeu "✅ Dois compromissos marcados pra amanhã",
// listou os dois, e criou UM. A Entrevista do Serjão das 13h30 nunca existiu na agenda.
//
// O modelo emitiu DOIS blocos `<<EVENT_CREATE>>` na mesma resposta. O parser usa
// `text.match(re)` com regex NÃO-GLOBAL (`/i`, sem `g`): pega o primeiro e ignora o resto.
// Pior, o `text.replace(re, '')` também remove só o primeiro — então o segundo bloco sobra no
// texto e é arrancado depois como marker desconhecido:
//
//   UNKNOWN_MARKER_STRIPPED · rejected · names:EVENT_CREATE,EVENT_CREATE,END delta:225
//
// A escrita some silenciosamente e a pessoa lê a confirmação dos dois.
//
// NÃO é caso de borda: medido em 90 dias, 5 ocorrências, e nenhuma barata —
//   09/09  Alf   EVENT_CREATE ×2   perdeu a entrevista de amanhã
//   09-11/08 Rose FINANCE_ACTION ×2 (3 vezes)  lançamento financeiro perdido
//   01/07  Fefê  TASK_UPDATE ×4    três tarefas perdidas
//
// 21 dos 23 parsers do engine têm o mesmo `/i`. Só `HABIT_ACTION` (6484) e
// `COORDINATION_REQUEST` (1702) usam `/gi` — e o HABIT_ACTION ganhou o `g` justamente depois de
// um incidente igual, com o comentário "com regex não-global só o 1º era consumido". A lição
// existia e não tinha atravessado para as outras portas.
//
// A FUSÃO em vez do `/g`: os parsers já sabem receber ARRAY (`Array.isArray(parsed) ? parsed :
// [parsed]`). Então juntar N blocos num só, antes do parse, conserta sem tocar na lógica de
// nenhum deles — nem no tratamento de erro, nem no `cleanText`, nem no recovery YAML-ish do
// TASK_UPDATE. Uma linha por parser.
//
// FAIL-CLOSED em tudo: se QUALQUER bloco não for JSON válido, devolve o texto intacto e o
// parser segue como sempre seguiu. Fundir na dúvida seria trocar uma escrita perdida por uma
// escrita ERRADA — e a errada é pior, porque ninguém a audita.
//
// ALLOWLIST explícita, nunca automática: só entra marker que comprovadamente aceita array.
// `FINANCE_ACTION` ficou de fora porque lê o payload direto (`json`), sem `Array.isArray` — e é
// dinheiro. Fundir lá sem ler o executor inteiro seria adivinhar.

// Markers cujo executor aceita array de itens (verificado no engine em 09/09/2026).
const ACEITAM_ARRAY = new Set(['TASK_UPDATE', 'EVENT_CREATE', 'EVENT_UPDATE']);

function _escapaRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Funde N blocos `<<MARKER>>…<<END>>` do MESMO marker num único bloco com array.
 *
 * @param {string} text   resposta crua do modelo
 * @param {string} marker nome do marker (precisa estar na allowlist)
 * @returns {string} texto com os blocos fundidos, ou o original se não houver o que fundir
 */
function fundeBlocosRepetidos(text, marker) {
  const s = String(text == null ? '' : text);
  if (!s || !marker || !ACEITAM_ARRAY.has(marker)) return s;

  const nome = _escapaRegex(marker);
  const re = new RegExp('<<' + nome + '>>\\s*([\\s\\S]*?)\\s*<<END>>', 'gi');
  const blocos = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    blocos.push({ inteiro: m[0], corpo: m[1], index: m.index });
  }
  if (blocos.length < 2) return s;  // nada a fundir — caminho de todo turno normal

  // Todos os corpos precisam ser JSON válido. Um só que falhe e a fusão inteira é abortada:
  // melhor o comportamento antigo (perde o 2º) do que gravar um payload remendado.
  const itens = [];
  for (const b of blocos) {
    let p;
    try { p = JSON.parse(String(b.corpo).trim()); } catch (_) { return s; }
    if (Array.isArray(p)) itens.push(...p); else itens.push(p);
  }
  if (!itens.length) return s;

  // O bloco fundido ocupa o lugar do PRIMEIRO (preserva a posição do texto ao redor, que é o
  // que o `cleanText` de cada parser devolve pra pessoa); os demais somem.
  let out = '';
  let cursor = 0;
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    out += s.slice(cursor, b.index);
    if (i === 0) out += '<<' + marker + '>>' + JSON.stringify(itens) + '<<END>>';
    cursor = b.index + b.inteiro.length;
  }
  out += s.slice(cursor);
  return out;
}

module.exports = { fundeBlocosRepetidos, ACEITAM_ARRAY };

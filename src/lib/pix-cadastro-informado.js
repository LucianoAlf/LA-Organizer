'use strict';
// pix-cadastro-informado.js — lib PURA (sem I/O). Reconhece a fala curta da equipe no grupo
// avisando que já cadastrou um pagador no PIX automático (fora do TOM, direto no banco/gateway)
// e monta os textos fixos de resposta. Tarefa 7 do plano de migração PIX — o atalho de verdade
// (que lê/escreve o painel de tarefas) mora em src/services/pix-cadastro-grupo.js; este arquivo
// só reconhece a fala e formata texto, sem tocar em Supabase.
//
// Cuidado (ambiente.md): `\b` do JS não funciona colado em vogal acentuada — por isso a regex usa
// fronteiras por espaço/início-de-string em vez de `\b` nos pontos onde o verbo ou o "automático"
// podem ficar colados numa vogal acentuada.

const VERBOS = ['cadastrei', 'coloquei', 'botei', 'passei', 'migrei'];
const ALT_VERBOS = VERBOS.join('|');

// <verbo> [o|a] <Nome...> (no|na|pro|pra|para o) [pix] automático — acento opcional em
// "automático", caixa livre (flag 'i'). O nome é capturado de forma PREGUIÇOSA: pára assim que o
// resto do texto casar com "(no|na|pro|pra|para o) [pix] automático", nunca engolindo essas
// palavras como se fossem parte do nome.
const RE_CADASTRO = new RegExp(
  `(?:^|\\s)(?:${ALT_VERBOS})\\s+(?:[oa]\\s+)?([a-zà-úA-ZÀ-Ú][a-zà-úA-ZÀ-Ú\\s]*?)\\s+`
    + '(?:no|na|pro|pra|para o)\\s+(?:pix\\s+)?autom[aá]tico(?=\\s|[.,!?]|$)',
  'i',
);

// Fala curta: até ~12 palavras. Acima disso não é mais "avisei que cadastrei fulano" — é
// conversa, e o atalho determinístico não deve tentar adivinhar dentro de um parágrafo.
const TETO_PALAVRAS = 12;

function detectarCadastroInformado(texto) {
  const t = String(texto == null ? '' : texto).trim();
  if (!t) return null;
  if (t.split(/\s+/).length > TETO_PALAVRAS) return null;
  const m = RE_CADASTRO.exec(t);
  if (!m) return null;
  const nome = m[1].replace(/\s+/g, ' ').trim();
  if (!nome) return null;
  return { nome };
}

function normalizarNome(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function textoCadastroInformado(nome) {
  return `✅ Anotei *${nome}* no PIX automático. Tirei da pauta e confiro no Emusys — se em 7 dias não aparecer lá, volta pra lista.`;
}

function textoCadastroNaoAchado(nome) {
  return `Não achei *${nome}* na pauta do PIX deste grupo. Confere o nome como está na lista?`;
}

function textoCadastroAmbiguo(nomes) {
  return `Achei mais de um parecido: ${(nomes || []).join(' · ')}. Qual deles?`;
}

module.exports = {
  detectarCadastroInformado,
  normalizarNome,
  textoCadastroInformado,
  textoCadastroNaoAchado,
  textoCadastroAmbiguo,
};

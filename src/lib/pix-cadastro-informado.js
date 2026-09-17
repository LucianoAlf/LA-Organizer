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

// FIX ROUND 1 (Critical + Important, achado da revisão): uma baixa automática errada é pior que
// perguntar de novo — negação e dúvida têm que REFUTAR o reconhecimento, não só a estrutura
// positiva da frase. Fronteira de palavra PRÓPRIA (nunca `\b`: "será" e "amanhã" terminam em
// vogal acentuada, e `\b` do JS falha colado nelas — mesmo aviso do topo do arquivo).
const LETRA = 'a-zà-úA-ZÀ-Ú';
const NAO_LETRA = `[^${LETRA}]`;

function _escapaRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _temToken(texto, token) {
  const re = new RegExp(`(?:^|${NAO_LETRA})${_escapaRegex(token)}(?:${NAO_LETRA}|$)`, 'i');
  return re.test(texto);
}

function _temAlgumToken(texto, tokens) {
  return tokens.some((token) => _temToken(texto, token));
}

// Conservador de propósito (regra do controlador): QUALQUER "não"/"nao"/"nunca" na frase
// inteira já basta pra refutar, não só antes do verbo — cobre "não cadastrei... ainda", "ainda
// não cadastrei...", "cadastrei... mas nunca liguei" etc., sem tentar calcular posição.
const NEGACOES = ['não', 'nao', 'nunca'];

// "?" em qualquer lugar, ou qualquer um destes tokens de dúvida/futuro/tentativa — a equipe
// ainda não fez, só está cogitando, prometendo ou tentando.
const HEDGES = [
  'acho', 'acredito', 'talvez', 'será', 'sera', 'não sei', 'nao sei', 'parece',
  'se não me engano', 'depois', 'amanhã', 'amanha', 'vou', 'preciso', 'falta', 'faltou', 'tentei',
];

// FIX ROUND 1 (17/09, C1): o interceptador de lista (src/services/pix-consulta.js) precisa saber
// que a fala TEM FORMA de aviso de cadastro mesmo quando negação ou dúvida a refutam. Medido:
// "cadastrei o fulano no automático mas não achei o nome dele" traz "automático" (assunto) e
// "nome" (marcador de lista) — sem esta trava o TOM despejava a lista inteira do PIX por cima do
// aviso da equipe. Aqui só a ESTRUTURA importa: negação/dúvida seguem sendo problema de
// detectarCadastroInformado, que é quem decide se há baixa a dar.
function pareceFalaDeCadastro(texto) {
  const t = String(texto == null ? '' : texto).trim();
  if (!t) return false;
  if (t.split(/\s+/).length > TETO_PALAVRAS) return false;
  return RE_CADASTRO.test(t);
}

function detectarCadastroInformado(texto) {
  const t = String(texto == null ? '' : texto).trim();
  if (!pareceFalaDeCadastro(t)) return null;
  if (_temAlgumToken(t, NEGACOES)) return null;
  if (t.includes('?') || _temAlgumToken(t, HEDGES)) return null;
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

// I5 (revisão final): o grupo TEM pauta do PIX aberta, mas o nome falado não está nela. Não pede
// pra "conferir o nome" — quem cadastrou alguém fora do lote de hoje não precisa fazer nada: a
// fonte (Emusys) confirma sozinha e o cliente sai da lista.
function textoCadastroNaoAchado(nome) {
  return `*${nome}* não está na pauta do PIX de hoje deste grupo. Se já cadastrou, o Emusys confirma amanhã e sai da lista sozinho.`;
}

// M3 (revisão final): o registro (marcador e/ou baixa da filha) falhou — nada foi prometido.
function textoCadastroNaoRegistrado() {
  return 'Não consegui registrar agora — tenta de novo daqui a pouco.';
}

function textoCadastroAmbiguo(nomes) {
  return `Achei mais de um parecido: ${(nomes || []).join(' · ')}. Qual deles?`;
}

module.exports = {
  detectarCadastroInformado,
  pareceFalaDeCadastro,
  normalizarNome,
  textoCadastroInformado,
  textoCadastroNaoAchado,
  textoCadastroNaoRegistrado,
  textoCadastroAmbiguo,
};

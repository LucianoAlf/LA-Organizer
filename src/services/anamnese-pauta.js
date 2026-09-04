'use strict';
// Decisões PURAS da pauta de anamnese. Nada aqui toca banco nem RPC — o ritual orquestra.
// Ver docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md.

// ---- Quem entra na pauta de hoje, em que ordem (Task 2) ----

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// "Canto — Segunda-feira 19:00" → 1. Sem dia no texto devolve null; NÃO chuta.
function diaDaAula(resumo) {
  const t = _norm(resumo);
  for (let i = 0; i < DIAS.length; i += 1) if (t.includes(DIAS[i])) return i;
  return null;
}

function horaDaAula(resumo) {
  const m = String(resumo || '').match(/\b(\d{1,2}):(\d{2})\b/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function _curso(resumo) {
  return String(resumo || '').split('—')[0].trim() || null;
}

// Uma linha por ALUNO por dia (não por aula), na hora da PRIMEIRA aula — que é quando ele
// chega na escola, e é aí que o tablet funciona.
function pautaDoDia(pessoas, diaSemana) {
  const saida = [];
  for (const pessoa of (pessoas || [])) {
    const doDia = (pessoa.aulas_resumo || [])
      .filter((a) => diaDaAula(a) === diaSemana && horaDaAula(a))
      .sort((a, b) => String(horaDaAula(a)).localeCompare(String(horaDaAula(b))));
    if (!doDia.length) continue;
    saida.push({ pessoa, hora: horaDaAula(doDia[0]), curso: _curso(doDia[0]) });
  }
  return saida.sort((a, b) => a.hora.localeCompare(b.hora));
}

// ── A ESCADA ──────────────────────────────────────────────────────────────────────────────
// Conta APARIÇÕES falhadas, não cliques: contar "a equipe tentou" faria a escalada depender de
// todo mundo marcar checkbox certinho todo dia, e isso quebra na primeira semana corrida.
function degrau(falhas) {
  const n = Number(falhas) || 0;
  if (n >= 2) return 3;
  return n === 1 ? 2 : 1;
}

function tituloDaFilha({ pessoa, hora, curso }, falhas) {
  const base = `${hora} Anamnese — ${pessoa.nome}${curso ? ` (${curso})` : ''}`;
  return degrau(falhas) === 2 ? `${base} ⚠️ 2ª semana — não preencheu na anterior` : base;
}

function tituloDaEscalada(pessoa, falhas) {
  const n = Number(falhas) || 0;
  return `Mandar link da anamnese — ${pessoa.nome} (${n} semanas sem preencher)`;
}

// Degrau 3 SAI da pauta: no terceiro encontro o problema deixou de ser "lembrar na aula".
// `mapaFalhas` null (erro de leitura) → todo mundo é 1ª vez. Nunca escalar no escuro.
function separarPorDegrau(itens, mapaFalhas) {
  const pauta = [];
  const escalados = [];
  for (const item of (itens || [])) {
    const falhas = mapaFalhas ? (mapaFalhas.get(item.pessoa.pessoa_chave) || 0) : 0;
    if (degrau(falhas) === 3) escalados.push({ ...item, falhas });
    else pauta.push({ ...item, falhas });
  }
  return { pauta, escalados };
}

// ── A MENSAGEM (Task 4) ──────────────────────────────────────────────────────────────────
const PRIMEIROS_NO_ZAP = 3;

// Os N primeiros HORÁRIOS, não os N primeiros nomes alfabéticos: quem chega às 8h é quem
// importa quando o dia começa. A lista inteira mora no painel.
function mensagemDoGrupo({ itens, unidadeNome, dataBr } = {}) {
  const lista = itens || [];
  if (!lista.length) return null;
  const n = lista.length;
  const cabeca = lista.slice(0, PRIMEIROS_NO_ZAP)
    .map((i) => `${i.hora} ${i.pessoa.nome}`).join(' · ');
  return `📋 *Anamnese — hoje (${dataBr})*\n`
    + `${n} aluno${n > 1 ? 's' : ''} com aula hoje ainda sem anamnese.\n`
    + `${n > PRIMEIROS_NO_ZAP ? 'Os primeiros' : 'Hoje'}: ${cabeca}\n`
    + 'A lista completa está no painel do grupo.';
}

module.exports = {
  diaDaAula, horaDaAula, pautaDoDia, DIAS,
  degrau, tituloDaFilha, tituloDaEscalada, separarPorDegrau,
  mensagemDoGrupo, PRIMEIROS_NO_ZAP,
};

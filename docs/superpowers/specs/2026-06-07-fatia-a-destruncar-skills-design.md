# Fatia A — Destruncar Skills (loadSkill 8192) — Design

**Data:** 2026-06-07
**Status:** aprovado (brainstorming) → executando
**Depende de:** Fatia H (provider aguenta prompt grande — provado com 270KB). ✅ feita.

## Problema
`src/prompts/system.js:167` → `return _skillCache[name].slice(0, 8192)` corta TODA skill em 8KB, em SILÊNCIO (cache guarda inteiro; corte na devolução; comentário "Truncate to 8KB"). 6 skills core perdem o final (regras NUNCA, actions, edge cases). Pior caso medido: `checklist-tarefas` perde 65%, `financeiro-pessoal` 59% (incl. bloco anti-confabulação + módulo Cartão + categorias). Causa-raiz dos achados #A/#1/#2 da auditoria 07/06.

## Objetivo
Parar de cortar o conteúdo real das skills, mantendo uma rede contra skill futura gigante, e tornar qualquer corte VISÍVEL (nunca mais silencioso). Sem alterar conteúdo de skill nem lógica.

## Decisões (fechadas)
1. **Teto 32768 (32KB)** — cobre todas as skills atuais (maior = `checklist-tarefas` 23.475) com folga; rede contra pathológico futuro.
2. **WARN alto quando cortar** — se uma skill exceder o teto, loga aviso explícito (mata o "silencioso").
3. Função pura `capSkill(content, name, max)` isolada em `src/prompts/skill-cap.js` (testável sem side-effects do system.js).

## Mudanças
### `src/prompts/skill-cap.js` (novo)
```js
'use strict';
const SKILL_MAX_CHARS = 32768;
function capSkill(content, name, max = SKILL_MAX_CHARS) {
  const s = String(content == null ? '' : content);
  if (s.length <= max) return s;
  console.warn(`[Prompt] WARN: skill "${name}" TRUNCADA — ${s.length} chars > teto ${max}. Divida a skill ou suba o teto (corte NÃO é mais silencioso).`);
  return s.slice(0, max);
}
module.exports = { capSkill, SKILL_MAX_CHARS };
```
### `src/prompts/system.js`
- topo: `const { capSkill } = require('./skill-cap');`
- `loadSkill`: trocar `return _skillCache[name].slice(0, 8192);` por `return capSkill(_skillCache[name], name);` + corrigir o comentário.

## Segurança de tamanho
Por turno carrega SOUL+AGENTS + 1 primária + auxiliares. Pior caso realista ~90KB → ~120-130KB. Provado que 270KB roda (Fatia H). Sem risco de estouro/contexto.

## Testes
1. **Unit `skill-cap.test.js`:** ≤ teto volta inteiro; > teto corta no teto; null/undefined → ''.
2. **Smoke `smoke-skill-untruncate.js` (VPS):** lê os arquivos reais e aplica capSkill →
   - `financeiro-pessoal`: length > 8192 (volta inteira) E inclui `create_card` E a frase "não existe marker" (que ANTES eram cortados).
   - `checklist-tarefas`: length > 8192 (inteira).
   - soma do pior combo (criar-compromisso full + checklist-tarefas full) < 200KB (sanidade).
3. **Regressão:** após deploy, TOM responde normal (smoke de mensagem real opcional; o conteúdo a mais é só instrução).

## Risco
Baixo. Só PARA de cortar conteúdo que já existe. Reversível (voltar o número/raw slice).

## Arquivos
- Criar: `src/prompts/skill-cap.js`, `src/prompts/skill-cap.test.js`, `scripts/smoke-skill-untruncate.js`
- Modificar: `src/prompts/system.js` (require + loadSkill)

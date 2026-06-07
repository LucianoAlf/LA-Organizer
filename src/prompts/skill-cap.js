// src/prompts/skill-cap.js
// Fatia A — teto de tamanho das skills. ANTES: system.js cortava TODA skill em 8192
// chars (slice) EM SILÊNCIO, perdendo o final (regras NUNCA, actions, edge cases) de
// 6 skills core. Agora: teto generoso (32KB cobre todas as atuais; maior=23.5KB) e,
// se algum dia cortar de verdade, GRITA no log — nunca mais silencioso. Função pura.
'use strict';

const SKILL_MAX_CHARS = 32768;

/**
 * Devolve a skill inteira se couber no teto; senão corta E loga aviso explícito.
 * @param {string} content  conteúdo cru da skill
 * @param {string} name     nome da skill (pro log)
 * @param {number} [max]    teto em chars (default 32768)
 */
function capSkill(content, name, max = SKILL_MAX_CHARS) {
  const s = String(content == null ? '' : content);
  if (s.length <= max) return s;
  console.warn(`[Prompt] WARN: skill "${name}" TRUNCADA — ${s.length} chars > teto ${max}. Divida a skill ou suba o teto (este corte NÃO é silencioso).`);
  return s.slice(0, max);
}

module.exports = { capSkill, SKILL_MAX_CHARS };

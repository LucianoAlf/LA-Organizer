-- 2026-07-15 — HABIT-CREATE-FREQ-CUSTOM (Arthur): criar hábito "Dias específicos" no PWA
-- falhava em silêncio. O EditHabitSheet envia frequency='custom_days' (+ custom_days int[]),
-- mas o CHECK só aceitava 'custom' → check_violation 23514 → insert lançava → hábito não criado
-- + o onError renderizava "[object Object]" (String num PostgrestError). O dispatcher de lembrete
-- (rituals/dispatcher.js) JÁ trata 'custom_days' com dias inteiros — o par PWA↔dispatcher é
-- consistente; o CHECK (e o engine) é que estavam no dialeto antigo.
-- Fix: aceitar 'custom_days'. Mantém 'custom' por zero-regressão (0 linhas usam, mas o engine
-- ainda valida contra 'custom'). Canonicalizar engine+skill p/ 'custom_days' = follow-up (mexe na
-- skill = voz, precisa do Alf). APLICADA via MCP em 15/07; este arquivo é o registro.
alter table habits drop constraint habits_frequency_check;
alter table habits add constraint habits_frequency_check
  check (frequency = any (array['daily','weekdays','weekly','custom','custom_days']));

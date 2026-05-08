-- Sprint 22.30 — events.eisenhower_quadrant (1-4 ou null).
-- User pode classificar prioridade tambem em compromissos, nao so tarefas.
-- Mesma escala (1=urgente+importante, 2=importante, 3=urgente, 4=nem-nem).

ALTER TABLE events ADD COLUMN eisenhower_quadrant INTEGER
  CHECK (eisenhower_quadrant IS NULL OR eisenhower_quadrant BETWEEN 1 AND 4);

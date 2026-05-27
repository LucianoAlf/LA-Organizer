-- Sprint 29 — Governança Inteligente (Sprint 1): Sanitização aprendida.
--
-- Adiciona classificação de dados em tasks e events pra TOM distinguir
-- entre real, teste e arquivado. Permite que listas de governança filtrem
-- automaticamente ruído e que TOM aprenda padrões pra classificar novas
-- entradas sem perguntar.
--
-- Colunas novas em tasks e events:
--   - data_classification: real|test|archived (default 'real')
--   - staleness_check_sent_at: quando TOM perguntou "isso já rolou?"
--   - coordination_request_count: quantas vezes user pediu cobrança via TOM
--
-- Tabela nova task_classifications: padrões aprendidos (ex: title_contains 'demo_'
-- vira marcador automático de teste pra futuras inserções).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS data_classification text NOT NULL DEFAULT 'real'
    CHECK (data_classification IN ('real', 'test', 'archived')),
  ADD COLUMN IF NOT EXISTS staleness_check_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordination_request_count int NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS data_classification text NOT NULL DEFAULT 'real'
    CHECK (data_classification IN ('real', 'test', 'archived')),
  ADD COLUMN IF NOT EXISTS staleness_check_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordination_request_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_data_classification ON tasks(data_classification);
CREATE INDEX IF NOT EXISTS idx_events_data_classification ON events(data_classification);

CREATE TABLE IF NOT EXISTS task_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid REFERENCES collaborators(id) ON DELETE CASCADE,
  pattern_type text NOT NULL CHECK (pattern_type IN ('title_contains', 'title_starts_with', 'created_hour_range', 'creator_id')),
  pattern_value text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('test', 'archived')),
  source text NOT NULL DEFAULT 'manual',
  confidence numeric NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  hits int NOT NULL DEFAULT 0,
  last_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_classifications_collab ON task_classifications(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_task_classifications_pattern ON task_classifications(pattern_type, pattern_value);

COMMENT ON COLUMN tasks.data_classification IS 'Sprint 29.1 — real (default), test (TOM/user marcou), archived (auto-arquivado após staleness)';
COMMENT ON COLUMN tasks.staleness_check_sent_at IS 'Sprint 29.1 — quando TOM perguntou "isso já rolou?"; usado pra auto-arquivar após 24h sem resposta';
COMMENT ON COLUMN tasks.coordination_request_count IS 'Sprint 29.1 — quantas vezes user pediu pra TOM cobrar essa task; >=3 triggera mudança de tática';
COMMENT ON TABLE task_classifications IS 'Sprint 29.1 — padrões aprendidos: title_contains "demo_" → classification=test, aplicado automaticamente em novas tasks';

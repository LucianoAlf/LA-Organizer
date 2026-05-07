-- Sprint 22.6 — tasks.due_date vira opcional. Tarefa de checklist dentro de
-- checkpoint nao precisa de prazo proprio (herda do CP visualmente).
ALTER TABLE public.tasks ALTER COLUMN due_date DROP NOT NULL;

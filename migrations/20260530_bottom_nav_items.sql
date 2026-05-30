-- Migration: Bottom Nav customizável (Sprint pós-financeiro)
-- Projeto: cesnbnrynvxvgdhfmaua (LA Organizer)
-- Adiciona pref por colaborador dos 4 slots customizáveis do bottom nav mobile.
-- O 5º slot ("Mais") é fixo e adicionado client-side no BottomNav.
-- DEFAULT backfilla as 26 linhas existentes em user_preferences.
-- collaborator_id é UNIQUE (constraint user_preferences_collaborator_id_key)
-- → upsert({onConflict:'collaborator_id'}) funciona no client.

ALTER TABLE user_preferences
  ADD COLUMN bottom_nav_items text[]
  NOT NULL
  DEFAULT ARRAY['/hoje','/projetos','/checklists','/habitos']::text[];

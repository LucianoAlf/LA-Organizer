-- Sprint 21.8 — RLS policies para autenticados (PWA leitura/escrita)
-- Bug observado: PWA mostrava "Nenhum hábito ativo" enquanto banco tinha 4 hábitos
-- ativos do usuário. Causa: tabelas habits, habit_logs, task_reminders,
-- collaborator_memory tinham apenas a policy "Service role full access" — RLS
-- bloqueava leituras autenticadas do PWA.
-- Fix: adicionar policies auth_read_own_* (e write para habit_logs/habits) usando
-- helper current_collab_id() já existente no banco.

CREATE POLICY "auth_read_own_habits" ON public.habits FOR SELECT TO authenticated
  USING (collaborator_id = current_collab_id());
CREATE POLICY "auth_insert_own_habits" ON public.habits FOR INSERT TO authenticated
  WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY "auth_update_own_habits" ON public.habits FOR UPDATE TO authenticated
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY "auth_delete_own_habits" ON public.habits FOR DELETE TO authenticated
  USING (collaborator_id = current_collab_id());

CREATE POLICY "auth_read_own_habit_logs" ON public.habit_logs FOR SELECT TO authenticated
  USING (collaborator_id = current_collab_id());
CREATE POLICY "auth_insert_own_habit_logs" ON public.habit_logs FOR INSERT TO authenticated
  WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY "auth_update_own_habit_logs" ON public.habit_logs FOR UPDATE TO authenticated
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());

CREATE POLICY "auth_read_own_task_reminders" ON public.task_reminders FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_reminders.task_id
      AND t.assigned_to = current_collab_id()
  ));

CREATE POLICY "auth_read_own_memory" ON public.collaborator_memory FOR SELECT TO authenticated
  USING (collaborator_id = current_collab_id());

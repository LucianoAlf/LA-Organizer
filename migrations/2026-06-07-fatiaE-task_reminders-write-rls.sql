-- Fatia E — task_reminders: policies de escrita pro PWA (authenticated)
-- Aplicada via Supabase apply_migration em 2026-06-07 (projeto cesnbnrynvxvgdhfmaua).
-- Causa-raiz: task_reminders só tinha policy SELECT (+ service_role ALL); faltavam
-- INSERT/UPDATE/DELETE → o PWA (client authenticated) gravava lembrete de tarefa via
-- DELETE+INSERT em useReminders.sync() e o RLS bloqueava EM SILÊNCIO → lembrete nunca
-- persistia. event_reminders já tinha as 4 policies (por isso lembrete de evento gravava).
-- Predicado idêntico ao SELECT existente (is_task_assignee = assigned_to OR created_by).

DROP POLICY IF EXISTS auth_insert_own_task_reminders ON public.task_reminders;
CREATE POLICY auth_insert_own_task_reminders ON public.task_reminders
  FOR INSERT TO authenticated
  WITH CHECK (is_task_assignee(task_id, current_collab_id()));

DROP POLICY IF EXISTS auth_update_own_task_reminders ON public.task_reminders;
CREATE POLICY auth_update_own_task_reminders ON public.task_reminders
  FOR UPDATE TO authenticated
  USING (is_task_assignee(task_id, current_collab_id()))
  WITH CHECK (is_task_assignee(task_id, current_collab_id()));

DROP POLICY IF EXISTS auth_delete_own_task_reminders ON public.task_reminders;
CREATE POLICY auth_delete_own_task_reminders ON public.task_reminders
  FOR DELETE TO authenticated
  USING (is_task_assignee(task_id, current_collab_id()));

// web/src/hooks/useTaskTransform.tsx
// Controller compartilhado pra transformar tarefas: hospeda DelegateTaskSheet e
// ConvertToEventSheet e expõe handlers + gates. Cada tela renderiza {sheets} uma vez
// e passa openDelegate/openConvert ao TaskRow e onTransform ao EditTaskSheet.
import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hasCoordLevel } from '../lib/permissions';
import { DelegateTaskSheet } from '../components/DelegateTaskSheet';
import { ConvertToEventSheet } from '../components/ConvertToEventSheet';
import type { Task } from '../types';

export function useTaskTransform() {
  const { collaborator } = useAuth();
  const [delegateTask, setDelegateTask] = useState<Task | null>(null);
  const [convertTask, setConvertTask] = useState<Task | null>(null);

  const isActive = (t: Task) => t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'delegated';

  // canDelegate: tem nível de coord E a tarefa está atribuída a você (espelha o guard
  // de posse do engine — re-delegar tarefa de terceiro está fora do escopo do v1).
  const canDelegate = useCallback((t: Task): boolean => {
    if (!collaborator || !hasCoordLevel(collaborator)) return false;
    if (!isActive(t)) return false;
    return t.assigned_to === collaborator.id;
  }, [collaborator]);

  // canConvert: qualquer um pode converter a PRÓPRIA tarefa em compromisso.
  const canConvert = useCallback((t: Task): boolean => {
    if (!collaborator) return false;
    if (!isActive(t)) return false;
    return t.assigned_to === collaborator.id;
  }, [collaborator]);

  const onEditSheetTransform = useCallback((t: Task, kind: 'event' | 'delegate') => {
    if (kind === 'delegate') setDelegateTask(t);
    else setConvertTask(t);
  }, []);

  const sheets = (
    <>
      <DelegateTaskSheet open={Boolean(delegateTask)} task={delegateTask} onClose={() => setDelegateTask(null)} />
      <ConvertToEventSheet open={Boolean(convertTask)} task={convertTask} onClose={() => setConvertTask(null)} />
    </>
  );

  return {
    sheets,
    openDelegate: setDelegateTask,
    openConvert: setConvertTask,
    canDelegate,
    canConvert,
    onEditSheetTransform,
    canDelegateAny: collaborator ? hasCoordLevel(collaborator) : false,
  };
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListTodo } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { TaskRow } from '../components/TaskRow';
import { StatCard } from '../components/StatCard';
import { Tabs } from '../components/Tabs';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Fab } from '../components/Fab';
import { QuickTaskSheet } from '../components/QuickTaskSheet';
import type { Task, TaskContext } from '../types';

async function fetchTasksToday(collabId: string): Promise<Task[]> {
  const today = todaySP();
  // PRD §5.2: PWA é espelho — não faz JOIN de regra de negócio. Lê tasks por user.
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, completed_at, projects(name)')
    .eq('assigned_to', collabId)
    .or(`due_date.eq.${today},and(due_date.lt.${today},status.not.in.(done,cancelled))`)
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

export function Hoje() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TaskContext>('work');
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ['tasks', 'hoje', collaborator?.id],
    queryFn: () => collaborator ? fetchTasksToday(collaborator.id) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  const toggleTask = useMutation({
    mutationFn: async (task: Task) => {
      const isDone = task.status === 'done';
      const { error } = await supabase
        .from('tasks')
        .update(isDone
          ? { status: 'pending', completed_at: null, completed_by: null }
          : { status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator?.id })
        .eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const work = tasks.filter(t => t.context === 'work');
  const personal = tasks.filter(t => t.context === 'personal');
  const today = todaySP();
  const todayList = (tab === 'work' ? work : personal);
  const dueToday = todayList.filter(t => t.due_date === today);
  const overdue = todayList.filter(t => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled'));
  const done = todayList.filter(t => t.status === 'done');

  return (
    <div className="space-y-lg">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Pra hoje" value={dueToday.length} tone="brand" />
        <StatCard label="Atrasadas" value={overdue.length} tone={overdue.length ? 'danger' : 'neutral'} />
        <StatCard label="Concluídas" value={done.length} tone={done.length ? 'success' : 'neutral'} />
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'work', label: 'Trabalho', badge: work.length },
          { id: 'personal', label: 'Pessoal', badge: personal.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* List */}
      <section className="surface px-md">
        {!supabaseConfigured ? (
          <EmptyState
            icon={<ListTodo size={32} />}
            title="Configure Supabase"
            description="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env e reinicie."
          />
        ) : isLoading ? (
          <div className="py-md"><LoadingState rows={3} /></div>
        ) : error ? (
          <EmptyState
            title="Não consegui carregar suas tarefas"
            description={(error as Error).message}
            action={<Button variant="secondary" onClick={() => qc.invalidateQueries({ queryKey: ['tasks'] })}>Tentar de novo</Button>}
          />
        ) : todayList.length === 0 ? (
          <EmptyState
            icon={<ListTodo size={32} />}
            title="Sem tarefas hoje."
            description={tab === 'work' ? 'Bora planejar a semana?' : 'Sem itens pessoais pra hoje.'}
          />
        ) : (
          todayList.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={(task) => toggleTask.mutate(task)}
            />
          ))
        )}
      </section>

      <Fab onClick={() => setSheetOpen(true)} label="Nova" ariaLabel="Criar nova tarefa" />
      <QuickTaskSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}

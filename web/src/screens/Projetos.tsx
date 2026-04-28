import { useQuery } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { ProjectCard } from '../components/ProjectCard';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import type { Project } from '../types';

async function fetchProjects(collabId: string, isCoordOrDir: boolean): Promise<Project[]> {
  const select = 'id, name, description, category, status, progress_percent, start_date, end_date, created_by';
  if (isCoordOrDir) {
    const { data, error } = await supabase
      .from('projects')
      .select(select)
      .eq('status', 'active')
      .order('progress_percent', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Project[];
  }
  // Collaborators see projects they created OR are members of OR lead.
  // (No leader_id column — leader is encoded in project_members.role_in_project='leader')
  const { data: created, error: e1 } = await supabase
    .from('projects')
    .select(select)
    .eq('created_by', collabId)
    .eq('status', 'active');
  if (e1) throw e1;
  const { data: memberRows, error: e2 } = await supabase
    .from('project_members')
    .select('project_id, projects(' + select + ')')
    .eq('collaborator_id', collabId);
  if (e2) throw e2;
  const merged = new Map<string, Project>();
  for (const p of (created ?? []) as Project[]) merged.set(p.id, p);
  for (const m of memberRows ?? []) {
    const p = (m as { projects?: Project }).projects;
    if (p && p.status === 'active') merged.set(p.id, p);
  }
  return [...merged.values()].sort((a, b) => (a.progress_percent ?? 0) - (b.progress_percent ?? 0));
}

export function Projetos() {
  const { collaborator, role } = useAuth();
  const isCoordOrDir = role === 'coordinator' || role === 'director';

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects', collaborator?.id, isCoordOrDir],
    queryFn: () => collaborator ? fetchProjects(collaborator.id, isCoordOrDir) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Projetos</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          {isCoordOrDir ? 'Todos os projetos ativos' : 'Os que você lidera ou participa'}
        </p>
      </header>

      {!supabaseConfigured ? (
        <EmptyState icon={<Rocket size={32} />} title="Configure Supabase" />
      ) : isLoading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Rocket size={32} />}
          title={isCoordOrDir ? 'Nenhum projeto ativo' : 'Você ainda não tá em nenhum projeto'}
          description="Crie pelo TOM no WhatsApp: 'criar projeto'"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          {projects.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  );
}

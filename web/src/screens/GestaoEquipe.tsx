import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';

type CollabRow = {
  id: string;
  full_name: string;
  role: string;
  unit: string | null;
  is_active: boolean;
  avatar_url: string | null;
};

const ROLE_COLOR: Record<string, string> = {
  director:     '#E91451',
  coordinator:  '#7c3aed',
  manager:      '#0ea5e9',
  leader:       '#f59e0b',
  collaborator: '#6b7280',
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

type Filter = 'all' | 'active' | 'inactive';

export function GestaoEquipe() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-collaborators'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role, unit, is_active, avatar_url')
        .order('full_name');
      if (error) throw error;
      return data as CollabRow[];
    },
  });

  const visible = (data ?? []).filter(c => {
    if (filter === 'active'   && !c.is_active) return false;
    if (filter === 'inactive' &&  c.is_active) return false;
    if (search && !c.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (isLoading) return <LoadingState />;
  if (error) return <div className="p-md text-danger">Erro ao carregar equipe.</div>;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title="Gestão de equipe"
        subtitle="Cadastre e gerencie o acesso da equipe."
        backTo="/mais"
      />

      {/* Busca + botão novo */}
      <div className="px-md flex gap-2">
        <input
          type="search"
          placeholder="Buscar colaborador..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-body-sm focus-ring outline-none"
        />
        <Link
          to="/mais/gestao-equipe/novo"
          className="h-10 w-10 grid place-items-center rounded-lg bg-tom text-white focus-ring"
          aria-label="Novo colaborador"
        >
          <Plus size={18} />
        </Link>
      </div>

      {/* Filtros */}
      <div className="px-md flex gap-2">
        {(['all', 'active', 'inactive'] as Filter[]).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-body-sm px-3 py-1 rounded-full border transition-colors ${
              filter === f
                ? 'bg-tom text-white border-tom'
                : 'bg-bg-elevated border-border text-fg-muted'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'active' ? 'Ativos' : 'Inativos'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {visible.length === 0 ? (
        <EmptyState title="Nenhum resultado" description="Tente outro filtro ou nome." />
      ) : (
        <ul className="surface divide-y divide-border">
          {visible.map(c => (
            <li key={c.id}>
              <Link
                to={`/mais/gestao-equipe/${c.id}`}
                className="flex items-center gap-3 p-md hover:bg-bg-elevated focus-ring"
              >
                {/* Avatar */}
                <div
                  className="h-10 w-10 rounded-full grid place-items-center text-white text-xs font-bold shrink-0 overflow-hidden"
                  style={{ background: ROLE_COLOR[c.role] ?? '#6b7280' }}
                >
                  {c.avatar_url
                    ? <img src={c.avatar_url} alt="" className="h-full w-full object-cover" />
                    : initials(c.full_name)
                  }
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-body-md font-medium truncate">{c.full_name}</div>
                  <div className="text-body-sm text-fg-muted">
                    {c.role}{c.unit ? ` · ${c.unit}` : ''}
                  </div>
                </div>
                {/* Status dot */}
                <div className={`h-2 w-2 rounded-full shrink-0 ${c.is_active ? 'bg-green-400' : 'bg-fg-subtle'}`} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-body-sm text-fg-muted text-center px-md">
        {visible.length} colaborador{visible.length !== 1 ? 'es' : ''}
      </p>
    </div>
  );
}

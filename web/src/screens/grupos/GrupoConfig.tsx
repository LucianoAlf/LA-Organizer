// web/src/screens/grupos/GrupoConfig.tsx
// Configurações do grupo como PÁGINA INTEIRA (rota /grupos/:groupId/config) —
// substitui o antigo modal GroupConfigPanel. Espelha a estrutura da GrupoAnotacoes
// (header + voltar + gate). Entra na sidebar/topbar via AppLayout (mobile + desktop).
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, useMyGroupIds } from '../../hooks/useWorkGroups';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { GroupConfigContent } from './GroupConfigContent';

export function GrupoConfig() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { list, meuId } = useWorkGroups();
  const myIds = useMyGroupIds();

  if (list.isLoading || myIds.isLoading) {
    return <div className="space-y-lg w-full pb-2xl"><LoadingState rows={4} label="Carregando configurações…" /></div>;
  }

  const group = (list.data ?? []).find(g => g.id === groupId);
  const backToGroups = <Button variant="secondary" size="md" onClick={() => navigate('/grupos')}><ChevronLeft size={14} /> Voltar pros grupos</Button>;
  if (!group) {
    return <div className="space-y-lg w-full pb-2xl"><EmptyState title="Grupo não encontrado" description="Esse grupo não existe ou foi desativado." action={backToGroups} /></div>;
  }

  const canManage = role === 'director' || role === 'coordinator' || role === 'manager' || group.leader_id === meuId;
  if (!canManage) {
    return (
      <div className="space-y-lg w-full pb-2xl">
        <EmptyState
          title="Sem permissão"
          description="Só o líder ou a gestão configuram o grupo."
          action={<Button variant="secondary" size="md" onClick={() => navigate(`/grupos/${groupId}`)}><ChevronLeft size={14} /> Voltar pro grupo</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <header className="shrink-0">
        <button type="button" onClick={() => navigate(`/grupos/${groupId}`)} className="inline-flex items-center gap-xs text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm">
          <ChevronLeft size={14} /> Grupos · {group.name}
        </button>
        <div className="flex items-center gap-md mt-xs">
          <h1 className="text-screen-title flex items-center gap-sm"><Settings size={22} className="text-tom" /> Configurações</h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto mt-md">
        <GroupConfigContent group={group} />
      </div>
    </div>
  );
}

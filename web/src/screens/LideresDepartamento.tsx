// Líderes de departamento (matriz de governança, Fase 1.7).
// Ambiente central (só Diretor) pra escolher o líder de cada grupo. Escreve em
// governance_leaders. Farmer é por unidade; os demais grupos são globais ('all').
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { CustomSelect } from '../components/CustomSelect';
import { LoadingState } from '../components/LoadingState';
import { showToast } from '../components/Toast';
import { fetchGroupLeaders, addGroupLeader, removeGroupLeader } from '../lib/governance-edges';

const GLOBAL_GROUPS = [
  { key: 'pedagogico',      label: 'Pedagógico' },
  { key: 'sonoramente',     label: 'Sonoramente' },
  { key: 'comercial',       label: 'Comercial' },
  { key: 'marketing',       label: 'Marketing' },
  { key: 'financeiro',      label: 'Financeiro' },
  { key: 'ops_tecnicas',    label: 'Operações' },
  { key: 'sucesso_cliente', label: 'Sucesso do Cliente' },
] as const;

const FARMER_UNITS = [
  { value: 'barra',        label: 'Barra' },
  { value: 'recreio',      label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
] as const;

type Roster = { id: string; full_name: string; preferred_name: string | null };

export function LideresDepartamento() {
  const { role } = useAuth();
  const isDirector = role === 'director';

  const { data: roster = [], isLoading: l1 } = useQuery({
    queryKey: ['gov-roster'],
    queryFn: async () => {
      const { data } = await supabase.from('collaborators')
        .select('id, full_name, preferred_name').eq('is_active', true).order('full_name');
      return (data ?? []) as Roster[];
    },
    enabled: isDirector,
  });
  const { data: leaders = [], isLoading: l2, refetch } = useQuery({
    queryKey: ['gov-leaders'],
    queryFn: fetchGroupLeaders,
    enabled: isDirector,
  });

  if (!isDirector) {
    return (
      <div className="space-y-lg pb-xl">
        <PageHeader title="Líderes de departamento" backTo="/mais/gestao-equipe" />
        <p className="px-md text-body-md text-fg-muted">Acesso restrito ao Diretor.</p>
      </div>
    );
  }
  if (l1 || l2) return <LoadingState />;

  const nameOf = (idv: string) => {
    const c = roster.find(x => x.id === idv);
    return c?.preferred_name || c?.full_name || idv;
  };
  const leadersFor = (group: string, unit: string) =>
    leaders.filter(g => g.group_key === group && g.unit === unit);
  const optionsExcluding = (excludeIds: string[]) =>
    roster.filter(c => !excludeIds.includes(c.id)).map(c => ({ value: c.id, label: c.preferred_name || c.full_name }));

  async function add(group: string, unit: string, leaderId: string) {
    if (!leaderId) return;
    try { await addGroupLeader(group, unit, leaderId); await refetch(); }
    catch { showToast({ kind: 'error', title: 'Erro ao adicionar (só Diretor pode).' }); }
  }
  async function remove(group: string, unit: string, leaderId: string) {
    try { await removeGroupLeader(group, unit, leaderId); await refetch(); }
    catch { showToast({ kind: 'error', title: 'Erro ao remover.' }); }
  }

  const chipCls = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-body-sm font-medium bg-tom text-black';

  function renderRow(group: string, unit: string) {
    const current = leadersFor(group, unit);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {current.map(g => (
          <button key={g.leader_id} type="button" onClick={() => remove(group, unit, g.leader_id)} className={chipCls}>
            {nameOf(g.leader_id)} <span aria-hidden>✕</span>
          </button>
        ))}
        {current.length === 0 && <span className="text-body-sm text-fg-muted italic">sem líder</span>}
        <div className="min-w-[200px]">
          <CustomSelect
            value=""
            placeholder="+ adicionar líder"
            options={optionsExcluding(current.map(g => g.leader_id))}
            onChange={(v) => add(group, unit, v)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader title="Líderes de departamento" subtitle="Quem lidera cada grupo (só Diretor)" backTo="/mais/gestao-equipe" />
      <p className="px-md text-body-sm text-fg-muted">
        Quem estiver em um grupo (definido na pessoa, em "Grupo de governança") cai automaticamente no líder dele.
        Farmer é por unidade; os demais grupos são globais.
      </p>

      {GLOBAL_GROUPS.map(g => (
        <section key={g.key} className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">{g.label}</h2>
          {renderRow(g.key, 'all')}
        </section>
      ))}

      <section className="surface p-lg space-y-md">
        <h2 className="text-label text-fg-muted uppercase tracking-wide">Farmer (por unidade)</h2>
        {FARMER_UNITS.map(u => (
          <div key={u.value} className="space-y-1">
            <label className="text-body-sm text-fg-muted">{u.label}</label>
            {renderRow('farmer', u.value)}
          </div>
        ))}
      </section>
    </div>
  );
}

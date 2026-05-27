// Sprint 23 — KpiStripe (Task 2.4 — implementação completa)
// Faixa compacta com 4 métricas do dia + aderência mensal.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

interface KpiData {
  feitas: number;
  total: number;
  pendentes: number;
  atrasadas: number;
  aderenciaMes: number;
}

export function KpiStripe() {
  const { data, isLoading } = useQuery<KpiData>({
    queryKey: ['checklists-kpi'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error('Sem usuário');

      // Hoje: feitas, pendentes, atrasadas
      const { data: hoje } = await supabase
        .from('op_checklist_completions')
        .select('id, completed_at, dispatched_at, op_checklists!inner(completion_threshold)')
        .eq('collaborator_id', user.id)
        .eq('reference_date', today);

      const sixHoursAgo = new Date(Date.now() - 6 * 3600000);
      let feitas = 0;
      let pendentes = 0;
      let atrasadas = 0;
      (hoje || []).forEach((c: any) => {
        if (c.completed_at) feitas++;
        else if (c.dispatched_at && new Date(c.dispatched_at) < sixHoursAgo) atrasadas++;
        else pendentes++;
      });

      // Mês: aderência
      const { data: mes } = await supabase
        .from('op_checklist_completions')
        .select('id, completed_at')
        .eq('collaborator_id', user.id)
        .gte('reference_date', monthAgo);
      const totalMes = mes?.length || 0;
      const completedMes = (mes || []).filter((c: any) => c.completed_at).length;
      const aderenciaMes = totalMes ? Math.round((completedMes / totalMes) * 100) : 0;

      return {
        feitas,
        total: hoje?.length || 0,
        pendentes,
        atrasadas,
        aderenciaMes,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="mx-6 my-3 h-12 bg-bg-surface border border-border rounded-md animate-pulse" />
    );
  }

  return (
    <div className="mx-6 my-3 px-4 py-3 bg-bg-surface border border-border rounded-md flex items-center gap-6 text-sm flex-wrap">
      <div>
        <span className="text-tom font-bold text-base">{data.feitas}/{data.total}</span>
        <span className="text-fg/60 ml-1">feitas hoje</span>
      </div>
      <div>
        <span className="font-bold text-base">{data.pendentes}</span>
        <span className="text-fg/60 ml-1">pendentes</span>
      </div>
      <div className={data.atrasadas > 0 ? 'text-danger' : 'text-fg/60'}>
        <span className="font-bold text-base">{data.atrasadas}</span>
        <span className="ml-1">atrasada{data.atrasadas !== 1 ? 's' : ''}</span>
      </div>
      <div className="ml-auto text-fg/60">
        Aderência mês:{' '}
        <span className="text-fg font-bold">{data.aderenciaMes}%</span>
      </div>
    </div>
  );
}

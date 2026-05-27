// Sprint 23 — Aderência agregada por template (todos colaboradores)
// Range: today | week | month

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export type Range = 'today' | 'week' | 'month';

export interface TemplateAderencia {
  template_id: string;
  template_name: string;
  dispatch_time: string | null;
  totalInstancias: number;
  completas: number;
  atrasadas: number;
  pendentes: number;
  pctCompletion: number;
  responsaveis: Array<{
    id: string;
    name: string;
    status: 'done' | 'late' | 'pending';
  }>;
}

export interface AderenciaInstance {
  template_id: string;
  template_name: string;
  collaborator_id: string;
  collaborator_name: string;
  dispatch_time: string | null;
  reference_date: string;
  status: 'done' | 'late' | 'pending';
}

function rangeDates(range: Range): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  if (range === 'today') return { from: to, to };
  if (range === 'week') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { from: d.toISOString().slice(0, 10), to };
  }
  const d = new Date(today);
  d.setDate(d.getDate() - 29);
  return { from: d.toISOString().slice(0, 10), to };
}

export function useAderencia(range: Range) {
  return useQuery<{ byTemplate: TemplateAderencia[]; instances: AderenciaInstance[] }>({
    queryKey: ['aderencia', range],
    queryFn: async () => {
      const { from, to } = rangeDates(range);

      // Query 1: completions com template (join op_checklists funciona pq FK direta)
      const { data: comps, error } = await supabase
        .from('op_checklist_completions')
        .select(
          `id, reference_date, completed_at, dispatched_at, collaborator_id,
           op_checklists!inner ( id, name, dispatch_time )`
        )
        .gte('reference_date', from)
        .lte('reference_date', to);
      if (error) throw error;

      // Query 2: nomes dos colaboradores envolvidos (separada — RLS pode bloquear join)
      const collabIds = Array.from(new Set((comps || []).map((c: any) => c.collaborator_id))).filter(Boolean);
      let collabNames = new Map<string, string>();
      if (collabIds.length > 0) {
        const { data: collabs } = await supabase
          .from('collaborators')
          .select('id, full_name, preferred_name')
          .in('id', collabIds);
        for (const c of collabs || []) {
          collabNames.set(c.id, (c as any).preferred_name || (c as any).full_name || '?');
        }
      }

      const sixHoursAgo = Date.now() - 6 * 3600000;
      const instances: AderenciaInstance[] = (comps || []).map((c: any) => {
        let status: 'done' | 'late' | 'pending';
        if (c.completed_at) status = 'done';
        else if (c.dispatched_at && new Date(c.dispatched_at).getTime() < sixHoursAgo)
          status = 'late';
        else status = 'pending';
        return {
          template_id: c.op_checklists.id,
          template_name: c.op_checklists.name,
          collaborator_id: c.collaborator_id,
          collaborator_name: collabNames.get(c.collaborator_id) || '?',
          dispatch_time: c.op_checklists.dispatch_time,
          reference_date: c.reference_date,
          status,
        };
      });

      const byTplMap = new Map<string, TemplateAderencia>();
      for (const inst of instances) {
        if (!byTplMap.has(inst.template_id)) {
          byTplMap.set(inst.template_id, {
            template_id: inst.template_id,
            template_name: inst.template_name,
            dispatch_time: inst.dispatch_time,
            totalInstancias: 0,
            completas: 0,
            atrasadas: 0,
            pendentes: 0,
            pctCompletion: 0,
            responsaveis: [],
          });
        }
        const t = byTplMap.get(inst.template_id)!;
        t.totalInstancias++;
        if (inst.status === 'done') t.completas++;
        else if (inst.status === 'late') t.atrasadas++;
        else t.pendentes++;
        t.responsaveis.push({
          id: inst.collaborator_id,
          name: inst.collaborator_name,
          status: inst.status,
        });
      }
      const byTemplate = Array.from(byTplMap.values()).map((t) => ({
        ...t,
        pctCompletion: t.totalInstancias
          ? Math.round((t.completas / t.totalInstancias) * 100)
          : 0,
      }));

      return { byTemplate, instances };
    },
    staleTime: 30_000,
  });
}

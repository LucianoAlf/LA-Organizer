import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { CustomSelect } from '../components/CustomSelect';
import { Tabs } from '../components/Tabs';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { SECTORS, SECTOR_LABELS } from '../types';
import type { EventSector } from '../types';

type Unit = 'barra' | 'recreio' | 'campo_grande';

const UNITS: Unit[] = ['barra', 'recreio', 'campo_grande'];
const UNIT_LABELS: Record<Unit, string> = {
  barra: 'Barra',
  recreio: 'Recreio',
  campo_grande: 'Campo Grande',
};

interface CollabOption {
  id: string;
  full_name: string;
}

export function ConfigurarEquipe() {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [unit, setUnit] = useState<Unit>('barra');
  const [draft, setDraft] = useState<Record<EventSector, string>>({
    logistica: '', tecnica: '', pedagogico: '', comunicacao: '', producao: '',
  });
  const [feedback, setFeedback] = useState<string>('');

  const { data: collabs = [] } = useQuery({
    queryKey: ['collaborators-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CollabOption[];
    },
  });

  const { data: mapRows = [], isLoading } = useQuery({
    queryKey: ['event-team-map', unit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_team_map')
        .select('sector, collaborator_id')
        .eq('unit', unit);
      if (error) throw error;
      return (data ?? []) as { sector: EventSector; collaborator_id: string }[];
    },
  });

  // Sync draft when unit changes or query loads
  useEffect(() => {
    const next: Record<EventSector, string> = {
      logistica: '', tecnica: '', pedagogico: '', comunicacao: '', producao: '',
    };
    for (const row of mapRows) {
      next[row.sector] = row.collaborator_id;
    }
    setDraft(next);
    setFeedback('');
  }, [unit, mapRows]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setFeedback('');
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });

      const toDelete = SECTORS.filter(s => !draft[s]);
      const toUpsert = SECTORS.filter(s => draft[s]).map(s => ({
        unit,
        sector: s,
        collaborator_id: draft[s],
      }));

      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from('event_team_map')
          .delete()
          .eq('unit', unit)
          .in('sector', toDelete);
        if (delErr) throw delErr;
      }
      if (toUpsert.length) {
        const { error: upErr } = await supabase
          .from('event_team_map')
          .upsert(toUpsert, { onConflict: 'unit,sector' });
        if (upErr) throw upErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-team-map', unit] });
      setFeedback('Salvo com sucesso.');
    },
    onError: (err: Error) => setFeedback('Erro: ' + err.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Equipe por Setor"
        subtitle="Define o responsável padrão por setor em cada unidade. Tasks de eventos são atribuídas automaticamente a esses responsáveis no momento da criação."
        backTo="/mais/agenda-escolar"
      />

      <Tabs
        tabs={UNITS.map(u => ({ id: u, label: UNIT_LABELS[u] }))}
        active={unit}
        onChange={(u) => setUnit(u as Unit)}
      />

      {isLoading && <p className="text-body-sm text-fg-muted">Carregando...</p>}

      {!isLoading && (
        <div className="bg-bg-surface rounded-xl border border-border p-4 space-y-3">
          {SECTORS.map(sector => (
            <div key={sector} className="flex items-center gap-3">
              <label className="text-body w-32 shrink-0">{SECTOR_LABELS[sector]}</label>
              <div className="flex-1 min-w-0">
                <CustomSelect
                  size="sm"
                  value={draft[sector]}
                  onChange={(v) => setDraft(prev => ({ ...prev, [sector]: v }))}
                  placeholder="Sem responsável fixo"
                  options={[
                    { value: '', label: 'Sem responsável fixo' },
                    ...collabs.map(c => ({ value: c.id, label: c.full_name })),
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {feedback && (
        <p className={`text-body-sm ${feedback.startsWith('Erro') ? 'text-danger' : 'text-success'}`}>
          {feedback}
        </p>
      )}

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || isLoading}
        className="w-full py-3 bg-brand text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {saveMutation.isPending ? 'Salvando...' : `Salvar equipe da ${UNIT_LABELS[unit]}`}
      </button>
    </div>
  );
}

// Pendências de Inventário — Lista agrupada por prioridade.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../../../components/EmptyState';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { showToast } from '../../../components/Toast';
import { atualizarPendencia } from '../../../lib/lareport-mutations';
import { PendenciaSheet } from './PendenciaSheet';
import { ConcluirPendenciaSheet } from './ConcluirPendenciaSheet';
import type { ReportPendencia } from '../../../hooks/useLaReport';

interface Props {
  salaId: number;
  unidadeId: string;
  pendencias: ReportPendencia[];
  itensSala: { id: number; nome: string }[];
}

const PRIORIDADE_META: Record<ReportPendencia['prioridade'], { emoji: string; label: string; order: number }> = {
  urgente: { emoji: '🔴', label: 'Urgente', order: 0 },
  importante: { emoji: '🟠', label: 'Importante', order: 1 },
  futuramente: { emoji: '🟡', label: 'Futuramente', order: 2 },
};

const CATEGORIA_LABEL: Record<NonNullable<ReportPendencia['categoria']>, string> = {
  compra: '🛒 Compra',
  reposicao: '🔁 Reposição',
  reparo: '🔧 Reparo',
  melhoria: '✨ Melhoria',
};

export function PendenciasView({ salaId, unidadeId, pendencias, itensSala }: Props) {
  const qc = useQueryClient();
  const [novaOpen, setNovaOpen] = useState(false);
  const [editando, setEditando] = useState<ReportPendencia | null>(null);
  const [concluindo, setConcluindo] = useState<ReportPendencia | null>(null);

  const grupos = useMemo(() => {
    const map: Record<ReportPendencia['prioridade'], ReportPendencia[]> = {
      urgente: [], importante: [], futuramente: [],
    };
    for (const p of pendencias) map[p.prioridade].push(p);
    return (Object.keys(PRIORIDADE_META) as ReportPendencia['prioridade'][])
      .sort((a, b) => PRIORIDADE_META[a].order - PRIORIDADE_META[b].order)
      .map(k => ({ key: k, meta: PRIORIDADE_META[k], itens: map[k] }))
      .filter(g => g.itens.length > 0);
  }, [pendencias]);

  async function setStatus(p: ReportPendencia, status: 'em_andamento' | 'cancelada', toastMsg?: string) {
    try {
      await atualizarPendencia(p.id, { status });
      qc.invalidateQueries({ queryKey: ['lareport', 'pendencias', salaId] });
      if (toastMsg) showToast({ kind: 'success', title: toastMsg });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleCancelar(p: ReportPendencia) {
    if (!window.confirm(`Cancelar pendência "${p.titulo}"?`)) return;
    setStatus(p, 'cancelada', 'Pendência cancelada');
  }

  return (
    <div className="space-y-md">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setNovaOpen(true)}>
          ＋ Nova pendência
        </Button>
      </div>

      {pendencias.length === 0 ? (
        <EmptyState
          icon={<span>📝</span>}
          title="Sem pendências"
          description="Nenhuma pendência aberta nesta sala. Use o ＋ ou peça pro TOM no WhatsApp."
        />
      ) : (
        grupos.map(g => (
          <div key={g.key} className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-fg-muted px-1">
              {g.meta.emoji} {g.meta.label} ({g.itens.length})
            </div>
            {g.itens.map(p => (
              <div key={p.id} className="bg-bg-surface rounded-lg border border-border p-sm space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-fg flex-1">{p.titulo}</div>
                  <div className="flex gap-1 flex-shrink-0">
                    {p.status === 'em_andamento' ? (
                      <Badge tone="warning">Em andamento</Badge>
                    ) : (
                      <Badge tone="neutral">Aberta</Badge>
                    )}
                    {p.categoria && <Badge tone="info">{CATEGORIA_LABEL[p.categoria]}</Badge>}
                  </div>
                </div>
                {p.descricao && (
                  <div className="text-body-sm text-fg-muted line-clamp-2">{p.descricao}</div>
                )}
                <div className="text-[10px] text-fg-muted">
                  {p.solicitante ? `${p.solicitante} · ` : ''}
                  {new Date(p.created_at).toLocaleDateString('pt-BR')}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Button variant="primary" size="sm" onClick={() => setConcluindo(p)}>
                    ✅ Concluir
                  </Button>
                  {p.status === 'aberta' && (
                    <Button variant="ghost" size="sm" onClick={() => setStatus(p, 'em_andamento')}>
                      ▶ Em andamento
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditando(p)}>
                    ✏️ Editar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleCancelar(p)}>
                    ❌ Cancelar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <PendenciaSheet
        open={novaOpen}
        onClose={() => setNovaOpen(false)}
        salaId={salaId}
        unidadeId={unidadeId}
      />
      <PendenciaSheet
        open={!!editando}
        onClose={() => setEditando(null)}
        salaId={salaId}
        unidadeId={unidadeId}
        pendencia={editando}
      />
      <ConcluirPendenciaSheet
        open={!!concluindo}
        onClose={() => setConcluindo(null)}
        pendencia={concluindo}
        itensSala={itensSala}
      />
    </div>
  );
}

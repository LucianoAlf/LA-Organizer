import { useState } from 'react';
import { Anchor, Check, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { AvaliacaoComCheckpoint } from '../../../lib/laeduca-types';
import { JustificativaModal } from './JustificativaModal';

interface Props {
  item: AvaliacaoComCheckpoint;
  onAncorar: (params: { nota: number; observacoes: string; justificativaBaixa: string | null }) => Promise<void>;
  posicaoLabel?: string;       // ex: "p1.3" — label posicional calculado pelo parent
  canReorder?: boolean;        // se true, exibe drag handle (listeners/attributes vêm do parent via wrapper)
  dragHandleListeners?: SyntheticListenerMap;
  dragHandleAttributes?: DraggableAttributes;
}

export function CheckpointRow({
  item,
  onAncorar,
  posicaoLabel,
  canReorder = false,
  dragHandleListeners,
  dragHandleAttributes,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [nota, setNota] = useState<number>(item.nota || 0);
  const [obs, setObs] = useState<string>(item.observacoes || '');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const ancorado = item.ancorado;
  const notaMin = item.checkpoint.nota_minima ?? 7;

  async function handleAncorar(justificativa: string | null) {
    setSaving(true);
    try {
      await onAncorar({ nota, observacoes: obs, justificativaBaixa: justificativa });
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  }

  function tryAncorar() {
    if (nota >= notaMin) handleAncorar(null);
    else setShowModal(true);
  }

  const labelDisplay = posicaoLabel ?? item.checkpoint.id;

  return (
    <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
      {/* ── Header sempre visível ── */}
      <div className="flex items-center gap-sm px-md py-sm">
        {/* Drag handle */}
        {canReorder && (
          <button
            className="cursor-grab shrink-0 text-fg-muted hover:text-fg focus-ring rounded p-0.5 touch-none"
            title="Arrastar para reordenar"
            {...dragHandleListeners}
            {...dragHandleAttributes}
          >
            <GripVertical size={14} />
          </button>
        )}

        {/* Label posicional */}
        <span className="text-[11px] text-fg-muted font-mono shrink-0">[{labelDisplay}]</span>

        {/* Título */}
        <span className="text-body-sm text-fg font-semibold flex-1 min-w-0 truncate">
          {item.checkpoint.titulo}
        </span>

        {/* Status badges */}
        <div className="flex items-center gap-sm shrink-0">
          {ancorado && (
            <span className="text-success flex items-center gap-1 text-[11px] font-semibold">
              <Check size={13} /> Ancorado
            </span>
          )}
          <span className="text-[11px] text-fg-muted hidden sm:inline">
            Mín: <strong className="text-tom">{notaMin.toFixed(1)}</strong>
          </span>
          {/* Chevron expand/collapse */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 text-fg-muted hover:text-fg focus-ring rounded"
            title={expanded ? 'Colapsar' : 'Expandir'}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* ── Conteúdo expandido ── */}
      {expanded && (
        <div className="px-md pb-md space-y-sm border-t border-border pt-sm">
          <p className="text-body-sm text-fg-muted">{item.checkpoint.descricao}</p>
          <p className="text-body-sm text-fg-muted italic">Critério: {item.checkpoint.criterio}</p>

          <div className="flex items-center gap-md">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={nota}
              onChange={e => setNota(parseFloat(e.target.value))}
              className="flex-1"
              disabled={saving}
            />
            <span className={`min-w-[3rem] text-right font-semibold ${nota >= notaMin ? 'text-success' : 'text-warning'}`}>
              {nota.toFixed(1)}
            </span>
          </div>

          <textarea
            className="w-full bg-bg-app text-fg rounded p-sm border border-border focus-ring text-body-sm resize-y"
            placeholder="Observações (opcional)"
            value={obs}
            onChange={e => setObs(e.target.value)}
            rows={5}
            style={{ minHeight: '120px' }}
            disabled={saving}
          />

          <button
            onClick={tryAncorar}
            disabled={saving}
            className="w-full flex items-center justify-center gap-sm px-md py-sm rounded bg-tom text-black font-semibold disabled:opacity-50 focus-ring"
          >
            <Anchor size={16} />
            {ancorado ? 'Atualizar âncora' : 'Ancorar checkpoint'}
          </button>
        </div>
      )}

      {showModal && (
        <JustificativaModal
          nota={nota}
          notaMin={notaMin}
          onCancel={() => setShowModal(false)}
          onConfirm={j => handleAncorar(j)}
        />
      )}
    </div>
  );
}

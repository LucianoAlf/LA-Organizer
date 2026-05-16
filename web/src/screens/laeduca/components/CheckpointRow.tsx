import { useState } from 'react';
import { Anchor, Check } from 'lucide-react';
import type { AvaliacaoComCheckpoint } from '../../../lib/laeduca-types';
import { JustificativaModal } from './JustificativaModal';

interface Props {
  item: AvaliacaoComCheckpoint;
  onAncorar: (params: { nota: number; observacoes: string; justificativaBaixa: string | null }) => Promise<void>;
}

export function CheckpointRow({ item, onAncorar }: Props) {
  const [nota, setNota] = useState<number>(item.nota || 0);
  const [obs, setObs] = useState<string>(item.observacoes || '');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const ancorado = item.ancorado;

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
    if (nota >= 7) handleAncorar(null);
    else setShowModal(true);
  }

  return (
    <div className="bg-bg-surface rounded-lg p-md border border-border space-y-sm">
      <div className="flex items-start justify-between gap-sm">
        <div>
          <h3 className="font-semibold text-fg">
            <span className="text-fg-muted mr-2">{item.checkpoint.id}</span>
            {item.checkpoint.titulo}
          </h3>
          <p className="text-body-sm text-fg-muted mt-1">{item.checkpoint.descricao}</p>
          <p className="text-body-sm text-fg-muted mt-1 italic">Critério: {item.checkpoint.criterio}</p>
        </div>
        {ancorado && (
          <span className="text-success flex items-center gap-1 text-body-sm font-semibold">
            <Check size={16} /> Ancorado
          </span>
        )}
      </div>

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
        <span className={`min-w-[3rem] text-right font-semibold ${nota >= 7 ? 'text-success' : 'text-warning'}`}>
          {nota.toFixed(1)}
        </span>
      </div>

      <textarea
        className="w-full bg-bg-app text-fg rounded p-sm border border-border focus-ring text-body-sm"
        placeholder="Observações (opcional)"
        value={obs}
        onChange={e => setObs(e.target.value)}
        rows={2}
        disabled={saving}
      />

      <button
        onClick={tryAncorar}
        disabled={saving}
        className="w-full flex items-center justify-center gap-sm px-md py-sm rounded bg-tom text-white font-semibold disabled:opacity-50 focus-ring"
      >
        <Anchor size={16} />
        {ancorado ? 'Atualizar âncora' : 'Ancorar checkpoint'}
      </button>

      {showModal && (
        <JustificativaModal
          nota={nota}
          onCancel={() => setShowModal(false)}
          onConfirm={j => handleAncorar(j)}
        />
      )}
    </div>
  );
}

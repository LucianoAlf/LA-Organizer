import { useState } from 'react';

interface Props {
  nota: number;
  onConfirm: (justificativa: string) => void;
  onCancel: () => void;
}

export function JustificativaModal({ nota, onConfirm, onCancel }: Props) {
  const [txt, setTxt] = useState('');
  const valid = txt.trim().length >= 20;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-md">
      <div className="bg-bg-surface rounded-lg p-md max-w-md w-full space-y-md">
        <h2 className="font-semibold text-fg text-lg">Nota abaixo do mínimo</h2>
        <p className="text-body-sm text-fg-muted">
          A nota <strong>{nota.toFixed(1)}</strong> está abaixo de 7,0. Pra ancorar mesmo assim,
          descreva a justificativa (mínimo 20 caracteres):
        </p>
        <textarea
          className="w-full bg-bg-app text-fg rounded p-sm border border-border focus-ring min-h-[100px]"
          placeholder="Ex: estagiário demonstrou avanço suficiente em outros aspectos..."
          value={txt}
          onChange={e => setTxt(e.target.value)}
        />
        <div className="flex gap-sm justify-end">
          <button onClick={onCancel} className="px-md py-sm rounded text-fg-muted hover:bg-bg-app focus-ring">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(txt.trim())}
            disabled={!valid}
            className="px-md py-sm rounded bg-tom text-white font-semibold disabled:opacity-50 focus-ring"
          >
            Ancorar mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}

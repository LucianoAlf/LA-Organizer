import { BottomSheet } from '../../../components/BottomSheet';
import type { TipoCheckpoint, TipoMarco } from '../../../lib/lajourney-types';

interface Props {
  open: boolean;
  onClose: () => void;
  tipoCheckpoint: TipoCheckpoint;
  jaTemConsolidacao: boolean;
  onAdd: (tipo: TipoMarco) => void;
}

export function AddMarcoSheet({ open, onClose, tipoCheckpoint, jaTemConsolidacao, onAdd }: Props) {
  const opcoes: Array<{ tipo: TipoMarco; label: string; descricao: string }> = [];
  if (tipoCheckpoint === 'musicalizacao') {
    opcoes.push({
      tipo: 'ancoragem_radial',
      label: 'Marco de Ancoragem Radial',
      descricao: 'Novo marco com 4 campos: conquista musical, manifestação, vivências, recursos.',
    });
  } else {
    opcoes.push({
      tipo: 'aprendizado',
      label: 'Marco de Aprendizado',
      descricao: 'Tema/foco + 4 eixos de ancoragem + evidência + música desafio.',
    });
    if (!jaTemConsolidacao) {
      opcoes.push({
        tipo: 'consolidacao',
        label: 'Marco de Consolidação',
        descricao: 'Polimento e recital. Apenas 1 por checkpoint.',
      });
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Adicionar marco">
      <div className="space-y-sm pb-md">
        {opcoes.map(o => (
          <button
            key={o.tipo}
            type="button"
            onClick={() => { onAdd(o.tipo); onClose(); }}
            className="w-full bg-bg-surface border border-border rounded-md p-md text-left hover:border-tom transition"
          >
            <div className="font-semibold text-fg mb-1">{o.label}</div>
            <div className="text-body-sm text-fg-muted">{o.descricao}</div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

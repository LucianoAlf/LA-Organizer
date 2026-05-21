import { useAccess } from '../../../hooks/useAccess';
import { useIsProfessor } from '../../../hooks/useIsProfessor';
import type { ReportInventarioItem } from '../../../lib/lareport-types';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';

interface Props {
  item: ReportInventarioItem | null;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onMover: () => void;
  onManutencao: () => void;
  onBaixa: () => void;
}

export function ItemAcoesMenu({ item, open, onClose, onEdit, onMover, onManutencao, onBaixa }: Props) {
  const invAccess = useAccess('inventario');
  const movAccess = useAccess('movimentacoes');
  const isProf = useIsProfessor();
  if (!item) return null;

  const podeEditar = invAccess.allowed && !isProf;
  const podeMover = movAccess.allowed && !isProf;
  const podeBaixa = invAccess.allowed && !isProf;
  const podeManut = invAccess.allowed;

  return (
    <AdaptiveSheet open={open} onClose={onClose} size="sm">
      <div className="space-y-2">
        <div className="text-[11px] text-fg-muted text-center mb-2">{item.nome}</div>
        {podeEditar && <button onClick={onEdit} className="w-full text-left p-sm rounded-md hover:bg-bg-app">✏️ Editar</button>}
        {podeMover && <button onClick={onMover} className="w-full text-left p-sm rounded-md hover:bg-bg-app">↔️ Mover de sala</button>}
        {podeManut && <button onClick={onManutencao} className="w-full text-left p-sm rounded-md hover:bg-bg-app">🔧 Registrar manutenção</button>}
        {podeBaixa && <button onClick={onBaixa} className="w-full text-left p-sm rounded-md hover:bg-bg-app text-danger">🗑️ Dar baixa</button>}
        <button onClick={onClose} className="w-full text-left p-sm rounded-md hover:bg-bg-app text-fg-muted">❌ Cancelar</button>
      </div>
    </AdaptiveSheet>
  );
}

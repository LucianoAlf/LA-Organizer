import { useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { LoadingState } from '../../../components/LoadingState';
import { EmptyState } from '../../../components/EmptyState';
import { Badge } from '../../../components/Badge';
import { ItemCard } from './ItemCard';
import { ItemAcoesMenu } from './ItemAcoesMenu';
import { ItemSheet } from './ItemSheet';
import { MoverItemSheet } from './MoverItemSheet';
import { ManutencaoSheet } from './ManutencaoSheet';
import { BaixaConfirmSheet } from './BaixaConfirmSheet';
import { useInventarioItensPorStatus } from '../../../hooks/useInventarioItensPorStatus';
import { useInventarioMutations } from '../../../hooks/useInventarioMutations';
import { statusRevisao, type InventarioStatusTipo } from '../../../lib/inventario-status';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean;
  onClose: () => void;
  tipo: InventarioStatusTipo | null;
  unidadeId?: string;
}

const TITULOS: Record<InventarioStatusTipo, string> = {
  atencao: 'Itens em atenção',
  manutencao: 'Em manutenção',
};

export function ItemListSheet({ open, onClose, tipo, unidadeId }: Props) {
  const { data: itens = [], isLoading } = useInventarioItensPorStatus(unidadeId, open ? tipo : null);
  const m = useInventarioMutations();
  const [acoesItem, setAcoesItem] = useState<ReportInventarioItem | null>(null);
  const [editItem, setEditItem] = useState<ReportInventarioItem | null>(null);
  const [moverItemSt, setMoverItemSt] = useState<ReportInventarioItem | null>(null);
  const [manutItem, setManutItem] = useState<ReportInventarioItem | null>(null);
  const [baixaItem, setBaixaItem] = useState<ReportInventarioItem | null>(null);

  return (
    <>
      <AdaptiveSheet open={open} onClose={onClose} title={tipo ? TITULOS[tipo] : ''} size="md">
        {isLoading ? (
          <LoadingState />
        ) : itens.length === 0 ? (
          <EmptyState icon={<span>✅</span>} title="Nada por aqui" description="Nenhum item neste grupo agora." />
        ) : (
          <div className="space-y-2">
            {itens.map((item) => {
              const rev = tipo === 'atencao' ? statusRevisao(item.proxima_revisao) : null;
              return (
                <button key={item.id} type="button" onClick={() => setAcoesItem(item)} className="w-full text-left">
                  {rev && (
                    <div className="mb-1">
                      <Badge tone={rev.tom}>🔧 {rev.texto}</Badge>
                    </div>
                  )}
                  <ItemCard item={item} />
                </button>
              );
            })}
          </div>
        )}
      </AdaptiveSheet>

      <ItemAcoesMenu
        open={!!acoesItem}
        item={acoesItem}
        onClose={() => setAcoesItem(null)}
        onEdit={() => { setEditItem(acoesItem); setAcoesItem(null); }}
        onMover={() => { setMoverItemSt(acoesItem); setAcoesItem(null); }}
        onManutencao={() => { setManutItem(acoesItem); setAcoesItem(null); }}
        onBaixa={() => { setBaixaItem(acoesItem); setAcoesItem(null); }}
      />
      <ItemSheet
        open={!!editItem}
        onClose={() => setEditItem(null)}
        item={editItem}
        onSubmit={async (p) => { if (editItem) await m.update.mutateAsync({ id: editItem.id, payload: p }); }}
      />
      {moverItemSt && (
        <MoverItemSheet
          open
          onClose={() => setMoverItemSt(null)}
          item={moverItemSt}
          onSubmit={async (dest, motivo) => { await m.mover.mutateAsync({ id: moverItemSt.id, sala_destino_id: dest, motivo }); }}
        />
      )}
      {manutItem && (
        <ManutencaoSheet
          open
          onClose={() => setManutItem(null)}
          item={manutItem}
          onSubmit={async (p) => { await m.manutencao.mutateAsync({ id: manutItem.id, payload: p }); }}
        />
      )}
      {baixaItem && (
        <BaixaConfirmSheet
          open
          onClose={() => setBaixaItem(null)}
          item={baixaItem}
          onConfirm={async () => { await m.remove.mutateAsync(baixaItem.id); }}
        />
      )}
    </>
  );
}

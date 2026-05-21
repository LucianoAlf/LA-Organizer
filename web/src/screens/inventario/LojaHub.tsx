import { useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Fab } from '../../components/Fab';
import { LoadingState } from '../../components/LoadingState';
import { UnidadeChip } from '../../components/UnidadeChip';
import { HubCard } from '../../components/HubCard';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { useReportLoja, useHistoricoVendas, useReservas } from '../../hooks/useLaReport';
import { VendaWizardSheet } from './components/VendaWizardSheet';
import { EntradaRicaSheet } from './components/EntradaRicaSheet';
import { ProdutoFormSheet } from './components/ProdutoFormSheet';
import { TransferenciaSheet } from './components/TransferenciaSheet';
import { ReservaSheet } from './components/ReservaSheet';

export function LojaHub() {
  const navigate = useNavigate();
  const { unidadeId, isLoading: lU } = useUnidadeSelecionada();
  const { data: produtos = [] } = useReportLoja(unidadeId || null);
  const { data: vendas30 = [] } = useHistoricoVendas(unidadeId || null, { dias: 30, status: 'todas' });
  const { data: reservasAtivas = [] } = useReservas(unidadeId || null, 'ativa');

  const [vendaOpen, setVendaOpen] = useState(false);
  const [entradaOpen, setEntradaOpen] = useState(false);
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [reservaOpen, setReservaOpen] = useState(false);

  const baixos = useMemo(() => produtos.filter(p => p.abaixo_minimo || p.zerado), [produtos]);
  const totalUnidades = useMemo(() => produtos.reduce((s, p) => s + p.estoque_atual, 0), [produtos]);
  const valorEstoque = useMemo(
    () => produtos.reduce((s, p) => s + p.estoque_atual * (p.custo ?? 0), 0),
    [produtos]
  );
  const ativas = vendas30.filter(v => v.status === 'ativa');
  const totalFaturado = ativas.reduce((s, v) => s + Number(v.total ?? 0), 0);
  const estornadas = vendas30.length - ativas.length;
  const venceHoje = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 10);
    return reservasAtivas.filter(r => r.prazo === hoje).length;
  }, [reservasAtivas]);

  if (lU) return <LoadingState />;

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="🛍 Lojinha" backTo="/mais" />
        <UnidadeChip />
      </div>

      {baixos.length > 0 && (
        <div className="bg-warning/10 border border-warning/40 border-l-4 rounded-md p-md text-body-sm">
          ⚠️ <strong className="text-warning">{baixos.length} produto{baixos.length > 1 ? 's' : ''} abaixo do estoque mínimo nesta unidade.</strong>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Acessos rápidos</h3>
        <HubCard
          icon="📦"
          title="Produtos"
          meta={<><strong className="text-fg">{produtos.length} ativos</strong> · R${valorEstoque.toFixed(0)} estoque{baixos.length > 0 ? ` · ${baixos.length} atenção` : ''}</>}
          onClick={() => navigate(`/inventario/loja/produtos?unit=${unidadeId}`)}
        />
        <HubCard
          icon="📊"
          title="Histórico"
          meta={<><strong className="text-fg">{ativas.length} vendas</strong> · R${totalFaturado.toFixed(0)} (30d){estornadas > 0 ? ` · ${estornadas} estornada${estornadas > 1 ? 's' : ''}` : ''}</>}
          onClick={() => navigate(`/inventario/loja/historico?unit=${unidadeId}`)}
        />
        <HubCard
          icon="🔖"
          title="Reservas"
          meta={<><strong className="text-fg">{reservasAtivas.length} ativa{reservasAtivas.length !== 1 ? 's' : ''}</strong> · {venceHoje} vence hoje</>}
          onClick={() => navigate(`/inventario/loja/reservas?unit=${unidadeId}`)}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Resumo da unidade</h3>
        <div className="bg-bg-surface border border-border rounded-2xl p-md flex gap-md">
          <div className="flex-1">
            <div className="text-h2 font-bold">{totalUnidades}</div>
            <div className="text-[10px] text-fg-muted uppercase tracking-wide mt-1">Unidades em estoque</div>
          </div>
          <div className="flex-1">
            <div className="text-h2 font-bold text-tom">R${totalFaturado.toFixed(0)}</div>
            <div className="text-[10px] text-fg-muted uppercase tracking-wide mt-1">Vendas (30d)</div>
          </div>
        </div>
      </div>

      <Fab
        label="Novo"
        ariaLabel="Nova operação na lojinha"
        actions={[
          { icon: '💰', label: 'Registrar venda', onClick: () => setVendaOpen(true) },
          { icon: '📦', label: 'Lançar entrada', onClick: () => setEntradaOpen(true) },
          { icon: '🆕', label: 'Cadastrar produto', onClick: () => setProdutoOpen(true) },
          { icon: '🔄', label: 'Transferir estoque', onClick: () => setTransferOpen(true) },
          { icon: '🔖', label: 'Criar reserva', onClick: () => setReservaOpen(true) },
        ]}
      />

      {unidadeId && (
        <>
          <VendaWizardSheet open={vendaOpen} onClose={() => setVendaOpen(false)} unidadeId={unidadeId} />
          <EntradaRicaSheet open={entradaOpen} onClose={() => setEntradaOpen(false)} unidadeId={unidadeId} />
          <ProdutoFormSheet open={produtoOpen} onClose={() => setProdutoOpen(false)} mode="create" unidadeId={unidadeId} />
          <TransferenciaSheet open={transferOpen} onClose={() => setTransferOpen(false)} unidadeOrigem={unidadeId} />
          <ReservaSheet open={reservaOpen} onClose={() => setReservaOpen(false)} unidadeId={unidadeId} />
        </>
      )}
    </div>
  );
}

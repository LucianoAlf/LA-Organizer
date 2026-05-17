import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/Badge';
import { useReportSalaDetalhe } from '../../hooks/useLaReport';
import { ItemCard } from './components/ItemCard';
import { iconeParaTipoSala } from '../../lib/lareport-types';

type AbaSala = 'itens' | 'movimentacoes' | 'manutencao';

export function InventarioSalaPage() {
  const { salaId } = useParams<{ salaId: string }>();
  const id = salaId ? parseInt(salaId, 10) : null;
  const { data, isLoading } = useReportSalaDetalhe(id);
  const [aba, setAba] = useState<AbaSala>('itens');
  const [categoriaFilter, setCategoriaFilter] = useState<string | 'all'>('all');

  const categorias = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const i of data.itens) if (i.categoria) set.add(i.categoria);
    return Array.from(set);
  }, [data]);

  // Funde a lista de recursos declarados (array salas.recursos) com itens catalogados
  // (tabela inventario). Recursos sem correspondência viram cards "leves" com badge
  // "não catalogado" — convidando o Rafinha a catalogar via TOM.
  const itensCombinados = useMemo(() => {
    if (!data) return [];
    const itensCat = (categoriaFilter === 'all'
      ? data.itens
      : data.itens.filter(i => i.categoria === categoriaFilter)
    ).map(i => ({ tipo: 'catalogado' as const, item: i }));

    if (categoriaFilter !== 'all') return itensCat;  // recursos não têm categoria

    const recursos = data.sala.recursos ?? [];
    const nomesCatalogados = new Set(data.itens.map(i => i.nome.trim().toLowerCase()));
    const recursosSemMatch = recursos
      .filter(r => !nomesCatalogados.has(r.trim().toLowerCase()))
      .map(r => ({ tipo: 'recurso' as const, nome: r }));

    return [...itensCat, ...recursosSemMatch];
  }, [data, categoriaFilter]);

  if (isLoading || !data) return <LoadingState />;

  const sala = data.sala;
  const unidadeNome = sala.unidades?.nome ?? '';

  return (
    <div className="space-y-md pb-xl">
      <PageHeader
        title={sala.nome}
        subtitle={`${unidadeNome ? unidadeNome + ' · ' : ''}${sala.tipo_sala || 'Multiuso'}`}
        backTo="/inventario"
      />

      <div className="bg-bg-surface rounded-lg border border-border p-md">
        <div className="flex items-center gap-sm">
          <div className="w-12 h-12 rounded-lg bg-success/10 text-success flex items-center justify-center text-2xl">
            {iconeParaTipoSala(sala.tipo_sala)}
          </div>
          <div>
            <div className="font-bold text-xl uppercase tracking-wide">{sala.nome}</div>
            <div className="text-[11px] text-fg-muted">
              {sala.tipo_sala || 'Multiuso'}
              {sala.capacidade_maxima ? ` · Capacidade: ${sala.capacidade_maxima} alunos` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        {[
          { id: 'itens' as AbaSala, label: `Itens (${(() => {
            const nomesCat = new Set(data.itens.map(i => i.nome.trim().toLowerCase()));
            const recursosSemMatch = (data.sala.recursos ?? []).filter(r => !nomesCat.has(r.trim().toLowerCase())).length;
            return data.itens.length + recursosSemMatch;
          })()})` },
          { id: 'movimentacoes' as AbaSala, label: `Movimentações (${data.movimentacoes.length})` },
          { id: 'manutencao' as AbaSala, label: `Manutenção (${data.manutencoes.length})` },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAba(t.id)}
            className={`flex-1 py-1.5 px-2 text-[11px] font-semibold rounded-md border ${
              aba === t.id ? 'bg-fg text-bg-surface border-fg' : 'bg-bg-surface border-border text-fg-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'itens' && (
        <>
          {categorias.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setCategoriaFilter('all')}
                className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${
                  categoriaFilter === 'all' ? 'bg-tom text-black' : 'bg-bg-surface border border-border text-fg-muted'
                }`}
              >Todas</button>
              {categorias.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoriaFilter(c)}
                  className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${
                    categoriaFilter === c ? 'bg-tom text-black' : 'bg-bg-surface border border-border text-fg-muted'
                  }`}
                >
                  {c} ({data.itens.filter(i => i.categoria === c).length})
                </button>
              ))}
            </div>
          )}
          {itensCombinados.length === 0 ? (
            <EmptyState icon={<span>📭</span>} title="Sem itens" description="Nenhum item nesta sala — nem recursos declarados, nem patrimônio catalogado." />
          ) : (
            <div className="space-y-2">
              {itensCombinados.map((entry, idx) => entry.tipo === 'catalogado' ? (
                <ItemCard key={`cat-${entry.item.id}`} item={entry.item} />
              ) : (
                <div key={`rec-${idx}`} className="bg-bg-surface/60 rounded-lg border border-dashed border-border p-sm flex items-center gap-sm">
                  <div className="w-14 h-14 rounded-md bg-bg-app/50 flex items-center justify-center text-2xl flex-shrink-0">
                    📦
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-fg truncate">{entry.nome}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Declarado na sala — sem dados de patrimônio (NF, valor, condição)
                    </div>
                    <div className="mt-1">
                      <Badge tone="neutral">não catalogado</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {aba === 'movimentacoes' && (
        data.movimentacoes.length === 0 ? (
          <EmptyState icon={<span>↔️</span>} title="Sem movimentações" description="Nenhuma entrada/saída/transferência registrada." />
        ) : (
          <div className="space-y-2">
            {data.movimentacoes.map(m => (
              <div key={m.id} className="bg-bg-surface rounded-lg border border-border p-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-fg">
                    {m.inventario?.nome ?? `Item ${m.item_id}`}
                  </span>
                  <Badge tone="neutral">{m.tipo}</Badge>
                </div>
                {m.motivo && <div className="text-body-sm text-fg-muted">{m.motivo}</div>}
                <div className="text-[10px] text-fg-muted mt-1">
                  {new Date(m.data_movimentacao).toLocaleString('pt-BR')}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {aba === 'manutencao' && (
        data.manutencoes.length === 0 ? (
          <EmptyState icon={<span>🔧</span>} title="Sem manutenções" description="Nenhuma manutenção registrada para itens desta sala." />
        ) : (
          <div className="space-y-2">
            {data.manutencoes.map(m => (
              <div key={m.id} className="bg-bg-surface rounded-lg border border-border p-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-fg">
                    {m.inventario?.nome ?? `Item ${m.item_id}`}
                  </span>
                  <Badge tone="warning">{m.tipo}</Badge>
                </div>
                <div className="text-body-sm text-fg-muted">{m.descricao}</div>
                <div className="text-[10px] text-fg-muted mt-1">
                  {new Date(m.data_manutencao).toLocaleDateString('pt-BR')}
                  {m.custo ? ` · R$${m.custo}` : ''}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <div className="bg-warning/10 border border-warning/40 rounded-md p-md text-body-sm text-fg-muted">
        💡 <strong className="text-fg">Pra adicionar item:</strong> escreve no WhatsApp do TOM tipo "comprei [item] pra sala {sala.nome} {unidadeNome}". Ou use <code className="bg-bg-surface px-1 rounded">/inv add</code>.
      </div>
    </div>
  );
}

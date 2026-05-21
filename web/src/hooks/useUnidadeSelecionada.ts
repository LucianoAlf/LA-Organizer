import { useSearchParams } from 'react-router-dom';
import { useReportUnidades } from './useLaReport';
import { useEffect } from 'react';

export function useUnidadeSelecionada() {
  const [params, setParams] = useSearchParams();
  const { data: unidades = [], isLoading } = useReportUnidades();
  const unidadeId = params.get('unit') || '';

  useEffect(() => {
    if (!isLoading && !unidadeId && unidades.length > 0) {
      const barra = unidades.find(u => u.nome === 'Barra');
      const next = barra?.id || unidades[0].id;
      setParams(p => { p.set('unit', next); return p; }, { replace: true });
    }
  }, [isLoading, unidadeId, unidades, setParams]);

  const unidade = unidades.find(u => u.id === unidadeId) ?? null;
  function setUnidade(id: string) {
    setParams(p => { p.set('unit', id); return p; }, { replace: true });
  }
  return { unidadeId, unidade, unidades, setUnidade, isLoading };
}

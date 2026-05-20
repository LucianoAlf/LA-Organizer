// Sprint Fase 2.1 — Autocomplete de professor indicador para Lojinha
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buscarProfessor } from '../lib/lareport-mutations';
import type { ProfessorSearchResult } from '../lib/lareport-mutations';

interface Props {
  unidadeId?: string | null;
  value: ProfessorSearchResult | null;
  onChange: (professor: ProfessorSearchResult | null) => void;
  placeholder?: string;
}

export function ProfessorAutocomplete({ unidadeId, value, onChange, placeholder }: Props) {
  const [termo, setTermo] = useState('');
  const [debouncedTermo, setDebouncedTermo] = useState('');
  const [showList, setShowList] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce 200ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedTermo(termo), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [termo]);

  const { data: resultados = [], isFetching } = useQuery({
    queryKey: ['buscar-professor', debouncedTermo, unidadeId],
    queryFn: () => buscarProfessor(debouncedTermo, unidadeId),
    enabled: debouncedTermo.length >= 2,
    staleTime: 30_000,
  });

  // Se já tem professor selecionado, mostra card com botão Trocar
  if (value) {
    return (
      <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-md px-3 py-2">
        <div>
          <p className="text-body-md font-semibold text-fg">{value.nome}</p>
          {value.telefone && (
            <p className="text-body-sm text-fg-muted">{value.telefone}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { onChange(null); setTermo(''); setShowList(false); }}
          className="text-body-sm text-tom underline ml-4 shrink-0"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={termo}
        onChange={e => { setTermo(e.target.value); setShowList(true); }}
        onFocus={() => setShowList(true)}
        onBlur={() => setTimeout(() => setShowList(false), 150)}
        placeholder={placeholder ?? 'Buscar professor indicador…'}
        className="w-full h-11 px-3 bg-bg-elevated border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors"
      />

      {showList && debouncedTermo.length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-surface border border-border rounded-md shadow-soft max-h-48 overflow-y-auto">
          {isFetching && (
            <div className="px-3 py-2 text-body-sm text-fg-muted">Buscando…</div>
          )}
          {!isFetching && resultados.length === 0 && (
            <div className="px-3 py-2 text-body-sm text-fg-muted">Nenhum resultado</div>
          )}
          {resultados.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => { onChange(p); setTermo(''); setShowList(false); }}
              className="w-full text-left px-3 py-2 hover:bg-bg-elevated transition-colors border-b border-border/50 last:border-0"
            >
              <p className="text-body-md font-semibold text-fg">{p.nome}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';

export interface AgendaFilters {
  trabalho: boolean;
  pessoal: boolean;
  delegadas: boolean;
}

const STORAGE_KEY = 'agenda.filters';
const DEFAULTS: AgendaFilters = { trabalho: true, pessoal: true, delegadas: true };

function load(): AgendaFilters {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return DEFAULTS; }
}

export function useAgendaFilters() {
  const [filters, setFilters] = useState<AgendaFilters>(load);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch {}
  }, [filters]);
  const toggle = useCallback((k: keyof AgendaFilters) =>
    setFilters(f => ({ ...f, [k]: !f[k] })), []);
  return { filters, toggle, setFilters };
}

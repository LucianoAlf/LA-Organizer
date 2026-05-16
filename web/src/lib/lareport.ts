// Cliente HTTP para os endpoints /internal/lareport/* do TOM.
// IMPORTANTE: não importa @supabase/supabase-js — o PWA NÃO tem credenciais do LA Report.

import type {
  ReportUnidade, ReportSala, ReportSalaDetalhe, ReportProduto, ReportAlertas,
} from './lareport-types';

const INTERNAL_API_BASE = import.meta.env.VITE_TOM_INTERNAL_BASE || 'https://tom.la-organizer.com';
const INTERNAL_API_SECRET = import.meta.env.VITE_TOM_INTERNAL_SECRET || '';

async function call<T>(path: string): Promise<T> {
  const res = await fetch(`${INTERNAL_API_BASE}${path}`, {
    headers: { 'X-Internal-Secret': INTERNAL_API_SECRET },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`internal-api ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'erro_desconhecido');
  return json.data as T;
}

export async function fetchReportUnidades(): Promise<ReportUnidade[]> {
  return call<ReportUnidade[]>('/internal/lareport/unidades');
}

export async function fetchReportSalas(unidadeId: string): Promise<ReportSala[]> {
  return call<ReportSala[]>(`/internal/lareport/salas?unit=${encodeURIComponent(unidadeId)}`);
}

export async function fetchReportSalaDetalhe(salaId: number): Promise<ReportSalaDetalhe> {
  return call<ReportSalaDetalhe>(`/internal/lareport/sala/${salaId}`);
}

export async function fetchReportLoja(unidadeId: string): Promise<ReportProduto[]> {
  return call<ReportProduto[]>(`/internal/lareport/loja?unit=${encodeURIComponent(unidadeId)}`);
}

export async function fetchReportAlertas(unidadeId?: string): Promise<ReportAlertas> {
  const q = unidadeId ? `?unit=${encodeURIComponent(unidadeId)}` : '';
  return call<ReportAlertas>(`/internal/lareport/alertas${q}`);
}

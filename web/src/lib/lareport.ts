// Cliente HTTP para os endpoints /internal/lareport/* do TOM.
//
// Usa as MESMAS env vars que o resto da PWA (tomEngine.ts):
//   - VITE_TOM_API_BASE     (vazio em prod → caminho relativo; vercel.json
//                            rewrita /internal/* server-side pro VPS)
//   - VITE_INTERNAL_API_SECRET (em bundle — tech debt aceito Sprint 8,
//                            documentado em tomEngine.ts)
//
// Header lowercase 'x-internal-secret' (HTTP é case-insensitive, mas
// alinhamos com o padrão do projeto).

import type {
  ReportUnidade, ReportSala, ReportSalaDetalhe, ReportProduto, ReportAlertas,
} from './lareport-types';

const TOM_BASE = import.meta.env.VITE_TOM_API_BASE || '';
const INTERNAL_SECRET = import.meta.env.VITE_INTERNAL_API_SECRET || '';

async function call<T>(path: string): Promise<T> {
  if (!INTERNAL_SECRET) {
    throw new Error('VITE_INTERNAL_API_SECRET ausente — configurar no Vercel ou .env');
  }
  const res = await fetch(`${TOM_BASE}${path}`, {
    headers: { 'x-internal-secret': INTERNAL_SECRET },
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

// Cliente HTTP para os endpoints /api/lareport/* (Vercel Serverless Proxy).
//
// Arquitetura:
//   Browser → /api/lareport/<endpoint>   (same-origin, Authorization: Bearer <supabase_jwt>)
//          ↓
//   Vercel Serverless (web/api/lareport/[...path].ts):
//     - valida JWT via supabase.auth.getUser
//     - checa role do collaborator
//     - injeta x-internal-secret SERVER-SIDE
//          ↓
//   TOM internal-api → LA Report Supabase (cross-project)
//
// Por que NÃO seguir o padrão de tomEngine.ts (secret em bundle):
//   tomEngine usa secret em bundle como tech debt aceito Sprint 8. Pra LA
//   Report a operação é cross-project — vale o esforço extra de proxy
//   pra manter o secret 100% server-side.

import { supabase } from './supabase';
import type {
  ReportUnidade, ReportSala, ReportSalaDetalhe, ReportProduto, ReportAlertas,
} from './lareport-types';

async function call<T>(path: string): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) {
    throw new Error('Não autenticado — faça login pra acessar o LA Report.');
  }
  const res = await fetch(`/api/lareport/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/api/lareport/${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'erro_desconhecido');
  return json.data as T;
}

export async function fetchReportUnidades(): Promise<ReportUnidade[]> {
  return call<ReportUnidade[]>('unidades');
}

export async function fetchReportSalas(unidadeId: string): Promise<ReportSala[]> {
  return call<ReportSala[]>(`salas?unit=${encodeURIComponent(unidadeId)}`);
}

export async function fetchReportSalaDetalhe(salaId: number): Promise<ReportSalaDetalhe> {
  return call<ReportSalaDetalhe>(`sala/${salaId}`);
}

export async function fetchReportLoja(unidadeId: string): Promise<ReportProduto[]> {
  return call<ReportProduto[]>(`loja?unit=${encodeURIComponent(unidadeId)}`);
}

export async function fetchReportAlertas(unidadeId?: string): Promise<ReportAlertas> {
  const q = unidadeId ? `?unit=${encodeURIComponent(unidadeId)}` : '';
  return call<ReportAlertas>(`alertas${q}`);
}

// _remote/web/src/lib/lareport-mutations.ts
// Wrappers fetch para os endpoints serverless /api/lareport/*
import { supabase } from './supabase';

async function authHeader() {
  const { data: sess } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${sess.session?.access_token ?? ''}` };
}

export async function uploadFoto(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
  const res = await fetch('/api/lareport/upload', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, filename: file.name }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.detail || j.error || `Upload falhou: ${res.status}`);
  }
  const j = await res.json();
  return j.url as string;
}

export async function createItem(payload: any): Promise<any> {
  const res = await fetch('/api/lareport/inventario', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return (await res.json()).data;
}

export async function updateItem(id: number, payload: any): Promise<any> {
  const res = await fetch(`/api/lareport/inventario/${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return (await res.json()).data;
}

export async function deleteItem(id: number): Promise<void> {
  const res = await fetch(`/api/lareport/inventario/${id}`, { method: 'DELETE', headers: await authHeader() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
}

export async function moverItem(id: number, payload: { sala_destino_id: number; motivo?: string }): Promise<any> {
  const res = await fetch(`/api/lareport/inventario-mover/${id}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return (await res.json()).data;
}

export async function registrarManutencao(id: number, payload: { tipo: string; descricao: string; custo?: number; data_manutencao: string; responsavel?: string; fornecedor_servico?: string; data_proxima_revisao?: string }): Promise<any> {
  const res = await fetch(`/api/lareport/inventario-manutencao/${id}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return (await res.json()).data;
}

// ============================================================
// Sprint Fase B — Lojinha bidirecional
// ============================================================

// Helper interno: chamada autenticada aos endpoints /api/lareport/*
// Reutiliza authHeader() já definida acima.
async function callApi<T>(path: string, init: RequestInit): Promise<T> {
  const headers = await authHeader();
  const r = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...headers,
      'Content-Type': 'application/json',
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    let msg = txt;
    try { msg = JSON.parse(txt).error || txt; } catch {}
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export interface VendaInput {
  produto_id: number;
  unidade_id: string;
  quantidade: number;
  forma_pagamento: 'pix' | 'credito' | 'debito' | 'dinheiro';
  variacao_id?: number | null;
  tipo_cliente?: 'aluno' | 'avulso' | 'colaborador';
  cliente_nome?: string | null;
  aluno_id?: number | null;
  professor_indicador_id?: number | null;
  desconto?: number;
  parcelas?: number;
  observacoes?: string | null;
}
export interface VendaResult {
  ok: boolean; venda_id: number; saldo_apos: number;
  comissao_farmer: number; comissao_professor: number;
}

export interface ProdutoSearchResult {
  id: number; nome: string; sku: string; preco: number;
  estoque: number; score: number;
}

export async function registrarVenda(input: VendaInput): Promise<VendaResult> {
  return callApi<VendaResult>('/api/lareport/loja/venda', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function registrarEntradaEstoque(input: {
  produto_id: number; unidade_id: string; quantidade: number;
  variacao_id?: number | null; observacoes?: string | null;
}): Promise<{ ok: boolean; saldo_apos: number }> {
  return callApi('/api/lareport/loja/entrada', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function ajustarEstoque(input: {
  produto_id: number; unidade_id: string; delta: number; motivo: string;
  variacao_id?: number | null;
}): Promise<{ ok: boolean; saldo_apos: number }> {
  return callApi('/api/lareport/loja/ajuste', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function buscarProduto(
  termo: string, unidade_id?: string | null
): Promise<ProdutoSearchResult[]> {
  const qs = new URLSearchParams({ termo });
  if (unidade_id) qs.set('unidade_id', unidade_id);
  const r = await callApi<{ ok: boolean; results: ProdutoSearchResult[] }>(
    `/api/lareport/loja/buscar?${qs}`, { method: 'GET' }
  );
  return r.results;
}

// _remote/web/src/lib/lareport-mutations.ts
// Wrappers fetch para os endpoints serverless /api/lareport/*
import { supabase } from './supabase';

async function authHeader() {
  const { data: sess } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${sess.session?.access_token ?? ''}` };
}

export async function uploadFoto(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/lareport/upload', { method: 'POST', headers: await authHeader(), body: form });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Upload falhou: ${res.status}`);
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
  const res = await fetch(`/api/lareport/inventario/${id}/mover`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return (await res.json()).data;
}

export async function registrarManutencao(id: number, payload: { tipo: string; descricao: string; custo?: number; data_manutencao: string; responsavel?: string; fornecedor_servico?: string; data_proxima_revisao?: string }): Promise<any> {
  const res = await fetch(`/api/lareport/inventario/${id}/manutencao`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return (await res.json()).data;
}

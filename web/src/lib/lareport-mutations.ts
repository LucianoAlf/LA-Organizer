// _remote/web/src/lib/lareport-mutations.ts
// Wrappers fetch para os endpoints serverless /api/lareport/*
import { supabase } from './supabase';
import { compressImage } from './compressImage';

async function authHeader() {
  let { data: { session } } = await supabase.auth.getSession();
  // Token de acesso vive ~1h. Se já venceu (ou vence em <60s), renova ANTES de
  // gravar — senão o PWA aberto por horas manda token morto e a escrita toma 401
  // silencioso (leitura usa cliente anon separado, por isso só a escrita sofria).
  const expMs = (session?.expires_at ?? 0) * 1000;
  if (!session || expMs < Date.now() + 60_000) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) session = data.session;
  }
  return { Authorization: `Bearer ${session?.access_token ?? ''}` };
}

/** Mensagem amigável p/ falhas de escrita — converte erro de sessão em instrução clara. */
export function writeErrorMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e || '');
  if (/no_auth|invalid_token|jwt|expired|\b401\b/i.test(m)) {
    return 'Sua sessão expirou. Recarregue a página (Ctrl+Shift+R) e tente de novo.';
  }
  return m || 'Erro ao salvar. Tente de novo.';
}

export async function uploadFoto(file: File): Promise<string> {
  // Comprime ANTES de virar base64 — evita o 413 (cap de ~4.5MB da serverless).
  const compressed = await compressImage(file);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(compressed);
  });
  const res = await fetch('/api/lareport/upload', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, filename: compressed.name }),
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

// ============================================================
// Sprint Fase 2.1 — Multi-item e busca de cliente/professor
// ============================================================

export interface VendaItem {
  produto_id: number;
  variacao_id?: number | null;
  quantidade: number;
  preco_unitario: number;
  desconto?: number;
  desconto_tipo?: 'valor' | 'percentual';
}

export interface VendaMultiInput {
  unidade_id: string;
  forma_pagamento: 'pix' | 'dinheiro' | 'debito' | 'credito' | 'folha' | 'saldo';
  itens: VendaItem[];
  tipo_cliente?: 'aluno' | 'avulso' | 'colaborador';
  aluno_id?: number | null;
  colaborador_id?: number | null;
  professor_indicador_id?: number | null;
  observacoes?: string | null;
  via_audit?: string | null;
  parcelas?: number | null;
}

export interface VendaMultiResult {
  ok: boolean;
  venda_id: number;
  saldo_apos: number;
  comissao_farmer: number;
  comissao_professor: number;
}

export interface EntradaItem {
  produto_id: number;
  variacao_id?: number | null;
  quantidade: number;
  preco_custo?: number | null;
}

export interface EntradaMultiInput {
  unidade_id: string;
  itens: EntradaItem[];
  fornecedor?: string | null;
  nota_fiscal?: string | null;
  nf?: string | null;
  observacao?: string | null;
}

export async function registrarVendaMulti(input: VendaMultiInput): Promise<VendaMultiResult> {
  return callApi<VendaMultiResult>('/api/lareport/loja/venda', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function registrarEntradaMulti(input: EntradaMultiInput): Promise<{ ok: boolean; data: unknown }> {
  return callApi('/api/lareport/loja/entrada', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export interface ClienteSearchResult {
  id: number;
  nome: string;
  telefone?: string | null;
  status?: string | null;
  cargo?: string | null;
  unidade_id?: string | null;
}

export async function buscarCliente(
  tipo: 'aluno' | 'colaborador',
  q: string,
  unidade_id?: string | null,
  limit = 10,
): Promise<ClienteSearchResult[]> {
  const qs = new URLSearchParams({ tipo, q, limit: String(limit) });
  if (unidade_id) qs.set('unidade_id', unidade_id);
  const r = await callApi<{ ok: boolean; results: ClienteSearchResult[] }>(
    `/api/lareport/loja/buscar-cliente?${qs}`, { method: 'GET' }
  );
  return r.results;
}

export interface ProfessorSearchResult {
  id: number;
  nome: string;
  telefone?: string | null;
  unidade_id?: string | null;
}

export async function buscarProfessor(
  q: string,
  unidade_id?: string | null,
  limit = 10,
): Promise<ProfessorSearchResult[]> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  if (unidade_id) qs.set('unidade_id', unidade_id);
  const r = await callApi<{ ok: boolean; results: ProfessorSearchResult[] }>(
    `/api/lareport/loja/buscar-professor?${qs}`, { method: 'GET' }
  );
  return r.results;
}

// ============================================================
// Sprint Fase 2.2 — CRUD produto + transferência
// ============================================================

export interface ProdutoUpsertInput {
  id?: number;
  nome: string;
  categoria_id: number;
  sku?: string | null;
  preco: number;
  custo?: number | null;
  estoque_minimo?: number;
  comissao_especial?: number | null;
  foto_url?: string | null;
  descricao?: string | null;
  disponivel_whatsapp?: boolean;
  ativo?: boolean;
}
export async function upsertProduto(input: ProdutoUpsertInput): Promise<{ ok: boolean; produto_id: number }> {
  return callApi('/api/lareport/loja/produto/upsert', { method: 'POST', body: JSON.stringify(input) });
}

export async function desativarProduto(id: number): Promise<{ ok: boolean }> {
  return callApi('/api/lareport/loja/produto/desativar', { method: 'POST', body: JSON.stringify({ id }) });
}

export interface ProdutoSimilarResult { id: number; nome: string; sku: string; preco: number; score: number; }
export async function buscarProdutoSimilar(nome: string, limit = 5): Promise<ProdutoSimilarResult[]> {
  const qs = new URLSearchParams({ nome, limit: String(limit) });
  const r = await callApi<{ ok: boolean; results: ProdutoSimilarResult[] }>(
    `/api/lareport/loja/produto/similar?${qs}`, { method: 'GET' }
  );
  return r.results;
}

export interface TransferenciaInput {
  produto_id: number;
  unidade_origem: string;
  unidade_destino: string;
  quantidade: number;
  motivo: string;
  variacao_id?: number | null;
}
export async function transferirEstoque(input: TransferenciaInput): Promise<{ ok: boolean; saldo_origem: number; saldo_destino: number }> {
  return callApi('/api/lareport/loja/transferencia', { method: 'POST', body: JSON.stringify(input) });
}

// ============================================================
// Sprint Fase 2.3 — Estorno e Reservas
// ============================================================

export async function estornarVenda(
  venda_id: number,
  motivo: string,
): Promise<{ ok: boolean; data: unknown }> {
  return callApi('/api/lareport/loja/estorno', {
    method: 'POST',
    body: JSON.stringify({ venda_id, motivo }),
  });
}

export interface ReservaInput {
  produto_id: number;
  variacao_id?: number | null;
  unidade_id: string;
  quantidade: number;
  cliente_nome: string;
  aluno_id?: number | null;
  observacoes?: string | null;
  /** YYYY-MM-DD ou ISO. Default: hoje + 7d (no backend). */
  prazo?: string | null;
}

export async function criarReserva(
  input: ReservaInput,
): Promise<{ ok: boolean; reserva_id: number; prazo: string }> {
  return callApi('/api/lareport/loja/reserva', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function cancelarReserva(
  reserva_id: number,
  motivo?: string,
): Promise<{ ok: boolean; reserva_id: number }> {
  return callApi('/api/lareport/loja/reserva/cancelar', {
    method: 'POST',
    body: JSON.stringify({ reserva_id, motivo }),
  });
}

export interface FinalizarReservaInput {
  reserva_id: number;
  forma_pagamento: 'pix' | 'dinheiro' | 'debito' | 'credito' | 'folha' | 'saldo';
  preco_unitario: number;
  tipo_cliente?: 'aluno' | 'avulso' | 'colaborador';
  desconto?: number;
  desconto_tipo?: 'valor' | 'percentual';
  professor_indicador_id?: number | null;
  colaborador_id?: number | null;
  observacoes?: string | null;
  parcelas?: number | null;
}

export async function finalizarReserva(
  input: FinalizarReservaInput,
): Promise<{ ok: boolean; venda_id: number }> {
  return callApi('/api/lareport/loja/reserva/finalizar', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ============================================================
// Pendências de Inventário
// ============================================================

export interface PendenciaInput {
  sala_id: number;
  unidade_id: string;
  titulo: string;
  descricao?: string | null;
  categoria?: 'compra' | 'reposicao' | 'reparo' | 'melhoria' | null;
  prioridade: 'urgente' | 'importante' | 'futuramente';
  solicitante?: string | null;
}

export interface PendenciaPatch {
  titulo?: string;
  descricao?: string | null;
  categoria?: 'compra' | 'reposicao' | 'reparo' | 'melhoria' | null;
  prioridade?: 'urgente' | 'importante' | 'futuramente';
  status?: 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';
  resolucao_obs?: string | null;
  item_vinculado_id?: number | null;
}

export async function criarPendencia(input: PendenciaInput): Promise<{ ok: boolean; data: any }> {
  return callApi('/api/lareport/inventario-pendencias', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function atualizarPendencia(id: number, patch: PendenciaPatch): Promise<{ ok: boolean; data: any }> {
  return callApi(`/api/lareport/inventario-pendencias?id=${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

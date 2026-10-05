// web/src/hooks/useTarefaAprovacao.ts — BOTAO-APROVAR-OPERACOES (05/10).
// Pergunta ao TOM se a espera é APROVAÇÃO pra executar ou CONFIRMAÇÃO de conclusão, e manda a
// decisão de aprovação pelo MESMO funil do WhatsApp. Vai com o LOGIN da pessoa (Bearer), igual ao
// usePixPainel — nunca o x-internal-secret.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ModoEspera } from '../lib/aprovacaoTarefa';

const TOM_BASE = import.meta.env.VITE_TOM_API_BASE || '';

async function bearer(): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('Sessão expirada — entre de novo.');
  return token;
}

async function buscarModo(taskId: string): Promise<ModoEspera | null> {
  const res = await fetch(`${TOM_BASE}/internal/tarefa-aprovacao?task_id=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${await bearer()}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(String(body?.error || `http_${res.status}`));
  return (body.modo as ModoEspera | null) ?? null;
}

export function useModoEspera(taskId: string | undefined, status: string | undefined) {
  return useQuery({
    queryKey: ['tarefa-aprovacao-modo', taskId, status],
    queryFn: () => buscarModo(taskId as string),
    enabled: Boolean(taskId) && status === 'awaiting_confirmation',
    staleTime: 30_000,
    retry: 1,
  });
}

const ERRO_PT: Record<string, string> = {
  ja_decidida: 'Essa demanda já foi decidida por outro caminho — atualizei a tela.',
  nao_e_aprovacao: 'Essa demanda espera confirmação de conclusão, não aprovação — atualizei a tela.',
  sem_permissao: 'Só diretoria e coordenação aprovam.',
  no_auth: 'Sessão expirada — entre de novo.',
  invalid_token: 'Sessão expirada — entre de novo.',
};

export interface DecisaoResultado { status: string; avisou: boolean; mensagem: string | null }

export async function decidirAprovacao(
  taskId: string,
  decisao: 'approve' | 'reject',
  motivo?: string | null,
): Promise<DecisaoResultado> {
  const res = await fetch(`${TOM_BASE}/internal/tarefa-aprovacao/decidir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await bearer()}` },
    body: JSON.stringify({ task_id: taskId, decisao, motivo: motivo && motivo.trim() ? motivo.trim() : null }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    const code = String(body?.error || `http_${res.status}`);
    throw new Error(ERRO_PT[code] || `Não consegui decidir agora (${code}).`);
  }
  return { status: String(body.status), avisou: !!body.avisou, mensagem: body.mensagem ?? null };
}

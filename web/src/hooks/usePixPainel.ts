// web/src/hooks/usePixPainel.ts — busca o painel "PIX automático" do grupo no TOM.
// Vai com o LOGIN da pessoa (Bearer): o TOM confere se ela pode ver o grupo antes de devolver
// nome de cliente. Recarrega a cada 5 min (a fonte do LA Report muda poucas vezes por dia).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { PixPainel, ResultadoPainel } from '../lib/pixPainel';

const TOM_BASE = import.meta.env.VITE_TOM_API_BASE || '';

async function buscarPixPainel(groupId: string): Promise<ResultadoPainel> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { tipo: 'erro', motivo: 'sem_login' };
  const res = await fetch(`${TOM_BASE}/internal/pix-painel?group_id=${encodeURIComponent(groupId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  if (res.status === 404 && body?.error === 'grupo_sem_unidade') return { tipo: 'sem_unidade' };
  if (!res.ok || !body?.ok) return { tipo: 'erro', motivo: String(body?.error || `http_${res.status}`) };
  return { tipo: 'ok', painel: body.data as PixPainel };
}

export function usePixPainel(groupId: string | undefined) {
  return useQuery({
    queryKey: ['pix-painel', groupId],
    queryFn: () => buscarPixPainel(groupId as string),
    enabled: Boolean(groupId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

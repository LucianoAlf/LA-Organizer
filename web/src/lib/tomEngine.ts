// Sprint 8 Etapa 4 — cliente do endpoint interno do engine TOM.
// Chamado pelo PWA após INSERT bem-sucedido em projects pra disparar
// bootstrap (project_members + checkpoint inicial + WhatsApps).
//
// Observação de segurança: VITE_INTERNAL_API_SECRET é exposto no bundle
// do cliente. Trade-off de Sprint 8 (dev). Produção idealmente migra pra
// validação do JWT do Supabase no engine.

// Default vazio = caminho relativo. Em produção (Vercel), vercel.json reescreve
// /internal/* pra http://89.116.73.186/internal/* server-side, evitando Mixed
// Content (HTTPS → HTTP). Em dev local, web/.env seta a base absoluta.
const TOM_BASE = import.meta.env.VITE_TOM_API_BASE || '';
const INTERNAL_SECRET = import.meta.env.VITE_INTERNAL_API_SECRET || '';

export type ProjectCreatedAck =
  | { ok: true; status: 'ok' | 'already_processed' }
  | { ok: false; reason: string };

export async function notifyProjectCreated(
  projectId: string,
  memberIds: string[] = [],
): Promise<ProjectCreatedAck> {
  if (!INTERNAL_SECRET) {
    console.warn('[tomEngine] VITE_INTERNAL_API_SECRET ausente — não vou notificar engine.');
    return { ok: false, reason: 'internal_secret_missing' };
  }

  // Sprint 9: engine gera etapas via LLM (~9-10s). PWA aguarda até 12s para
  // garantir checkpoints aparecem na próxima navegação.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const res = await fetch(`${TOM_BASE}/internal/project-created`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({ project_id: projectId, member_ids: memberIds }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(`[tomEngine] notify falhou: ${res.status} ${txt.slice(0, 200)}`);
      return { ok: false, reason: `http_${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as { status?: string } | null;
    const status = json?.status === 'already_processed' ? 'already_processed' : 'ok';
    return { ok: true, status };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[tomEngine] notify exception: ${msg}`);
    return { ok: false, reason: msg.includes('aborted') ? 'timeout' : msg };
  }
}

// Sprint 22.22p — notifica TOM pra mandar mensagem de celebracao no WhatsApp
// (checkpoint fechado: owner + coord; projeto 100%: time todo).
export async function notifyCelebration(
  type: 'checkpoint' | 'project',
  projectId: string,
  checkpointId?: string,
): Promise<void> {
  if (!INTERNAL_SECRET) return;
  try {
    await fetch(`${TOM_BASE}/internal/celebration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({ type, project_id: projectId, checkpoint_id: checkpointId ?? null }),
    });
  } catch (e) {
    // Fire-and-forget. Falha silenciosa pra nao bloquear UX da festa.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] celebration notify falhou: ${msg}`);
  }
}

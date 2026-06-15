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

// Sprint 22.34j — funções retornam resultado pra UI mostrar toast.
export type NotifyResult =
  | { ok: true; status: number; sent?: number }
  | { ok: false; reason: string };

// Sprint 22.33 — notifica TOM pra mandar WhatsApp pro assignee de uma task.
export async function notifyTaskDelegated(taskId: string): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/task-delegated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ task_id: taskId }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    return { ok: true, status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] task-delegated notify falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// Dashboard de time — botão "Cobrar agora": TOM dá um toque IMEDIATO no responsável da
// tarefa, em nome de quem clicou. sent=false quando não havia pra quem mandar (sem zap/inativo
// ou tarefa sem responsável); reason explica.
export type CobrarResult =
  | { ok: true; sent: boolean; reason?: string }
  | { ok: false; reason: string };

export async function cobrarTask(taskId: string, requesterId?: string | null): Promise<CobrarResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/task-cobrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ task_id: taskId, requester_id: requesterId ?? null }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const json = (await r.json().catch(() => null)) as { sent?: boolean; reason?: string } | null;
    return { ok: true, sent: Boolean(json?.sent), reason: json?.reason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] task-cobrar falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// Dashboard de time — status das cobranças por tarefa (já cobrado / quando / respondeu),
// pra UI mostrar o estado e não re-enviar às cegas. Degrada pra {} em qualquer erro.
export interface CobrancaTaskStatus { sentCount: number; lastSentAt: string | null; responded: boolean; }
export async function fetchCobrancaStatus(
  taskIds: string[],
  assigneeId?: string | null,
): Promise<Record<string, CobrancaTaskStatus>> {
  if (!INTERNAL_SECRET || taskIds.length === 0) return {};
  try {
    const r = await fetch(`${TOM_BASE}/internal/cobranca-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ task_ids: taskIds, assignee_id: assigneeId ?? null }),
    });
    if (!r.ok) return {};
    const json = (await r.json().catch(() => null)) as { statuses?: Record<string, CobrancaTaskStatus> } | null;
    return json?.statuses ?? {};
  } catch {
    return {};
  }
}

// Sprint 22.34m — notifica TOM pra avisar o assignee quando user reagenda/edita
// tarefa delegada. Backend so dispara se assigned_to !== created_by.
export async function notifyTaskUpdated(
  taskId: string,
  changeType: 'rescheduled' | 'edited' = 'edited',
): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/task-updated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ task_id: taskId, change_type: changeType }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const json = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, sent: typeof json.sent === 'number' ? json.sent : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] task-updated notify falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// Sprint 22.36 Fatia 6 — notifica TOM pra disparar celebração quando user fecha
// checklist em 100%. Backend manda 2 Zaps: pro próprio user (confete) e pro
// gerente da unidade (confirmação de fechamento). Idempotente via marker_logs.
export async function notifyChecklistCompleted(completionId: string): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/checklist-completed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ completion_id: completionId }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const json = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, sent: typeof json.sent === 'number' ? json.sent : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] checklist-completed notify falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// Sprint 22.33 — notifica TOM pra disparar WhatsApp pra cada participant de um
// evento (so participants com notified_at IS NULL — idempotente p/ edicao).
export async function notifyEventInvites(eventId: string): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/event-invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ event_id: eventId }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const json = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, sent: typeof json.sent === 'number' ? json.sent : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] event-invites notify falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// Notifica TOM quando projeto é aprovado via PWA — dispara WhatsApp pro criador.
export async function notifyProjectApproved(projectId: string): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/project-approved`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ projectId }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    return { ok: true, status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] project-approved notify falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// Notifica TOM quando projeto é rejeitado via PWA — dispara WhatsApp pro criador.
export async function notifyProjectRejected(projectId: string, reason?: string): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/project-rejected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ projectId, reason }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    return { ok: true, status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] project-rejected notify falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}

// web/src/lib/formatNote.ts — chama /internal/format-note (IA via CLI OAuth do TOM).
// Mesmo padrão dos outros /internal/* (VITE_TOM_API_BASE + x-internal-secret). Em prod o
// rewrite do vercel.json encaminha; em dev/preview o proxy do vite.config.
const TOM_BASE = import.meta.env.VITE_TOM_API_BASE || '';
const INTERNAL_SECRET = import.meta.env.VITE_INTERNAL_API_SECRET || '';

export type FormatAction = 'format' | 'summarize' | 'fix' | 'tone';

export async function formatNote(
  action: FormatAction,
  html: string,
  opts?: { instruction?: string; emoji?: boolean },
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const res = await fetch(`${TOM_BASE}/internal/format-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ action, html, instruction: opts?.instruction, emoji: opts?.emoji }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const data = await res.json();
    return data?.ok ? { ok: true, html: String(data.html || '') } : { ok: false, reason: String(data?.error || 'unknown') };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

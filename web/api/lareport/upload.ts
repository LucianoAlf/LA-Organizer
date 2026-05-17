// Upload de foto via JSON com data URL (base64). Evita multipart/formidable
// que tem incompatibilidade ESM em alguns runtimes da Vercel.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth.js';
import { checkAccess } from '../_lib/access-control.js';
import { lareport } from '../_lib/lareport-server.js';
import { randomUUID } from 'node:crypto';

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const collab = await requireCollaborator(req, res);
    if (!collab) return;

    const access = checkAccess(collab, 'inventario');
    if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

    const { dataUrl, filename } = (req.body || {}) as { dataUrl?: string; filename?: string };
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ ok: false, error: 'invalid_dataUrl' });
    }
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return res.status(400).json({ ok: false, error: 'malformed_dataUrl' });
    const meta = dataUrl.slice(5, commaIdx);   // pular "data:"
    const b64 = dataUrl.slice(commaIdx + 1);
    const mime = meta.split(';')[0] || 'image/jpeg';
    if (!ALLOWED_MIME.includes(mime)) return res.status(400).json({ ok: false, error: 'invalid_mime', detail: mime });

    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ ok: false, error: 'empty_buffer' });
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'too_large', detail: `${buf.length}b` });

    const extFromMime = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const ext = (filename?.split('.').pop() || extFromMime).toLowerCase();
    const unitDir = Array.isArray(access.unitFilter) ? 'multi' : (access.unitFilter || 'all');
    const path = `${unitDir}/${randomUUID()}.${ext}`;

    const { error } = await lareport.storage.from('inventario-fotos').upload(path, buf, {
      contentType: mime,
      upsert: false,
    });
    if (error) return res.status(500).json({ ok: false, error: 'storage_upload_failed', detail: error.message });

    const { data: pub } = lareport.storage.from('inventario-fotos').getPublicUrl(path);
    return res.status(200).json({ ok: true, url: pub.publicUrl });
  } catch (e: any) {
    console.error('[upload] exception', e);
    return res.status(500).json({ ok: false, error: 'exception', detail: e?.message || String(e) });
  }
}

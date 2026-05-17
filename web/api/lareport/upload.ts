import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';
import formidable from 'formidable';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const collab = await requireCollaborator(req, res);
    if (!collab) return;

    const access = checkAccess(collab, 'inventario');
    if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

    console.log('[upload] start parsing multipart');
    const form = formidable({ maxFileSize: 5 * 1024 * 1024, multiples: false });
    const [, files] = await form.parse(req);
    console.log('[upload] parsed; files keys:', Object.keys(files));

    const fileEntry: any = (files as any).file;
    const file = Array.isArray(fileEntry) ? fileEntry[0] : fileEntry;
    if (!file) return res.status(400).json({ ok: false, error: 'no_file', detail: `files keys: ${Object.keys(files).join(',')}` });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype || '')) return res.status(400).json({ ok: false, error: 'invalid_mime', detail: file.mimetype });

    const ext = (file.originalFilename?.split('.').pop() || 'jpg').toLowerCase();
    const unitDir = Array.isArray(access.unitFilter) ? 'multi' : (access.unitFilter || 'all');
    const path = `${unitDir}/${randomUUID()}.${ext}`;
    console.log('[upload] reading filepath', file.filepath, 'target', path);
    const buf = readFileSync(file.filepath);
    console.log('[upload] uploading', buf.length, 'bytes');

    const { error } = await lareport.storage.from('inventario-fotos').upload(path, buf, { contentType: file.mimetype || 'image/jpeg', upsert: false });
    if (error) return res.status(500).json({ ok: false, error: 'storage_upload_failed', detail: error.message });

    const { data: pub } = lareport.storage.from('inventario-fotos').getPublicUrl(path);
    return res.status(200).json({ ok: true, url: pub.publicUrl });
  } catch (e: any) {
    console.error('[upload] EXCEPTION', e);
    return res.status(500).json({ ok: false, error: 'exception', detail: e?.message || String(e), stack: e?.stack?.split('\n').slice(0, 5).join(' | ') });
  }
}

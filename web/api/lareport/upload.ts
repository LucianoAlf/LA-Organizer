import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';
import formidable from 'formidable';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const form = formidable({ maxFileSize: 5 * 1024 * 1024, multiples: false });
  const [, files] = await form.parse(req);
  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ ok: false, error: 'no_file' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype || '')) return res.status(400).json({ ok: false, error: 'invalid_mime' });

  const ext = (file.originalFilename?.split('.').pop() || 'jpg').toLowerCase();
  const unitDir = Array.isArray(access.unitFilter) ? 'multi' : (access.unitFilter || 'all');
  const path = `${unitDir}/${randomUUID()}.${ext}`;
  const buf = readFileSync(file.filepath);

  const { error } = await lareport.storage.from('inventario-fotos').upload(path, buf, { contentType: file.mimetype || 'image/jpeg', upsert: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const { data: pub } = lareport.storage.from('inventario-fotos').getPublicUrl(path);
  return res.status(200).json({ ok: true, url: pub.publicUrl });
}

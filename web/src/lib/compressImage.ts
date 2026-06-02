// web/src/lib/compressImage.ts
//
// Comprime/redimensiona imagem no CLIENTE antes do upload.
//
// Bug 02/06 (Rodrigo, auditoria de instrumentos): fotos de celular (~3–12MB)
// viravam base64 (~1.33×) e estouravam o limite de body da serverless do Vercel
// (~4.5MB, cap de plataforma que o `bodyParser.sizeLimit` NÃO eleva) → erro
// 413 "Payload Too Large", intermitente (só nas fotos grandes; as menores iam).
//
// Redimensionar p/ `maxDim` e reencodar JPEG deixa a payload sempre <1MB, resolve
// de vez E economiza storage. Defensivo: qualquer falha → devolve o arquivo
// original (nunca quebra o fluxo de upload).

export interface CompressOptions {
  maxDim?: number;   // maior lado em px (preserva proporção)
  quality?: number;  // 0..1 (JPEG)
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxDim = 2000, quality = 0.82 } = opts;
  if (!file || !file.type.startsWith('image/')) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // não decodificou → sobe original
  }

  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file; // não compensou → original

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}

import { useState } from 'react';
import { uploadFoto } from '../../../lib/lareport-mutations';

interface Props { value: string | null; onChange: (url: string | null) => void; }

export function FotoUploader({ value, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) { setErro('Máximo 5MB'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setErro('Formato inválido (JPEG/PNG/WebP)'); return; }
    setErro(null);
    setUploading(true);
    try {
      const url = await uploadFoto(file);
      onChange(url);
    } catch (e: any) {
      setErro(e.message || 'Erro no upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {value ? (
        <div className="relative">
          <img src={value} alt="Foto" className="w-full max-h-48 object-cover rounded-md" />
          <button onClick={() => onChange(null)} className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded-md text-[10px]">Remover</button>
        </div>
      ) : (
        <label className="block w-full p-md border-2 border-dashed border-border rounded-md text-center cursor-pointer hover:border-tom">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <div className="text-2xl mb-1">📷</div>
          <div className="text-sm text-fg-muted">{uploading ? 'Enviando...' : 'Toque pra escolher uma foto'}</div>
        </label>
      )}
      {erro && <div className="text-[11px] text-danger mt-1">{erro}</div>}
    </div>
  );
}

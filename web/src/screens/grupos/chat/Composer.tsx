// web/src/screens/grupos/chat/Composer.tsx
import { useRef, useState } from 'react';
import { Paperclip, Mic, Send, X } from 'lucide-react';
import { useAudioRecorder } from '../../../hooks/useAudioRecorder';
import { showToast } from '../../../components/Toast';
import type { ChatMsg } from '../../../lib/groupChat';

interface Props {
  onSend: (input: { text?: string; attachment?: { url: string; mime: string; filename: string; kind: ChatMsg['kind'] } }) => Promise<void>;
  upload: (file: Blob, filename: string, mime: string) => Promise<{ url: string; mime: string; filename: string; kind: ChatMsg['kind'] }>;
}

export function Composer({ onSend, upload }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rec = useAudioRecorder();

  async function sendText() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onSend({ text }); setText(''); }
    catch { showToast({ kind: 'error', title: 'Não consegui enviar' }); }
    finally { setBusy(false); }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { showToast({ kind: 'error', title: 'Arquivo grande demais (máx 15MB)' }); return; }
    setBusy(true);
    try { const a = await upload(file, file.name, file.type); await onSend({ attachment: a }); }
    catch (e) { showToast({ kind: 'error', title: 'Falha no anexo', msg: (e as Error)?.message?.slice(0, 120) }); }
    finally { setBusy(false); }
  }
  async function startAudio() {
    try {
      await rec.start();
    } catch (e: unknown) {
      const err = e as { name?: string };
      const negado = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      showToast({
        kind: 'error',
        title: negado ? 'Microfone bloqueado' : 'Não consegui acessar o microfone',
        msg: negado
          ? 'Este navegador bloqueou o microfone. Grave pelo app no celular, ou abra numa aba normal do Chrome e permita no cadeado.'
          : 'Verifique se há um microfone disponível neste dispositivo.',
      });
    }
  }
  async function stopAudio() {
    const blob = await rec.stop();
    if (!blob) return;
    setBusy(true);
    try { const a = await upload(blob, `audio-${Date.now()}.webm`, 'audio/webm'); await onSend({ attachment: a }); }
    catch (e) { showToast({ kind: 'error', title: 'Falha no áudio', msg: (e as Error)?.message?.slice(0, 120) }); }
    finally { setBusy(false); }
  }

  if (rec.recording) {
    return (
      <div className="shrink-0 flex items-center gap-sm border-t border-border p-sm bg-bg-surface">
        <button type="button" onClick={rec.cancel} className="w-8 h-8 grid place-items-center rounded-full text-danger" aria-label="Cancelar"><X size={18} /></button>
        <div className="flex-1 text-body-sm text-danger animate-pulse">● Gravando… {String(Math.floor(rec.seconds / 60)).padStart(2, '0')}:{String(rec.seconds % 60).padStart(2, '0')}</div>
        <button type="button" onClick={stopAudio} className="w-8 h-8 grid place-items-center rounded-full bg-tom text-black" aria-label="Enviar áudio"><Send size={16} /></button>
      </div>
    );
  }
  return (
    <div className="shrink-0 flex items-center gap-xs border-t border-border p-sm bg-bg-surface">
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="w-8 h-8 grid place-items-center rounded-full bg-bg-elevated text-fg-muted disabled:opacity-50" aria-label="Anexar"><Paperclip size={18} /></button>
      <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); } }}
        placeholder="Mensagem pro grupo…" className="flex-1 bg-bg-app border border-border rounded-full px-md py-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
      {text.trim()
        ? <button type="button" onClick={sendText} disabled={busy} className="w-8 h-8 grid place-items-center rounded-full bg-tom text-black disabled:opacity-50" aria-label="Enviar"><Send size={16} /></button>
        : <button type="button" onClick={startAudio} disabled={busy} className="w-8 h-8 grid place-items-center rounded-full bg-bg-elevated text-fg-muted disabled:opacity-50" aria-label="Gravar áudio"><Mic size={18} /></button>}
    </div>
  );
}

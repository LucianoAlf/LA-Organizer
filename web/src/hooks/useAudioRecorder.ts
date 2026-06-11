// web/src/hooks/useAudioRecorder.ts
import { useRef, useState, useEffect } from 'react';
export function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.start(); recRef.current = rec; setRecording(true); setSeconds(0);
    timer.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
  }
  function stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec) return resolve(null);
      rec.onstop = () => {
        rec.stream.getTracks().forEach(t => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        resolve(chunks.current.length ? new Blob(chunks.current, { type: 'audio/webm' }) : null);
      };
      rec.stop();
    });
  }
  function cancel() {
    const rec = recRef.current;
    if (rec) { rec.onstop = () => rec.stream.getTracks().forEach(t => t.stop()); rec.stop(); }
    if (timer.current) clearInterval(timer.current);
    chunks.current = []; setRecording(false);
  }
  useEffect(() => () => { cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { recording, seconds, start, stop, cancel };
}

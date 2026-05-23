import { useCallback, useRef, useState } from 'react';

export interface UseResizeOpts {
  /** Converte deltaY (px) em incremento de duração em ms (já snapped). */
  deltaPxToDurationMs: (deltaPx: number) => number;
  /** Duração mínima em ms (default 15min). */
  minDurationMs?: number;
  /** Duração máxima em ms (default 12h). */
  maxDurationMs?: number;
  /** Chamado em cada movimento — para feedback visual. */
  onResize?: (newDurationMs: number) => void;
  /** Chamado no release — persistência. */
  onCommit: (newDurationMs: number) => void;
}

export function useResize(initialDurationMs: number, opts: UseResizeOpts) {
  const startYRef = useRef(0);
  const startDurRef = useRef(initialDurationMs);
  const [resizing, setResizing] = useState(false);
  const [previewDurationMs, setPreviewDurationMs] = useState(initialDurationMs);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    startDurRef.current = initialDurationMs;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const delta = opts.deltaPxToDurationMs(ev.clientY - startYRef.current);
      const min = opts.minDurationMs ?? 15 * 60 * 1000;
      const max = opts.maxDurationMs ?? 12 * 60 * 60 * 1000;
      const next = Math.min(max, Math.max(min, startDurRef.current + delta));
      setPreviewDurationMs(next);
      opts.onResize?.(next);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      const delta = opts.deltaPxToDurationMs(ev.clientY - startYRef.current);
      const min = opts.minDurationMs ?? 15 * 60 * 1000;
      const max = opts.maxDurationMs ?? 12 * 60 * 60 * 1000;
      const next = Math.min(max, Math.max(min, startDurRef.current + delta));
      setResizing(false);
      opts.onCommit(next);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        setResizing(false);
        setPreviewDurationMs(startDurRef.current);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
  }, [initialDurationMs, opts]);

  return { resizing, previewDurationMs, onPointerDown };
}

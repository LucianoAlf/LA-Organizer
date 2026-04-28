interface Props {
  label?: string;
  fullScreen?: boolean;
  rows?: number;
}

export function LoadingState({ label, fullScreen, rows = 3 }: Props) {
  if (fullScreen) {
    return (
      <div className="min-h-screen grid place-items-center bg-bg-app">
        <div className="text-center">
          <span className="inline-block h-8 w-8 rounded-full border-2 border-brand/30 border-t-brand animate-spin" aria-hidden />
          {label && <p className="mt-md text-body-sm text-fg-muted">{label}</p>}
        </div>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-md bg-bg-surface border border-border p-md">
          <div className="h-3 w-1/3 bg-bg-elevated rounded animate-pulse" />
          <div className="mt-3 h-3 w-3/4 bg-bg-elevated rounded animate-pulse" />
        </div>
      ))}
      {label && <p className="text-body-sm text-fg-muted text-center">{label}</p>}
    </div>
  );
}

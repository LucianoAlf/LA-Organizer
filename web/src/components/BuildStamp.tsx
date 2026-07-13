// Selo de versão (build stamp) — texto discreto no rodapé de Configurações.
// Os valores vêm de `define` no vite.config.ts (injeção em build-time): versão do
// package.json, short SHA do commit (Vercel) e timestamp do build. Serve pra bater
// o olho e saber em que build o usuário está ("novo ou velho?").

const APP_VERSION = __APP_VERSION__;
const BUILD_SHA = __BUILD_SHA__;
const BUILD_TIME = __BUILD_TIME__;

function formatBuilt(iso: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function BuildStamp() {
  const built = formatBuilt(BUILD_TIME);
  return (
    <div className="pt-1 pb-6 text-center leading-tight select-text" aria-label="Versão do app">
      <div className="text-caption text-fg-muted">
        LA Organizer · v{APP_VERSION} · {BUILD_SHA}
      </div>
      {built && (
        <div className="text-caption text-fg-muted mt-0.5">
          atualizado {built}
        </div>
      )}
    </div>
  );
}

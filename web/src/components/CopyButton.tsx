import { useState } from 'react';

// Botão de copiar (código de barras / chave PIX). Feedback "copiado ✓" por 1.5s.
// Degrada em silêncio se navigator.clipboard não existir (http/sem permissão) — o campo
// continua selecionável na mão.
export function CopyButton({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch {
      /* sem clipboard: o usuário seleciona manualmente */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!value}
      className="shrink-0 text-body-sm text-tom px-3 py-2 rounded-md border border-border hover:bg-bg-surface focus-ring disabled:opacity-40"
    >
      {ok ? 'copiado ✓' : 'copiar'}
    </button>
  );
}

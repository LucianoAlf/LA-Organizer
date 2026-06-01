import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { BANKS, logoUrl } from '../../../lib/banks';

// Logo do banco no tile da COR DA MARCA (ex.: Itaú azul, Nubank roxo, C6 preto).
// Sem banco (ex.: Dinheiro) → ícone de carteira (Lucide) em fundo verde.
export function BankLogo({ slug, name, color, size = 38 }: { slug?: string | null; name?: string | null; color?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const info = slug ? BANKS[slug] : undefined;
  const showImg = !!slug && !failed;
  const bg = color || info?.color || (slug ? '#6B7280' : '#16a34a'); // sem banco → verde
  const initial = ((name || info?.name || '?').trim().charAt(0) || '?').toUpperCase();
  return (
    <span className="inline-flex items-center justify-center rounded-[10px] overflow-hidden shrink-0"
      style={{ width: size, height: size, background: bg }}>
      {showImg ? (
        <img src={logoUrl(slug!)} alt={name || slug || ''} width={size} height={size}
          style={{ objectFit: 'contain', padding: size * 0.18 }} onError={() => setFailed(true)} />
      ) : slug ? (
        <span style={{ color: '#fff', fontWeight: 800, fontSize: size * 0.42 }}>{initial}</span>
      ) : (
        <Wallet color="#fff" size={size * 0.5} strokeWidth={2.2} />
      )}
    </span>
  );
}

import { useState } from 'react';
import { BANKS, logoUrl } from '../../../lib/banks';

export function BankLogo({ slug, name, color, size = 38 }: { slug?: string | null; name?: string | null; color?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const info = slug ? BANKS[slug] : undefined;
  const bg = color || info?.color || '#6B7280';
  const showImg = !!slug && !failed;
  const initial = ((name || info?.name || '?').trim().charAt(0) || '?').toUpperCase();
  return (
    <span className="inline-flex items-center justify-center rounded-[10px] overflow-hidden shrink-0"
      style={{ width: size, height: size, background: showImg ? '#fff' : bg }}>
      {showImg ? (
        <img src={logoUrl(slug!)} alt={name || slug || ''} width={size} height={size}
          style={{ objectFit: 'contain', padding: size * 0.12 }} onError={() => setFailed(true)} />
      ) : (
        <span style={{ color: '#fff', fontWeight: 800, fontSize: size * 0.42 }}>{initial}</span>
      )}
    </span>
  );
}

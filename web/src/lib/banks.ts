export interface BankInfo { name: string; color: string; }

// Cores semeadas do material do Alf (bank-logos.tsx). Logos oficiais em /banks/<slug>.svg.
export const BANKS: Record<string, BankInfo> = {
  nubank:      { name: 'Nubank',          color: '#820ad1' },
  itau:        { name: 'Itaú',            color: '#003399' },
  bradesco:    { name: 'Bradesco',        color: '#cc092f' },
  santander:   { name: 'Santander',       color: '#ec0000' },
  bb:          { name: 'Banco do Brasil', color: '#fcbf00' },
  caixa:       { name: 'Caixa',           color: '#005ca9' },
  c6:          { name: 'C6 Bank',         color: '#242424' },
  inter:       { name: 'Inter',           color: '#ff7a00' },
  mercadopago: { name: 'Mercado Pago',    color: '#00b1ea' },
  picpay:      { name: 'PicPay',          color: '#21c25e' },
  neon:        { name: 'Neon',            color: '#00e5a0' },
  will:        { name: 'Will Bank',       color: '#ff0066' },
  pagbank:     { name: 'PagBank',         color: '#00a651' },
  btg:         { name: 'BTG',             color: '#00263a' },
  next:        { name: 'Next',            color: '#00dc5a' },
  original:    { name: 'Original',        color: '#00a868' },
};

export function logoUrl(slug: string): string { return `/banks/${slug}.svg`; }

const norm = (s: string) =>
  s.toLowerCase()
   .normalize('NFD')
   .replace(/[̀-ͯ]/g, '')
   .replace(/\s+/g, ' ')
   .trim();

export function matchBankSlug(name: string): string | null {
  if (!name) return null;
  const n = norm(name);
  for (const [slug, info] of Object.entries(BANKS)) {
    if (n === slug || n.includes(slug) || n.includes(norm(info.name))) return slug;
  }
  return null;
}

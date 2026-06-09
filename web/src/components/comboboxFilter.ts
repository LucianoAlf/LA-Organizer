export interface ComboOpt { value: string; label: string; sublabel?: string; }

// lowercase + sem acento + sem emoji/símbolo/espaço inicial (labels são "EMOJI  Nome").
export function normalize(s: string): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^[^a-z0-9]+/i, '')
    .trim();
}

export function filterOptions<T extends ComboOpt>(options: T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return options;
  return options.filter((o) => normalize(o.label).includes(q));
}

export function shouldOfferCreate(options: ComboOpt[], query: string): boolean {
  const q = normalize(query);
  if (!q) return false;
  return !options.some((o) => normalize(o.label) === q);
}

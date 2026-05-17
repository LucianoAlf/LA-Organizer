import type { CollaboratorAuth } from './access-control';

export function withAudit(text: string | null | undefined, collab: CollaboratorAuth, prefix = 'via PWA'): string {
  const prev = (text ?? '').trim();
  const tag = `${prefix} por ${collab.full_name}`;
  return prev ? `${tag}\n\n${prev}` : tag;
}

const RESTRICTED_FIELDS = ['valor_compra', 'nota_fiscal', 'fornecedor', 'data_compra'];

export function stripRestrictedFields(payload: any, allowed: boolean): { clean: any; stripped: string[] } {
  if (allowed) return { clean: payload, stripped: [] };
  const clean = { ...payload };
  const stripped: string[] = [];
  for (const f of RESTRICTED_FIELDS) {
    if (f in clean) { delete clean[f]; stripped.push(f); }
  }
  return { clean, stripped };
}

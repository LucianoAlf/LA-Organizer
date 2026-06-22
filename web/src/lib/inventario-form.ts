// Normaliza campos numéricos do ItemSheet na hora de salvar.
// Os inputs guardam o texto cru (inclusive vazio durante a edição); aqui garantimos
// um inteiro válido pra persistir. Evita o bug do `parseInt(...) || N` aplicado a CADA
// tecla (que impedia limpar o campo e forçava concatenação tipo "1" -> "102").
function toInt(raw: unknown, fallback: number, min: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

// Quantidade do item: inteiro >= 1 (default 1).
export function normalizeQuantidade(raw: unknown): number {
  return toInt(raw, 1, 1);
}

// Dias de antecedência do alerta de revisão: inteiro >= 0 (default 30).
export function normalizeAlertaDias(raw: unknown): number {
  return toInt(raw, 30, 0);
}

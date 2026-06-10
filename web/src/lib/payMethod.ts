// Picker de "Pago com" no PagarContaSheet: o value do ComboBox codifica o método.
// 'none' | 'acc:<id>' | 'card:<id>'  →  objeto discriminado.
export type PayMethod =
  | { kind: 'none' }
  | { kind: 'account'; id: string }
  | { kind: 'card'; id: string };

export function parsePayMethod(value: string): PayMethod {
  if (value.startsWith('acc:')) return { kind: 'account', id: value.slice(4) };
  if (value.startsWith('card:')) return { kind: 'card', id: value.slice(5) };
  return { kind: 'none' };
}

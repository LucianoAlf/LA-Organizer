// errorText — extrai uma mensagem legível de um erro desconhecido pra exibir na UI.
//
// Bug HABIT-CREATE-FREQ-CUSTOM (Arthur 15/07): o onError do EditHabitSheet fazia
// `String(e)` num erro do Supabase (PostgrestError é um OBJETO, não instanceof Error)
// → renderizava "[object Object]" na tela, escondendo a falha real (CHECK constraint).
//
// Regra: Error próprio (nossos throws de validação, ex.: "Nome obrigatório.") → mostra a
// mensagem (é amigável e intencional). String → a própria. Qualquer objeto opaco
// (PostgrestError etc.) → fallback amigável; o detalhe cru deve ir pro console.error de quem
// chama (nunca pro usuário — mensagem de Postgres assusta e vaza estrutura interna).
export function errorText(e: unknown, fallback = 'Algo deu errado. Tenta de novo.'): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  return fallback;
}

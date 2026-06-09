# ComboBox de Categoria e Meio de Pagamento — Design

**Data:** 2026-06-08
**Autor:** Alf (relato do Matheus) + Claude (brainstorming)
**Status:** aprovado (design) → pronto pra plano

## Goal

Tornar a entrada de dados do modal **"Novo lançamento"** (`LancamentoSheet`) ultra-rápida: os campos **Categoria** e **Meio de pagamento** deixam de ser dropdowns fechados e viram **comboboxes** (digitar → filtrar ao vivo). A **Categoria** ainda permite **criar inline** ("➕ Criar 'X'") sem abrir modal, já deixando a nova categoria selecionada. Navegação por teclado fluida.

## Contexto / problema

- Hoje, Categoria e Meio de pagamento usam o DS `CustomSelect` (`web/src/components/CustomSelect.tsx`) — dropdown de **botão**, sem digitação/filtro. Pra achar um item, rola a lista; pra criar categoria, o `footerAction "➕ Incluir categoria"` abre o `NovaCategoriaSheet` (com seletor de emoji), quebrando o fluxo de digitação.
- **Correção de premissa:** o PWA **não usa Radix/Shadcn**. É um DS próprio (Tailwind tokens + componentes em `web/src/components/`). O combobox é construído sobre esse DS.
- Decisão (aprovada): **criar inline só na Categoria** (leve: rótulo+emoji+tipo). **Meio de pagamento** ganha só **busca** — criar carteira/cartão exige form completo (limite, fechamento, vencimento) e continua em Finanças → Carteiras/Cartões.

## Solução

### 1. Componente novo `ComboBox` (`web/src/components/ComboBox.tsx`)

Irmão do `CustomSelect`, mesmos tokens/posicionamento (mede espaço, abre p/ cima ou baixo), mas com **input de texto** no trigger.

**Props:**
```ts
interface ComboBoxOption { value: string; label: string; sublabel?: string; }
interface ComboBoxProps {
  value: string;
  options: ComboBoxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';            // default md (h-12)
  prefer?: 'up' | 'down' | 'auto';
  /** Habilita "➕ Criar '<texto>'" quando o texto não casa nenhuma opção. */
  onCreate?: (text: string) => Promise<string>;  // retorna o `value` (slug) da nova opção, já criada
  createLabel?: (text: string) => string;        // default: `➕ Criar "${text}"`
  /** Ação fixa no rodapé (ex: abrir sheet com seletor de emoji). Opcional. */
  footerAction?: { label: string; onClick: () => void };
}
```

**Comportamento:**
- Fechado: mostra o `label` da opção selecionada (ou placeholder). Foco/clique abre e foca o input.
- Digitando: filtra `options` por `label` (case- e acento-insensível). Lista rola (max-h).
- `onCreate` definido + texto não-vazio que **não casa exatamente** nenhum label → opção **"➕ Criar '<texto>'"** no topo. Selecionar (clique/Enter) chama `onCreate(text)`, espera o `value`, faz `onChange(value)`, fecha. Loading visual no item enquanto cria.
- Selecionar opção existente: `onChange(value)`, fecha, limpa o texto de busca.
- `footerAction` (se passado) aparece fixo no rodapé do dropdown, abaixo da lista.

**Teclado:**
- `↑/↓`: move o destaque (inclui a opção "Criar" quando presente). `Home/End` opcional (YAGNI: pular).
- `Enter`: seleciona o item destacado; se nenhum destacado mas há "Criar", cria.
- `Esc`: fecha sem mudar.
- `Tab`: fecha e avança pro próximo campo (não engole o Tab).
- Blur (clicar fora): fecha mantendo o valor atual.

**Lógica pura testável** (extraída p/ TDD):
- `filterOptions(options, query)` → opções cujo label normalizado contém o query normalizado.
- `shouldOfferCreate(options, query)` → `true` se query não-vazio e nenhum label normalizado === query normalizado.
- `normalize(s)` → lowercase + strip acentos (NFD).

### 2. Aplicação

**`LancamentoSheet.tsx`:**
- **Categoria**: `<ComboBox creatable>` via `onCreate`. `onCreate(text)` chama `useCreateCategory().mutateAsync({ label: text, emoji: '🏷️', type })` e retorna `r.slug`; o ComboBox seleciona o slug. Mantém o `footerAction "➕ Incluir categoria"` (abre `NovaCategoriaSheet` p/ quem quer escolher emoji). Emoji default 🏷️ (editável depois na página Categorias).
- **Meio de pagamento**: `<ComboBox>` sem `onCreate` (só busca). Mesmas `medioOptions` de hoje.

**`TransactionSheet.tsx` (edição):** aplicar o mesmo ComboBox nos campos equivalentes de Categoria/Meio, por consistência. (Confirmar campos exatos na implementação.)

### 3. Acessibilidade / fluidez (Problema 2)
- `Valor` já tem `autofocus` ✓ (mantém).
- Tab percorre: Valor → Categoria → Meio → Descrição → datas → Registrar.
- Erro de validação continua **inline** (`<p class="text-danger">`), sem deslocar foco nem quebrar layout (comportamento atual preservado).

## Edge cases / regras
- Lista vazia + sem `onCreate` → "Nenhuma opção".
- Texto casa exatamente um label existente → NÃO oferece criar (evita duplicar).
- `onCreate` falha → mostra erro inline no dropdown, mantém o texto digitado, não fecha.
- Valor selecionado que não está mais em `options` (categoria desativada) → mostra o último label conhecido se disponível, senão o `value`.
- Mobile: input com teclado nativo; lista tocável; sem depender de hover.

## Testing
- **Vitest (TDD)** na lógica pura: `filterOptions`, `shouldOfferCreate`, `normalize` — casos: filtro acento-insensível ("sho"→"Shows", "agua"→"Água"), match exato não oferece criar, query vazio não oferece criar, lista vazia.
- **Preview (localhost:4173)** p/ validar interação (digitar, criar inline, teclado ↑/↓/Enter/Esc/Tab, mobile 375 + desktop 1440) ANTES de pedir reteste — workflow de preview do projeto.
- `npx tsc --noEmit` + `npx vite build` limpos.

## Fora de escopo (YAGNI)
- Outros selects (parcelas, dia do vencimento, tipo) seguem `CustomSelect`.
- Criar inline de carteira/cartão (Meio) — fica em Carteiras/Cartões.
- Multi-seleção, agrupamento, virtualização da lista.
- Não mexer no `CustomSelect` existente (continua pros demais usos).

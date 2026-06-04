# Categorias personalizadas (despesa + receita) — Design

**Data:** 2026-06-03
**Autor:** TOM/Claude + Alf
**Status:** aprovado (aguardando spec review)

## Objetivo
Permitir que cada colaborador crie suas próprias categorias de **despesa** e **receita** (ex.: "Shows" pra músicos/professores), com ícone, persistidas no banco, refletindo em todo o app (form de lançamento, pizza, listas) **e reconhecidas pelo TOM** no WhatsApp.

## Contexto (o que JÁ existe)
- Tabela `pf_categories` já tem: `slug, label, emoji, color, type, keywords, is_default, collaborator_id (nullable), sort_order, is_active`. Defaults globais = `collaborator_id NULL`. Custom = `collaborator_id` setado.
- PWA: `lib/categorias.ts#listCategories()` lê `pf_categories` (defaults + custom via RLS); `useCategories()`/`useCategoryLookup()` são data-driven; pizza e listas usam o lookup. → **categoria custom já flui automaticamente** ao app assim que inserida.
- Engine TOM: `safeCategory()` (engine.js) valida contra lista **fixa** `src/finance/categories.data.js` (`validSlugs`). Custom não é reconhecida hoje → cai em fallback ('outros'/'outras_receitas').

## Escopo
**Fase 1 (PWA):** criar e apagar categoria custom; usar no form/pizza/listas.
**Fase 2 (TOM):** o engine valida categoria pela tabela (defaults + custom do usuário) e injeta as custom no prompt do LLM. TOM **não cria** categorias (só o app cria).

## Decisões
- **Apagar = soft-delete** (`is_active=false`). Some do picker; transações antigas mantêm o rótulo (o lookup inclui inativas). Defaults **nunca** apagáveis.
- **Slug**: gerado do label (lowercase, NFD sem acento, `\s+`→`_`, só `[a-z0-9_]`), com sufixo numérico se colidir com slug existente do mesmo collaborator+type. Ex.: "Shows" → `shows`.
- **Cor**: auto de uma paleta fixa (sem color picker — modal enxuto: ícone + nome).
- **Ícone**: grid de emoji (mesmo padrão do AccountSheet).
- **Tipo**: travado pelo contexto (o dropdown sabe se está em despesa ou receita).

## Arquitetura

### 1. Migration — RLS em `pf_categories`
- `SELECT`: dono vê defaults (`collaborator_id IS NULL`) + as próprias (`collaborator_id = current_collab_id()`).
- `INSERT`: permitido só com `collaborator_id = current_collab_id()` e `is_default = false`.
- `UPDATE`/`DELETE`: só linhas próprias (`collaborator_id = current_collab_id()`) — defaults intocáveis.
- (Apagar na prática é UPDATE `is_active=false`.)

### 2. PWA
- `lib/categorias.ts`:
  - `listCategories()` — passa a trazer também `is_active` e **incluir inativas** (pro lookup resolver rótulo histórico); o **picker** filtra `is_active` no cliente.
  - `createCategory({label, emoji, type})` → calcula slug único, cor da paleta, `collaborator_id` (vem do helper de auth), `sort_order` alto, `is_default=false`. Retorna a linha criada.
  - `deactivateCategory(id)` → UPDATE `is_active=false` (RLS garante que só apaga as próprias).
- `hooks/useFinanceiro.ts`: `useCreateCategory`, `useDeactivateCategory` (invalidam `['pf_categories']`). `useCategoryLookup` inclui inativas.
- `components/CustomSelect.tsx`: suportar uma **ação de rodapé opcional** (`footerAction?: { label, onClick }`) renderizada como último item fixo do dropdown. (Se já existir mecanismo, reusar.)
- `components/NovaCategoriaSheet.tsx` (novo): BottomSheet com input de nome + grid de emoji; recebe `type` (travado) e `onCreated(slug)`. Cria e devolve o slug pra auto-selecionar.
- `LancamentoSheet.tsx`: passa `footerAction` "➕ Incluir categoria" no CustomSelect de categoria → abre `NovaCategoriaSheet` com o `type` atual → ao criar, seleciona a nova categoria.
- **Gerenciar categorias**: tela/sheet simples listando as custom do usuário (agrupadas por tipo) com lixeirinha (confirm + `deactivateCategory`). Defaults não aparecem com lixeira. Entrada por um link em Finanças (FinanceQuickLinks ou dashboard).
- Realtime: `useRealtimeFinance` já cobre `pf_categories`? Se não, adicionar à união pra refletir cross-device.

### 3. Engine TOM (Fase 2)
- `financeiro-service.js`: `listCategorySlugs(collaboratorId, type?)` → defaults + custom ativas do colaborador.
- `engine.js#safeCategory(cat, description, type, cid)`: validar contra o conjunto do banco (carregado no fluxo da mensagem) em vez de só `categories.data.js`. Mantém o mapeamento por descrição e o fallback por tipo. (categories.data.js continua como seed/labels default.)
- `prompts/system.js`: no bloco de contexto financeiro (ou na skill financeiro-pessoal), injetar as categorias **custom** do usuário ("Shows (receita)", …) pra o LLM escolher. Deixar claro: **não invente/!crie** categoria — use as listadas; se não casar, use a natureza mais próxima.

## Edge cases
- Slug colidindo → sufixo `_2`, `_3`.
- Apagar categoria em uso → soft-delete; transações antigas continuam exibindo o rótulo (lookup inclui inativas); some só do picker e da soma da pizza do mês futuro (as antigas seguem contando no histórico).
- Nome vazio/duplicado (mesmo label+type já ativo) → bloquear com mensagem.
- Limite leve: máx. ~30 custom por tipo (evita abuso) — opcional, baixo risco.

## Testes
- **Puro (Vitest/node):** `slugify`/uniquificador de slug (TDD).
- **DB:** asserts de RLS — usuário A não vê/edita/apaga categoria de B; ninguém apaga default. Reconciliação: categoria custom aparece em `listCategories` do dono e não do outro.
- **PWA:** `tsc --noEmit` + `vite build`.
- **Engine:** `node --check`; smoke: criar "Shows" no app → "recebi 500 de show" no TOM cai em `shows` (Fase 2).

## Fora de escopo
- Renomear/editar categoria custom (só criar + apagar agora).
- TOM criar categoria por chat.
- Color picker / reordenação manual.
- Editar keywords das custom (LLM casa por label).

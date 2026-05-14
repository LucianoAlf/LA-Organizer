# Roles — Localização e Padronização de Cargos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Traduzir os rótulos dos níveis de permissão para português e formalizar a lista de cargos (`function_title`), sem alterar schema de banco, RLS ou lógica de permissões.

**Architecture:** Centralizar todas as constantes de role em `web/src/lib/roles.ts` (display names, cores, rank, lista de cargos). Frontend importa desse arquivo. TOM recebe o display name em português + cargo no system prompt.

**Tech Stack:** TypeScript/React (frontend), Node.js (TOM engine/prompts)

---

## Contexto do sistema atual

### Valores internos de `role` (DB — inalterados)

| Valor interno | Rank | Display atual (inglês) |
|---|---|---|
| `collaborator` | 0 | collaborator |
| `leader` | 1 | leader |
| `coordinator` | 2 | coordinator |
| `manager` | 3 | manager |
| `director` | 4 | director |

### Onde os roles aparecem hoje (todos hardcoded, espalhados)

- `web/src/types.ts` — type `Role`
- `web/src/screens/GestaoEquipe.tsx` — `ROLE_COLOR`
- `web/src/screens/GestaoEquipeDetalhe.tsx` — `ROLES`, `ROLE_RANK`
- `web/src/screens/GestaoEquipeNovo.tsx` — `ROLES`, `ROLE_RANK`
- `src/prompts/system.js` — injeta `collab.role` cru no prompt
- `src/engine.js` — compara strings hardcoded (`'director'`, `'manager'`, etc.)
- `src/rituals/dispatcher.js` — `COORDINATOR_ROLES`, seleção de destinatários
- `supabase/functions/admin-create-collaborator/index.ts` — `ROLE_RANK`

---

## O que muda

### 1. Novo arquivo centralizado: `web/src/lib/roles.ts`

Substitui todas as constantes espalhadas no frontend. Exporta:

```typescript
export const ROLE_LABELS: Record<Role, string> = {
  collaborator: 'Colaborador',
  leader:       'Líder',
  coordinator:  'Coordenador',
  manager:      'Gerente',
  director:     'Diretor',
};

export const ROLE_RANK: Record<Role, number> = {
  collaborator: 0,
  leader:       1,
  coordinator:  2,
  manager:      3,
  director:     4,
};

export const ROLE_COLOR: Record<Role, string> = {
  collaborator: '#6b7280',  // gray
  leader:       '#f59e0b',  // amber
  coordinator:  '#7c3aed',  // purple
  manager:      '#0ea5e9',  // sky blue
  director:     '#E91451',  // tom/brand red
};

export const ROLES: Role[] = ['collaborator', 'leader', 'coordinator', 'manager', 'director'];

// Cargos predefinidos por nível de permissão
export const FUNCTION_TITLES: Record<Role, string[]> = {
  collaborator: ['Farmer', 'Hunter', 'Professor', 'Assistente Pedagógico', 'Financeiro', 'RH'],
  leader:       ['Líder de Equipe'],
  coordinator:  ['Coordenador'],
  manager:      ['Gerente'],
  director:     ['Diretor'],
};

// Lista flat de todos os cargos (para dropdowns gerais)
export const ALL_FUNCTION_TITLES: string[] = Object.values(FUNCTION_TITLES).flat();
```

### 2. Frontend — 3 telas atualizadas

**GestaoEquipe.tsx, GestaoEquipeDetalhe.tsx, GestaoEquipeNovo.tsx:**
- Remover constantes locais (`ROLES`, `ROLE_RANK`, `ROLE_COLOR`)
- Importar tudo de `@/lib/roles`
- Exibir `ROLE_LABELS[role]` onde hoje aparece o valor cru em inglês
- Campo `function_title` vira `<select>` com opções de `FUNCTION_TITLES[selectedRole]`
  - Filtra os cargos disponíveis conforme o nível selecionado
  - Se role muda, reseta `function_title` para o primeiro da lista do novo nível
  - **Dados existentes:** se o `function_title` salvo no banco não estiver na lista predefinida, exibe como opção selecionada mesmo assim (não quebra edição de colaboradores já cadastrados)

### 3. TOM — system prompt (`src/prompts/system.js`)

**Antes:**
```js
`**Pessoa:** ${nickname} (${collab.full_name}) — ${collab.role || '—'}`
```

**Depois:**
```js
const ROLE_LABELS = { collaborator: 'Colaborador', leader: 'Líder', coordinator: 'Coordenador', manager: 'Gerente', director: 'Diretor' };
const roleDisplay = ROLE_LABELS[collab.role] || collab.role;
const cargoDisplay = collab.function_title ? ` — ${collab.function_title}` : '';
`**Pessoa:** ${nickname} (${collab.full_name}) — ${roleDisplay}${cargoDisplay}`
```

Exemplo de saída: `**Pessoa:** Alf (Luciano Alfredo) — Diretor — Diretor`
Exemplo: `**Pessoa:** João (João Silva) — Colaborador — Hunter`

---

## O que NÃO muda

- Valores internos de `role` no banco de dados (nenhuma migration)
- RLS policies (usam valores internos em inglês — continuam funcionando)
- Check constraint do banco (`collaborator`, `leader`, `coordinator`, `manager`, `director`)
- Edge function `admin-create-collaborator` — lógica de ROLE_RANK inalterada
- `src/engine.js` e `src/rituals/dispatcher.js` — comparações de string internas em inglês inalteradas
- Hierarquia de permissões

---

## Fora de escopo (futuro)

- Restrição de acesso por cargo (ex: Financeiro vê só relatórios financeiros) — RLS por `function_title`
- Nível `leader` com cargos específicos (aguarda definição da LA)
- Internacionalização completa do sistema
- Tabela de referência no banco para `function_title` (YAGNI por enquanto)

---

## Arquivos impactados

| Arquivo | Ação |
|---|---|
| `web/src/lib/roles.ts` | **Criar** |
| `web/src/types.ts` | Sem alteração — `roles.ts` importa `Role` de lá |
| `web/src/screens/GestaoEquipe.tsx` | Modificar — importar de `lib/roles`, usar `ROLE_LABELS` |
| `web/src/screens/GestaoEquipeDetalhe.tsx` | Modificar — remover constantes locais, adicionar select de `function_title` |
| `web/src/screens/GestaoEquipeNovo.tsx` | Modificar — idem |
| `src/prompts/system.js` | Modificar — `ROLE_LABELS` local, exibir cargo no prompt |

**Não impactados:** RLS migrations, edge functions, engine.js, dispatcher.js, schema DB.

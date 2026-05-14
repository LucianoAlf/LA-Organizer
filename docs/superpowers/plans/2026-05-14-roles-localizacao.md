# Roles — Localização e Padronização de Cargos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traduzir os rótulos dos níveis de permissão para português e formalizar `function_title` como select predefinido, sem alterar schema de banco, RLS ou lógica de permissões.

**Architecture:** Criar `web/src/lib/roles.ts` como fonte única de verdade para todas as constantes de role. Telas importam desse arquivo. TOM recebe display name em português no system prompt.

**Tech Stack:** TypeScript, React, Node.js (TOM/system.js)

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `web/src/lib/roles.ts` | **Criar** | Fonte única: labels PT, rank, cores, cargos |
| `web/src/screens/GestaoEquipe.tsx` | Modificar | Importar lib/roles; exibir ROLE_LABELS |
| `web/src/screens/GestaoEquipeDetalhe.tsx` | Modificar | Importar lib/roles; labels nos chips; select de cargo |
| `web/src/screens/GestaoEquipeNovo.tsx` | Modificar | Idem |
| `src/prompts/system.js` | Modificar | Role em português no context prompt do TOM |

**Não tocar:** migrations, RLS, edge functions, engine.js, dispatcher.js, types.ts.

---

## Task 1: Criar `web/src/lib/roles.ts`

**Files:**
- Create: `web/src/lib/roles.ts`

- [ ] **Step 1: Criar o arquivo com todas as constantes**

Crie `D:\la-organizer\_remote\web\src\lib\roles.ts` com o conteúdo abaixo:

```typescript
import type { Role } from '../types';

/** Display names em português para os níveis de permissão internos. */
export const ROLE_LABELS: Record<Role, string> = {
  collaborator: 'Colaborador',
  leader:       'Líder',
  coordinator:  'Coordenador',
  manager:      'Gerente',
  director:     'Diretor',
};

/** Hierarquia numérica — admins só criam roles até o próprio nível. */
export const ROLE_RANK: Record<Role, number> = {
  collaborator: 0,
  leader:       1,
  coordinator:  2,
  manager:      3,
  director:     4,
};

/** Cor do avatar e chip por nível. */
export const ROLE_COLOR: Record<Role, string> = {
  collaborator: '#6b7280',  // gray
  leader:       '#f59e0b',  // amber
  coordinator:  '#7c3aed',  // purple
  manager:      '#0ea5e9',  // sky blue
  director:     '#E91451',  // tom/brand red
};

/** Ordem canônica dos níveis (do menor para o maior). */
export const ROLES: Role[] = [
  'collaborator',
  'leader',
  'coordinator',
  'manager',
  'director',
];

/**
 * Cargos predefinidos por nível de permissão.
 * Quando o admin muda o role, o select de function_title filtra por aqui.
 */
export const FUNCTION_TITLES: Record<Role, string[]> = {
  collaborator: ['Farmer', 'Hunter', 'Professor', 'Assistente Pedagógico', 'Financeiro', 'RH'],
  leader:       ['Líder de Equipe'],
  coordinator:  ['Coordenador'],
  manager:      ['Gerente'],
  director:     ['Diretor'],
};

/** Lista flat de todos os cargos (uso em filtros gerais). */
export const ALL_FUNCTION_TITLES: string[] = Object.values(FUNCTION_TITLES).flat();
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
# Não usar git diretamente — rodar o auto-deploy no final da Task 5
# (múltiplas tasks são agrupadas em 1 commit por eficiência)
```

> Neste projeto o git é gerenciado pelo script `scripts/auto-deploy.ps1`.
> Faça o commit **ao final de todas as tasks** executando o script.

---

## Task 2: Atualizar `GestaoEquipe.tsx`

**Files:**
- Modify: `web/src/screens/GestaoEquipe.tsx`

**Contexto:** Arquivo exibe lista de colaboradores. Tem `ROLE_COLOR` hardcoded e exibe `c.role` (string inglesa) como texto.

- [ ] **Step 1: Substituir ROLE_COLOR local e atualizar display do role**

Faça as seguintes mudanças em `D:\la-organizer\_remote\web\src\screens\GestaoEquipe.tsx`:

**a) Adicionar imports** — substitua:
```typescript
import { supabase } from '../lib/supabase';
```
por:
```typescript
import { supabase } from '../lib/supabase';
import type { Role } from '../types';
import { ROLE_COLOR, ROLE_LABELS } from '../lib/roles';
```

**b) Remover `ROLE_COLOR` local** — apague as linhas 19–25 inteiras:
```typescript
const ROLE_COLOR: Record<string, string> = {
  director:     '#E91451',
  coordinator:  '#7c3aed',
  manager:      '#0ea5e9',
  leader:       '#f59e0b',
  collaborator: '#6b7280',
};
```

**c) Atualizar tipo de `CollabRow`** — mude `role: string` para `role: Role`:
```typescript
type CollabRow = {
  id: string;
  full_name: string;
  role: Role;
  unit: string | null;
  is_active: boolean;
  avatar_url: string | null;
};
```

**d) Exibir label em português** — localize a linha que renderiza `{c.role}` (dentro do `<div className="text-body-sm text-fg-muted">`) e substitua:
```tsx
{c.role}{c.unit ? ` · ${c.unit}` : ''}
```
por:
```tsx
{ROLE_LABELS[c.role]}{c.unit ? ` · ${c.unit}` : ''}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Esperado: sem erros.

---

## Task 3: Atualizar `GestaoEquipeDetalhe.tsx`

**Files:**
- Modify: `web/src/screens/GestaoEquipeDetalhe.tsx`

**Contexto:** Tela de edição de colaborador. Tem `ROLES` e `ROLE_RANK` hardcoded (linhas 11–14). Campo `function_title` é `<input type="text">` livre. Chips de role exibem valor inglês (`{r}`).

- [ ] **Step 1: Substituir constantes locais por imports de lib/roles**

Em `D:\la-organizer\_remote\web\src\screens\GestaoEquipeDetalhe.tsx`:

**a) Substituir** a linha:
```typescript
import type { Role } from '../types';
```
por:
```typescript
import type { Role } from '../types';
import { ROLES, ROLE_RANK, ROLE_LABELS, FUNCTION_TITLES } from '../lib/roles';
```

**b) Apagar** as linhas 11–14 inteiras (constantes locais):
```typescript
const ROLES: Role[] = ['collaborator', 'leader', 'coordinator', 'manager', 'director'];
const ROLE_RANK: Record<Role, number> = {
  collaborator: 0, leader: 1, coordinator: 2, manager: 3, director: 4,
};
```

- [ ] **Step 2: Adicionar `handleRoleChange` e calcular `titleOptions`**

Logo após a linha `const allowedRoles = ROLES.filter(r => ROLE_RANK[r] <= myRank);`, adicione:

```typescript
  // Cargos disponíveis para o role selecionado
  const titleOptions = FUNCTION_TITLES[selectedRole] ?? [];
  // Se o valor salvo no banco não está na lista, inclui para não quebrar a edição
  const allTitleOptions =
    functionTitle && !titleOptions.includes(functionTitle)
      ? [functionTitle, ...titleOptions]
      : titleOptions;

  function handleRoleChange(r: Role) {
    setSelectedRole(r);
    setFunctionTitle(''); // reset cargo ao mudar nível
  }
```

- [ ] **Step 3: Trocar input text por select no campo Cargo**

Localize o bloco do campo "Cargo" (dentro de "Dados pessoais") que atualmente é:
```tsx
<div className="space-y-1">
  <label className="text-body-sm text-fg-muted">Cargo</label>
  <input type="text" value={functionTitle} onChange={e => setFunctionTitle(e.target.value)}
    placeholder="Ex: Professora de piano"
    className={inputCls} />
</div>
```

Substitua por:
```tsx
<div className="space-y-1">
  <label className="text-body-sm text-fg-muted">Cargo</label>
  <select
    value={functionTitle}
    onChange={e => setFunctionTitle(e.target.value)}
    className={inputCls}
  >
    <option value="">— selecione —</option>
    {allTitleOptions.map(t => (
      <option key={t} value={t}>{t}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 4: Exibir labels em português nos chips de role e usar `handleRoleChange`**

Localize o bloco da seção "Nível de acesso" que tem os botões de role:
```tsx
{allowedRoles.map(r => (
  <button key={r} type="button" onClick={() => setSelectedRole(r)}
    className={chipCls(selectedRole === r)}>
    {r}
  </button>
))}
```

Substitua por:
```tsx
{allowedRoles.map(r => (
  <button key={r} type="button" onClick={() => handleRoleChange(r)}
    className={chipCls(selectedRole === r)}>
    {ROLE_LABELS[r]}
  </button>
))}
```

- [ ] **Step 5: Verificar TypeScript**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Esperado: sem erros.

---

## Task 4: Atualizar `GestaoEquipeNovo.tsx`

**Files:**
- Modify: `web/src/screens/GestaoEquipeNovo.tsx`

**Contexto:** Tela de criação de colaborador. Mesma estrutura de constantes que GestaoEquipeDetalhe. Campo `function_title` também é input livre na seção "Função".

- [ ] **Step 1: Substituir constantes locais por imports de lib/roles**

Em `D:\la-organizer\_remote\web\src\screens\GestaoEquipeNovo.tsx`:

**a) Substituir** a linha:
```typescript
import type { Role } from '../types';
```
por:
```typescript
import type { Role } from '../types';
import { ROLES, ROLE_RANK, ROLE_LABELS, FUNCTION_TITLES } from '../lib/roles';
```

**b) Apagar** as linhas 9–12 inteiras:
```typescript
const ROLES: Role[] = ['collaborator', 'leader', 'coordinator', 'manager', 'director'];
const ROLE_RANK: Record<Role, number> = {
  collaborator: 0, leader: 1, coordinator: 2, manager: 3, director: 4,
};
```

- [ ] **Step 2: Adicionar `handleRoleChange` após cálculo de `allowedRoles`**

Logo após a linha `const allowedRoles = ROLES.filter(r => ROLE_RANK[r] <= myRank);`, adicione:

```typescript
  function handleRoleChange(r: Role) {
    setSelectedRole(r);
    setFunctionTitle(''); // reset cargo ao mudar nível
  }
```

- [ ] **Step 3: Trocar input text por select no campo Cargo**

Localize o bloco da seção "Função" que atualmente é:
```tsx
<div className="space-y-1">
  <label className="text-body-sm text-fg-muted">Cargo (opcional)</label>
  <input type="text" value={functionTitle}
    onChange={e => setFunctionTitle(e.target.value)}
    placeholder="Ex: Professora de piano"
    className={inputCls} />
</div>
```

Substitua por:
```tsx
<div className="space-y-1">
  <label className="text-body-sm text-fg-muted">Cargo (opcional)</label>
  <select
    value={functionTitle}
    onChange={e => setFunctionTitle(e.target.value)}
    className={inputCls}
  >
    <option value="">— selecione —</option>
    {FUNCTION_TITLES[selectedRole].map(t => (
      <option key={t} value={t}>{t}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 4: Exibir labels em português nos chips de role e usar `handleRoleChange`**

Localize o bloco da seção "Nível de acesso":
```tsx
{allowedRoles.map(r => (
  <button key={r} type="button" onClick={() => setSelectedRole(r)}
    className={chipCls(selectedRole === r)}>
    {r}
  </button>
))}
```

Substitua por:
```tsx
{allowedRoles.map(r => (
  <button key={r} type="button" onClick={() => handleRoleChange(r)}
    className={chipCls(selectedRole === r)}>
    {ROLE_LABELS[r]}
  </button>
))}
```

- [ ] **Step 5: Verificar TypeScript**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Esperado: sem erros.

---

## Task 5: Atualizar `src/prompts/system.js`

**Files:**
- Modify: `src/prompts/system.js`

**Contexto:** Função `buildContext` (linha ~177) injeta dados do colaborador no system prompt do TOM. Linha 232 atualmente usa `collab.role` cru (string inglesa). O `fn` (linha 180) já inclui `function_title` com `, ` separador.

- [ ] **Step 1: Adicionar `ROLE_LABELS_PT` e usar no prompt**

Localize dentro da função `buildContext` as linhas 180–182:
```javascript
  const fn = collab.function_title ? ', ' + collab.function_title : '';

  // Sprint 10.1: âncora temporal explícita.
```

Logo antes de `const fn = ...`, adicione:
```javascript
  const ROLE_LABELS_PT = {
    collaborator: 'Colaborador',
    leader:       'Líder',
    coordinator:  'Coordenador',
    manager:      'Gerente',
    director:     'Diretor',
  };
```

Em seguida, localize a linha 232:
```javascript
  lines.push(`**Pessoa:** ${nickname} (${collab.full_name}) — ${collab.role || '—'}${fn}`);
```

Substitua por:
```javascript
  const roleDisplay = ROLE_LABELS_PT[collab.role] || collab.role || '—';
  lines.push(`**Pessoa:** ${nickname} (${collab.full_name}) — ${roleDisplay}${fn}`);
```

Resultado esperado no prompt do TOM:
- Antes: `**Pessoa:** João (João Silva) — collaborator, Hunter`
- Depois: `**Pessoa:** João (João Silva) — Colaborador, Hunter`

- [ ] **Step 2: Build e deploy**

```bash
cd D:\la-organizer\_remote\web && npm run build
```

Esperado: `✓ built in X.XXs` sem erros.

```powershell
& "D:\la-organizer\_remote\scripts\auto-deploy.ps1"
```

Esperado: commit com mensagem `Auto-deploy YYYY-MM-DD HH:MM` e push para GitHub.

- [ ] **Step 3: Verificar no preview que os chips mostram português**

```bash
cd D:\la-organizer\_remote\web && npm run preview
```

Navegar para `http://localhost:4173/mais/gestao-equipe/novo` e confirmar:
- Chips de "Nível de acesso" mostram: `Colaborador`, `Líder`, `Coordenador`, `Gerente`, `Diretor`
- Select de "Cargo" mostra opções: `Farmer`, `Hunter`, `Professor`, `Assistente Pedagógico`, `Financeiro`, `RH` (ao nível Colaborador)
- Ao clicar em `Gerente`, o select de cargo muda para: `Gerente`

---

## Self-review (para o implementador)

Após implementar todas as tasks, verifique:

- [ ] `ROLE_COLOR`, `ROLES`, `ROLE_RANK` não existem mais como constantes locais em nenhuma das 3 telas
- [ ] `GestaoEquipe.tsx` importa de `lib/roles` e exibe `ROLE_LABELS[c.role]`
- [ ] Chips de nível de acesso em Detalhe e Novo mostram PT: Colaborador, Líder, Coordenador, Gerente, Diretor
- [ ] Select de cargo em Detalhe inclui o valor salvo no banco mesmo que não esteja na lista predefinida
- [ ] Ao trocar o role em Detalhe ou Novo, o select de cargo reseta para `— selecione —`
- [ ] `src/prompts/system.js` usa `roleDisplay` (PT) na linha do `**Pessoa:**`
- [ ] `npx tsc --noEmit` passa sem erros
- [ ] `npm run build` passa sem erros

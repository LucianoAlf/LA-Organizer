# Gestão de Equipe — Admin Panel Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar um painel administrativo no PWA para que directors, coordinators e managers possam cadastrar, editar e ativar/desativar colaboradores sem precisar acessar o Supabase Dashboard.

**Architecture:** Três novas telas React no PWA (`GestaoEquipe`, `GestaoEquipeNovo`, `GestaoEquipeDetalhe`) sob `/mais/gestao-equipe`. Uma nova Edge Function Supabase (`admin-create-collaborator`) faz a criação de usuário no Supabase Auth + insert na tabela `collaborators` + disparo de magic link pelo WhatsApp. Edição e toggle de is_active são feitos diretamente via Supabase client com RLS.

**Tech Stack:** React + TypeScript, Supabase JS client, Supabase Edge Functions (Deno), RLS policies, magic link via Edge Function `send-magic-link` já existente.

---

## Acesso e Roles

- **Quem vê o item "Gestão de equipe" em Mais:** `director`, `coordinator`, `manager`
- **Quem pode criar/editar qualquer role:** `director`
- **Quem pode criar/editar até `manager`:** `coordinator`, `manager`
- **Regra:** nenhum usuário pode promover alguém a role superior à sua própria

## Navegação

```
/mais/gestao-equipe          → GestaoEquipe (lista)
/mais/gestao-equipe/novo     → GestaoEquipeNovo (formulário de criação)
/mais/gestao-equipe/:id      → GestaoEquipeDetalhe (editar colaborador existente)
```

Rota protegida por `ProtectedRoute requireRoles={['director', 'coordinator', 'manager']}`.

Item adicionado na tela `Mais.tsx` visível apenas para essas roles.

---

## Tela 1 — GestaoEquipe (Lista)

**Arquivo:** `web/src/screens/GestaoEquipe.tsx`

**O que mostra:**
- Header: "Gestão de equipe" + botão `+ Novo` (navega para `/novo`)
- Campo de busca (filtra por nome, em tempo real, client-side)
- Filtros: chips `Todos | Ativos | Inativos`
- Lista de colaboradores: avatar com iniciais colorido por role, nome completo, role + unidade, bolinha de status (verde = ativo, cinza = inativo)
- Tap em colaborador → navega para `/:id`

**Query:** `supabase.from('collaborators').select('id, full_name, role, unit, is_active, avatar_url').order('full_name')` — sem filtro de `is_active` (mostra todos, filtra client-side).

**Cores por role:**
- `director` → vermelho brand `#E91451`
- `coordinator` → roxo `#7c3aed`
- `manager` → azul `#0ea5e9`
- `leader` → âmbar `#f59e0b`
- `collaborator` → cinza `#6b7280`

---

## Tela 2 — GestaoEquipeNovo (Criar colaborador)

**Arquivo:** `web/src/screens/GestaoEquipeNovo.tsx`

**Campos (todos obrigatórios exceto cargo e unidade):**

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `full_name` | text | ✅ | Nome completo |
| `phone` | tel (só dígitos) | ✅ | Com DDD, ex: 5521999999999 |
| `email` | email | ✅ | Deve ser único no Supabase Auth |
| `function_title` | text | ❌ | Cargo, ex: "Professora de piano" |
| `role` | chips de seleção | ✅ | collaborator / leader / coordinator / manager / director |
| `unit` | chips de seleção | ❌ | barra / recreio / campo_grande / geral |

**Restrição de role:** o admin só vê/seleciona roles até o seu próprio nível. Um `coordinator` não vê a opção `director`.

**Botão:** "Criar e enviar link WhatsApp →"

**Fluxo ao submeter:**
1. Chama Edge Function `admin-create-collaborator` (POST) com `{ full_name, phone, email, function_title, role, unit }`
2. Edge Function (com service_role key):
   a. Chama `supabase.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name } })`
   b. Insere na tabela `collaborators` todos os campos + `is_active: true, onboarding_completed: false`
   c. Chama `send-magic-link` com o `phone` para disparar o link de ativação no WhatsApp
3. PWA exibe toast de sucesso e navega de volta para a lista
4. Em caso de erro (email já existe, WhatsApp indisponível), exibe mensagem clara

---

## Tela 3 — GestaoEquipeDetalhe (Editar colaborador)

**Arquivo:** `web/src/screens/GestaoEquipeDetalhe.tsx`

**Carrega:** `supabase.from('collaborators').select('*').eq('id', params.id).single()`

**O que mostra:**
- Toggle `Conta ativa / Desativada` no topo — atualiza `is_active` inline via `supabase.from('collaborators').update({ is_active }).eq('id', id)`
- Campos editáveis: `full_name`, `phone`, `email`, `function_title`, `role` (chips), `unit` (chips)
- Botão "Salvar alterações" — faz update na tabela `collaborators`
- Botão "📱 Reenviar link WhatsApp" — chama `send-magic-link` com o phone atual
- Botão "Desativar conta" (vermelho, com confirmação modal) — set `is_active: false`

**Nota sobre email:** Se o email for alterado, atualiza só na tabela `collaborators`. Não atualiza o Supabase Auth email (complexidade desnecessária por ora — admin cria novo usuário se precisar trocar email).

---

## Edge Function — admin-create-collaborator

**Arquivo:** `supabase/functions/admin-create-collaborator/index.ts` (Deno)
**Deploy:** `supabase functions deploy admin-create-collaborator --project-ref cesnbnrynvxvgdhfmaua`

**Auth:** Verifica o JWT do request. Só processa se o `role` do chamador (lido da tabela `collaborators`) for `director`, `coordinator` ou `manager`. Rejeita com 403 caso contrário.

**Input (JSON):**
```json
{
  "full_name": "Maria Silva",
  "phone": "5521999999999",
  "email": "maria@lamusic.com.br",
  "function_title": "Professora de piano",
  "role": "collaborator",
  "unit": "barra"
}
```

**Output (sucesso):**
```json
{ "ok": true, "collaborator_id": "uuid" }
```

**Output (erro):**
```json
{ "ok": false, "error": "email_already_exists" | "phone_required" | "role_not_allowed" | "whatsapp_failed" }
```

**Segurança:** usa `SUPABASE_SERVICE_ROLE_KEY` do env (já disponível em Edge Functions). Nunca exposta ao frontend.

---

## Mudanças em RLS

> ⚠️ **Atenção ao implementar:** Já existe uma migration `rls_fixes_weekly_summaries_and_collab_update` que adicionou UPDATE policy para collaborators. O implementer deve consultar as policies existentes via `SELECT * FROM pg_policies WHERE tablename = 'collaborators'` antes de criar novas — para evitar conflito ou duplicação. Adaptar ou substituir as existentes conforme necessário.

A tabela `collaborators` precisa de uma policy UPDATE para o admin poder editar outros colaboradores:

```sql
-- Permite director/coordinator/manager atualizar colaboradores
CREATE POLICY "admin_update_collaborators"
ON collaborators FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM collaborators c
    WHERE c.email = auth.email()
    AND c.role IN ('director', 'coordinator', 'manager')
    AND c.is_active = true
  )
);

-- Permite director/coordinator/manager ver todos os colaboradores
CREATE POLICY "admin_select_all_collaborators"
ON collaborators FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM collaborators c
    WHERE c.email = auth.email()
    AND c.role IN ('director', 'coordinator', 'manager')
    AND c.is_active = true
  )
  OR email = auth.email()
);
```

---

## Mudanças no PWA

### `web/src/App.tsx`
Adicionar rotas:
```tsx
<Route element={<ProtectedRoute requireRoles={['director', 'coordinator', 'manager']} />}>
  <Route path="mais/gestao-equipe" element={<GestaoEquipe />} />
  <Route path="mais/gestao-equipe/novo" element={<GestaoEquipeNovo />} />
  <Route path="mais/gestao-equipe/:id" element={<GestaoEquipeDetalhe />} />
</Route>
```

### `web/src/screens/Mais.tsx`
Adicionar item "Gestão de equipe" visível apenas para `director`, `coordinator`, `manager`, com ícone `Users` do lucide-react.

---

## Arquivos Criados/Modificados

| Arquivo | Ação |
|---|---|
| `web/src/screens/GestaoEquipe.tsx` | Criar |
| `web/src/screens/GestaoEquipeNovo.tsx` | Criar |
| `web/src/screens/GestaoEquipeDetalhe.tsx` | Criar |
| `web/src/App.tsx` | Modificar (adicionar rotas) |
| `web/src/screens/Mais.tsx` | Modificar (adicionar item de menu) |
| `supabase/functions/admin-create-collaborator/index.ts` | Criar |
| Migration SQL | Criar (RLS policies UPDATE + SELECT admin) |

---

## Fora de Escopo (v1)

- Histórico de alterações / audit log
- Foto de perfil pelo admin (colaborador faz isso pelo MeuPerfil)
- Reset de senha pelo admin (colaborador usa "Receber link no WhatsApp")
- Painel desktop com tabela paginada (sprint futuro)
- Importação em lote (CSV)

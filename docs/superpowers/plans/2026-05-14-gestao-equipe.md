# Gestão de Equipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar painel admin no PWA para que directors/coordinators/managers possam cadastrar, editar e ativar/desativar colaboradores sem acessar o Supabase Dashboard.

**Architecture:** Três telas React novas (`GestaoEquipe`, `GestaoEquipeNovo`, `GestaoEquipeDetalhe`) em `/mais/gestao-equipe`. Uma Edge Function Supabase (`admin-create-collaborator`) cria o usuário no Auth + insere em `collaborators` + dispara magic link WhatsApp. Edição e toggle de `is_active` via Supabase client com RLS. Item no menu "Mais" visível apenas para roles admin.

**Tech Stack:** React 18 + TypeScript, TanStack React Query, Supabase JS v2, Supabase Edge Functions (Deno/TypeScript), RLS policies (PostgreSQL), Tailwind CSS (classes do design system existente).

---

## File Structure

| Arquivo | Ação |
|---|---|
| `web/src/screens/GestaoEquipe.tsx` | Criar — tela de lista |
| `web/src/screens/GestaoEquipeNovo.tsx` | Criar — formulário de criação |
| `web/src/screens/GestaoEquipeDetalhe.tsx` | Criar — tela de edição |
| `web/src/App.tsx` | Modificar — adicionar 3 rotas |
| `web/src/screens/Mais.tsx` | Modificar — adicionar item de menu |
| `supabase/functions/admin-create-collaborator/index.ts` | Criar — Edge Function |
| Migration SQL | Criar — RLS policies admin |

---

## Task 1: RLS Migration — admin SELECT e UPDATE

**Files:**
- Create: `supabase/migrations/20260514120000_admin_collaborator_policies.sql`

- [ ] **Step 1: Checar políticas existentes no Supabase**

Rode no SQL Editor do Supabase (projeto `cesnbnrynvxvgdhfmaua`):

```sql
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE tablename = 'collaborators'
ORDER BY policyname;
```

Anote os nomes das políticas existentes. As que vamos criar se chamam `collaborators_admin_select` e `collaborators_admin_update`. Se houver políticas com esses nomes, o `DROP POLICY IF EXISTS` do passo seguinte as remove antes de recriar.

- [ ] **Step 2: Criar arquivo de migration**

Crie `supabase/migrations/20260514120000_admin_collaborator_policies.sql`:

```sql
-- Sprint 23.6: Admin panel — gestão de equipe
-- Permite que directors/coordinators/managers vejam e editem TODOS os colaboradores.
-- A política existente de SELECT permite que cada usuário veja o próprio registro.
-- Esta migration ADICIONA políticas paralelas para admin — não remove as existentes.

-- SELECT: admins veem todos (ativos e inativos), usuário comum vê o próprio.
DROP POLICY IF EXISTS "collaborators_admin_select" ON collaborators;
CREATE POLICY "collaborators_admin_select" ON collaborators
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.email = auth.email()
        AND c.role IN ('director', 'coordinator', 'manager')
        AND c.is_active = true
    )
  );

-- UPDATE: admins podem atualizar qualquer colaborador.
DROP POLICY IF EXISTS "collaborators_admin_update" ON collaborators;
CREATE POLICY "collaborators_admin_update" ON collaborators
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM collaborators c
      WHERE c.email = auth.email()
        AND c.role IN ('director', 'coordinator', 'manager')
        AND c.is_active = true
    )
  )
  WITH CHECK (true);
```

- [ ] **Step 3: Aplicar a migration no Supabase**

Via MCP do Supabase (tool `apply_migration`) ou no SQL Editor. Verifique que não há erro de sintaxe.

Resultado esperado: `CREATE POLICY` executado duas vezes sem erros.

- [ ] **Step 4: Verificar que as políticas foram criadas**

```sql
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'collaborators'
ORDER BY policyname;
```

Esperado: `collaborators_admin_select` e `collaborators_admin_update` aparecem na lista.

- [ ] **Step 5: Commit**

```
git add supabase/migrations/20260514120000_admin_collaborator_policies.sql
git commit -m "feat: RLS admin policies para gestão de equipe"
```

---

## Task 2: Edge Function — admin-create-collaborator

**Files:**
- Create: `supabase/functions/admin-create-collaborator/index.ts`

- [ ] **Step 1: Criar diretório**

```bash
mkdir -p supabase/functions/admin-create-collaborator
```

- [ ] **Step 2: Criar o arquivo da função**

Crie `supabase/functions/admin-create-collaborator/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLE_RANK: Record<string, number> = {
  collaborator: 0,
  leader: 1,
  coordinator: 2,
  manager: 3,
  director: 4,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verificar identidade do chamador via JWT
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user?.email) return json({ ok: false, error: 'unauthorized' }, 401);

    // Client com service_role para operações privilegiadas
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Buscar role do chamador
    const { data: caller } = await adminClient
      .from('collaborators')
      .select('role, is_active')
      .eq('email', user.email)
      .maybeSingle();

    if (!caller?.is_active || !['director', 'coordinator', 'manager'].includes(caller.role)) {
      return json({ ok: false, error: 'role_not_allowed' }, 403);
    }

    const body = await req.json();
    const { full_name, phone, email, function_title, role, unit } = body;

    if (!full_name || !phone || !email) {
      return json({ ok: false, error: 'missing_required_fields' }, 400);
    }
    if (!role || ROLE_RANK[role] === undefined) {
      return json({ ok: false, error: 'invalid_role' }, 400);
    }
    // Chamador não pode criar role superior ao seu
    if (ROLE_RANK[role] > ROLE_RANK[caller.role]) {
      return json({ ok: false, error: 'role_not_allowed' }, 403);
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    const cleanEmail = String(email).trim().toLowerCase();

    // 1. Criar usuário no Supabase Auth
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (authErr) {
      if (authErr.message.includes('already registered') || authErr.message.includes('already exists')) {
        return json({ ok: false, error: 'email_already_exists' }, 409);
      }
      throw authErr;
    }

    // 2. Inserir na tabela collaborators
    const { error: collabErr } = await adminClient.from('collaborators').insert({
      id: authData.user.id,
      full_name: String(full_name).trim(),
      phone: cleanPhone,
      email: cleanEmail,
      function_title: function_title ? String(function_title).trim() : null,
      role,
      unit: unit || null,
      is_active: true,
      onboarding_completed: false,
    });
    if (collabErr) {
      // Rollback: remover auth user criado
      await adminClient.auth.admin.deleteUser(authData.user.id);
      throw collabErr;
    }

    // 3. Disparar magic link pelo WhatsApp
    const { error: waErr } = await adminClient.functions.invoke('send-magic-link', {
      body: { phone: cleanPhone },
    });

    return json({
      ok: true,
      collaborator_id: authData.user.id,
      whatsapp_sent: !waErr,
    });

  } catch (err) {
    console.error('[admin-create-collaborator]', err);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});
```

- [ ] **Step 3: Deploy da Edge Function**

```bash
supabase functions deploy admin-create-collaborator --project-ref cesnbnrynvxvgdhfmaua
```

Resultado esperado:
```
Deploying Function admin-create-collaborator...
Done: admin-create-collaborator
```

- [ ] **Step 4: Testar via curl**

```bash
# Substitua <ANON_KEY> e <USER_JWT> pelos valores reais
curl -X POST \
  https://cesnbnrynvxvgdhfmaua.supabase.co/functions/v1/admin-create-collaborator \
  -H "Authorization: Bearer <USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Teste Dev","phone":"5521999999999","email":"teste.dev.deleteme@lamusic.com.br","role":"collaborator"}'
```

Esperado com caller sem role admin: `{"ok":false,"error":"role_not_allowed"}`
Esperado com caller director: `{"ok":true,"collaborator_id":"..."}`

- [ ] **Step 5: Commit**

```
git add supabase/functions/admin-create-collaborator/index.ts
git commit -m "feat: Edge Function admin-create-collaborator"
```

---

## Task 3: GestaoEquipe — Tela de lista

**Files:**
- Create: `web/src/screens/GestaoEquipe.tsx`

- [ ] **Step 1: Criar o arquivo**

Crie `web/src/screens/GestaoEquipe.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';

type CollabRow = {
  id: string;
  full_name: string;
  role: string;
  unit: string | null;
  is_active: boolean;
  avatar_url: string | null;
};

const ROLE_COLOR: Record<string, string> = {
  director:     '#E91451',
  coordinator:  '#7c3aed',
  manager:      '#0ea5e9',
  leader:       '#f59e0b',
  collaborator: '#6b7280',
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

type Filter = 'all' | 'active' | 'inactive';

export function GestaoEquipe() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-collaborators'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role, unit, is_active, avatar_url')
        .order('full_name');
      if (error) throw error;
      return data as CollabRow[];
    },
  });

  const visible = (data ?? []).filter(c => {
    if (filter === 'active'   && !c.is_active) return false;
    if (filter === 'inactive' &&  c.is_active) return false;
    if (search && !c.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (isLoading) return <LoadingState />;
  if (error) return <div className="p-md text-danger">Erro ao carregar equipe.</div>;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title="Gestão de equipe"
        subtitle="Cadastre e gerencie o acesso da equipe."
        backTo="/mais"
      />

      {/* Busca + botão novo */}
      <div className="px-md flex gap-2">
        <input
          type="search"
          placeholder="Buscar colaborador..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-body-sm focus-ring outline-none"
        />
        <Link
          to="/mais/gestao-equipe/novo"
          className="h-10 w-10 grid place-items-center rounded-lg bg-tom text-white focus-ring"
          aria-label="Novo colaborador"
        >
          <Plus size={18} />
        </Link>
      </div>

      {/* Filtros */}
      <div className="px-md flex gap-2">
        {(['all', 'active', 'inactive'] as Filter[]).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-body-sm px-3 py-1 rounded-full border transition-colors ${
              filter === f
                ? 'bg-tom text-white border-tom'
                : 'bg-bg-elevated border-border text-fg-muted'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'active' ? 'Ativos' : 'Inativos'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {visible.length === 0 ? (
        <EmptyState title="Nenhum resultado" subtitle="Tente outro filtro ou nome." />
      ) : (
        <ul className="surface divide-y divide-border">
          {visible.map(c => (
            <li key={c.id}>
              <Link
                to={`/mais/gestao-equipe/${c.id}`}
                className="flex items-center gap-3 p-md hover:bg-bg-elevated focus-ring"
              >
                {/* Avatar */}
                <div
                  className="h-10 w-10 rounded-full grid place-items-center text-white text-xs font-bold shrink-0 overflow-hidden"
                  style={{ background: ROLE_COLOR[c.role] ?? '#6b7280' }}
                >
                  {c.avatar_url
                    ? <img src={c.avatar_url} alt="" className="h-full w-full object-cover" />
                    : initials(c.full_name)
                  }
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-body-md font-medium truncate">{c.full_name}</div>
                  <div className="text-body-sm text-fg-muted">
                    {c.role}{c.unit ? ` · ${c.unit}` : ''}
                  </div>
                </div>
                {/* Status dot */}
                <div className={`h-2 w-2 rounded-full shrink-0 ${c.is_active ? 'bg-green-400' : 'bg-fg-subtle'}`} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-body-sm text-fg-muted text-center px-md">
        {visible.length} colaborador{visible.length !== 1 ? 'es' : ''}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```
git add web/src/screens/GestaoEquipe.tsx
git commit -m "feat: GestaoEquipe — tela de lista de colaboradores"
```

---

## Task 4: GestaoEquipeNovo — Formulário de criação

**Files:**
- Create: `web/src/screens/GestaoEquipeNovo.tsx`

- [ ] **Step 1: Criar o arquivo**

Crie `web/src/screens/GestaoEquipeNovo.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { showToast } from '../components/Toast';
import type { Role } from '../types';

const ROLES: Role[] = ['collaborator', 'leader', 'coordinator', 'manager', 'director'];
const ROLE_RANK: Record<Role, number> = {
  collaborator: 0, leader: 1, coordinator: 2, manager: 3, director: 4,
};
const UNIT_OPTIONS = [
  { value: 'barra',        label: 'Barra' },
  { value: 'recreio',      label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
  { value: 'geral',        label: 'Geral' },
] as const;

export function GestaoEquipeNovo() {
  const { role: myRole } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const [fullName,      setFullName]      = useState('');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [functionTitle, setFunctionTitle] = useState('');
  const [selectedRole,  setSelectedRole]  = useState<Role>('collaborator');
  const [selectedUnit,  setSelectedUnit]  = useState('');

  // Admins só podem criar roles até o seu próprio nível
  const myRank = ROLE_RANK[(myRole as Role) ?? 'collaborator'] ?? 0;
  const allowedRoles = ROLES.filter(r => ROLE_RANK[r] <= myRank);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !phone.trim() || !email.trim()) {
      showToast({ kind: 'error', title: 'Preencha nome, WhatsApp e e-mail.' });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-collaborator', {
        body: {
          full_name:      fullName.trim(),
          phone:          phone.replace(/\D/g, ''),
          email:          email.trim().toLowerCase(),
          function_title: functionTitle.trim() || null,
          role:           selectedRole,
          unit:           selectedUnit || null,
        },
      });
      if (error || !data?.ok) {
        const msg =
          data?.error === 'email_already_exists' ? 'Esse e-mail já está cadastrado.'
          : data?.error === 'role_not_allowed'   ? 'Você não tem permissão para criar esse cargo.'
          : data?.error === 'missing_required_fields' ? 'Preencha todos os campos obrigatórios.'
          : 'Erro ao criar colaborador. Tente novamente.';
        showToast({ kind: 'error', title: msg });
        return;
      }
      const extra = data.whatsapp_sent ? '' : ' (link WhatsApp não enviado — verifique o número)';
      showToast({ kind: 'success', title: `Colaborador criado!${extra}` });
      navigate('/mais/gestao-equipe');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none';
  const chipCls  = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-body-sm font-medium border transition-colors ${
      active ? 'bg-tom text-white border-tom' : 'bg-bg-elevated border-border text-fg'
    }`;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader title="Novo colaborador" backTo="/mais/gestao-equipe" />

      <form onSubmit={handleSubmit} className="space-y-lg">
        {/* Dados pessoais */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Dados pessoais</h2>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">Nome completo *</label>
            <input type="text" required value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ex: Maria Silva"
              className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">WhatsApp * (só dígitos com DDD)</label>
            <input type="tel" inputMode="numeric" required value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="5521999999999"
              className={`${inputCls} tabular-nums`} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">E-mail *</label>
            <input type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="maria@lamusic.com.br"
              className={inputCls} />
          </div>
        </section>

        {/* Função */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Função</h2>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">Cargo (opcional)</label>
            <input type="text" value={functionTitle}
              onChange={e => setFunctionTitle(e.target.value)}
              placeholder="Ex: Professora de piano"
              className={inputCls} />
          </div>
        </section>

        {/* Acesso */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Nível de acesso</h2>
          <div className="flex flex-wrap gap-2">
            {allowedRoles.map(r => (
              <button key={r} type="button" onClick={() => setSelectedRole(r)}
                className={chipCls(selectedRole === r)}>
                {r}
              </button>
            ))}
          </div>
        </section>

        {/* Unidade */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Unidade (opcional)</h2>
          <div className="flex flex-wrap gap-2">
            {UNIT_OPTIONS.map(u => (
              <button key={u.value} type="button"
                onClick={() => setSelectedUnit(selectedUnit === u.value ? '' : u.value)}
                className={chipCls(selectedUnit === u.value)}>
                {u.label}
              </button>
            ))}
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-tom text-white font-semibold text-body-md disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {saving ? 'Criando...' : 'Criar e enviar link WhatsApp →'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```
git add web/src/screens/GestaoEquipeNovo.tsx
git commit -m "feat: GestaoEquipeNovo — formulário de criação de colaborador"
```

---

## Task 5: GestaoEquipeDetalhe — Editar colaborador

**Files:**
- Create: `web/src/screens/GestaoEquipeDetalhe.tsx`

- [ ] **Step 1: Criar o arquivo**

Crie `web/src/screens/GestaoEquipeDetalhe.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { showToast } from '../components/Toast';
import type { Role } from '../types';

const ROLES: Role[] = ['collaborator', 'leader', 'coordinator', 'manager', 'director'];
const ROLE_RANK: Record<Role, number> = {
  collaborator: 0, leader: 1, coordinator: 2, manager: 3, director: 4,
};
const UNIT_OPTIONS = [
  { value: 'barra',        label: 'Barra' },
  { value: 'recreio',      label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
  { value: 'geral',        label: 'Geral' },
] as const;

type CollabFull = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  unit: string | null;
  function_title: string | null;
  is_active: boolean;
  onboarding_completed: boolean;
  avatar_url: string | null;
};

export function GestaoEquipeDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role: myRole } = useAuth();
  const queryClient = useQueryClient();

  const { data: collab, isLoading } = useQuery({
    queryKey: ['admin-collaborator', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as CollabFull;
    },
    enabled: !!id,
  });

  // Form state
  const [fullName,      setFullName]      = useState('');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [functionTitle, setFunctionTitle] = useState('');
  const [selectedRole,  setSelectedRole]  = useState<Role>('collaborator');
  const [selectedUnit,  setSelectedUnit]  = useState('');
  const [isActive,      setIsActive]      = useState(true);

  useEffect(() => {
    if (collab) {
      setFullName(collab.full_name);
      setPhone(collab.phone ?? '');
      setEmail(collab.email ?? '');
      setFunctionTitle(collab.function_title ?? '');
      setSelectedRole(collab.role);
      setSelectedUnit(collab.unit ?? '');
      setIsActive(collab.is_active);
    }
  }, [collab]);

  const myRank = ROLE_RANK[(myRole as Role) ?? 'collaborator'] ?? 0;
  const allowedRoles = ROLES.filter(r => ROLE_RANK[r] <= myRank);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('collaborators')
        .update({
          full_name:      fullName.trim(),
          phone:          phone.replace(/\D/g, '') || null,
          email:          email.trim().toLowerCase() || null,
          function_title: functionTitle.trim() || null,
          role:           selectedRole,
          unit:           selectedUnit || null,
          is_active:      isActive,
        })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-collaborators'] });
      queryClient.invalidateQueries({ queryKey: ['admin-collaborator', id] });
      showToast({ kind: 'success', title: 'Alterações salvas!' });
    },
    onError: (err: Error) =>
      showToast({ kind: 'error', title: 'Erro ao salvar', msg: err.message }),
  });

  const [resending, setResending] = useState(false);
  async function handleResendLink() {
    const phoneToUse = phone.replace(/\D/g, '') || collab?.phone?.replace(/\D/g, '');
    if (!phoneToUse) {
      showToast({ kind: 'error', title: 'Sem WhatsApp cadastrado.' });
      return;
    }
    setResending(true);
    const { data, error } = await supabase.functions.invoke('send-magic-link', {
      body: { phone: phoneToUse },
    });
    setResending(false);
    if (error || !data?.ok) {
      showToast({ kind: 'error', title: 'Não consegui enviar o link.' });
      return;
    }
    showToast({ kind: 'success', title: 'Link enviado no WhatsApp!' });
  }

  const [deactivating, setDeactivating] = useState(false);
  async function handleDeactivate() {
    if (!confirm(`Desativar ${collab?.full_name}? Ela/ele perderá acesso imediatamente.`)) return;
    setDeactivating(true);
    const { error } = await supabase
      .from('collaborators')
      .update({ is_active: false })
      .eq('id', id!);
    setDeactivating(false);
    if (error) {
      showToast({ kind: 'error', title: 'Erro ao desativar.' });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['admin-collaborators'] });
    showToast({ kind: 'success', title: 'Conta desativada.' });
    navigate('/mais/gestao-equipe');
  }

  if (isLoading) return <LoadingState />;
  if (!collab) return <div className="p-md text-danger">Colaborador não encontrado.</div>;

  const inputCls = 'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none';
  const chipCls  = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-body-sm font-medium border transition-colors ${
      active ? 'bg-tom text-white border-tom' : 'bg-bg-elevated border-border text-fg'
    }`;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title={collab.full_name}
        subtitle="Editar colaborador"
        backTo="/mais/gestao-equipe"
      />

      {/* Toggle ativo/inativo */}
      <section className="surface p-lg">
        <div className="flex items-center justify-between gap-md">
          <div>
            <div className="text-body-md font-medium">
              {isActive ? '✅ Conta ativa' : '⚪ Conta inativa'}
            </div>
            <div className="text-body-sm text-fg-muted">
              {isActive ? 'Tem acesso ao app' : 'Sem acesso ao app'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsActive(a => !a)}
            aria-label={isActive ? 'Desativar conta' : 'Ativar conta'}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${
              isActive ? 'bg-green-400' : 'bg-fg-subtle'
            }`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
              isActive ? 'right-1' : 'left-1'
            }`} />
          </button>
        </div>
      </section>

      {/* Formulário */}
      <form
        onSubmit={e => { e.preventDefault(); saveMutation.mutate(); }}
        className="space-y-lg"
      >
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Dados pessoais</h2>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">Nome completo</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">WhatsApp (só dígitos)</label>
            <input type="tel" inputMode="numeric" value={phone}
              onChange={e => setPhone(e.target.value)}
              className={`${inputCls} tabular-nums`} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">E-mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className={inputCls} />
            <p className="text-body-sm text-fg-muted">
              Alterar e-mail aqui atualiza só o cadastro, não a credencial de login.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">Cargo</label>
            <input type="text" value={functionTitle} onChange={e => setFunctionTitle(e.target.value)}
              placeholder="Ex: Professora de piano"
              className={inputCls} />
          </div>
        </section>

        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Nível de acesso</h2>
          <div className="flex flex-wrap gap-2">
            {allowedRoles.map(r => (
              <button key={r} type="button" onClick={() => setSelectedRole(r)}
                className={chipCls(selectedRole === r)}>
                {r}
              </button>
            ))}
          </div>
        </section>

        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Unidade</h2>
          <div className="flex flex-wrap gap-2">
            {UNIT_OPTIONS.map(u => (
              <button key={u.value} type="button"
                onClick={() => setSelectedUnit(selectedUnit === u.value ? '' : u.value)}
                className={chipCls(selectedUnit === u.value)}>
                {u.label}
              </button>
            ))}
          </div>
        </section>

        <button type="submit" disabled={saveMutation.isPending}
          className="w-full py-3 rounded-xl bg-tom text-white font-semibold text-body-md disabled:opacity-50 hover:opacity-90 transition-opacity">
          {saveMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </form>

      {/* Ações secundárias */}
      <div className="space-y-3 px-md">
        <button type="button" onClick={handleResendLink} disabled={resending}
          className="w-full py-3 rounded-xl border border-green-500 text-green-500 font-semibold text-body-md disabled:opacity-50 hover:bg-green-500/10 transition-colors">
          {resending ? 'Enviando...' : '📱 Reenviar link WhatsApp'}
        </button>

        {collab.is_active && (
          <button type="button" onClick={handleDeactivate} disabled={deactivating}
            className="w-full py-3 rounded-xl border border-danger text-danger font-semibold text-body-md disabled:opacity-50 hover:bg-danger/10 transition-colors">
            {deactivating ? 'Desativando...' : 'Desativar conta'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```
git add web/src/screens/GestaoEquipeDetalhe.tsx
git commit -m "feat: GestaoEquipeDetalhe — tela de edição de colaborador"
```

---

## Task 6: Wiring — Rotas + item de menu

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/screens/Mais.tsx`

- [ ] **Step 1: Adicionar imports em App.tsx**

Em `web/src/App.tsx`, adicione os três imports após a linha do `MeuPerfil`:

```tsx
import { MeuPerfil } from './screens/MeuPerfil';
// Adicionar após:
import { GestaoEquipe } from './screens/GestaoEquipe';
import { GestaoEquipeNovo } from './screens/GestaoEquipeNovo';
import { GestaoEquipeDetalhe } from './screens/GestaoEquipeDetalhe';
```

- [ ] **Step 2: Adicionar rotas em App.tsx**

Dentro do bloco de rotas protegidas com `requireRoles={['director', 'coordinator']}`, adicione ANTES desse bloco um novo bloco:

```tsx
          {/* Sprint 23.6 — Gestão de equipe (admin panel) */}
          <Route element={<ProtectedRoute requireRoles={['director', 'coordinator', 'manager']} />}>
            <Route path="mais/gestao-equipe" element={<GestaoEquipe />} />
            <Route path="mais/gestao-equipe/novo" element={<GestaoEquipeNovo />} />
            <Route path="mais/gestao-equipe/:id" element={<GestaoEquipeDetalhe />} />
          </Route>
```

O bloco deve ficar antes da linha:
```tsx
          <Route element={<ProtectedRoute requireRoles={['director', 'coordinator']} />}>
```

- [ ] **Step 3: Adicionar item no menu Mais.tsx**

Em `web/src/screens/Mais.tsx`, adicione ao array `coordItems`:

```tsx
const coordItems: Item[] = [
  { to: '/time', label: 'Dashboard do time', hint: 'Coordenação · trabalho', requireRoles: ['coordinator', 'director'] },
  { to: '/mais/aderencia-checklists', label: 'Aderência operacional', hint: 'Checklists por colaborador', requireRoles: ['director', 'manager'] },
  { to: '/mais/operacoes', label: 'Operações', hint: 'Demandas operacionais por departamento', requireRoles: ['director', 'coordinator', 'manager'] },
  { to: '/mais/comunicados', label: 'Comunicados', hint: 'Anúncios para a equipe', requireRoles: ['director', 'coordinator'] },
  { to: '/mais/observabilidade', label: 'Observabilidade', hint: 'Aprovações e métricas de envio', requireRoles: ['director', 'coordinator'] },
  // Sprint 23.6
  { to: '/mais/gestao-equipe', label: 'Gestão de equipe', hint: 'Cadastrar e gerenciar colaboradores', requireRoles: ['director', 'coordinator', 'manager'] },
];
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 5: Build local**

```bash
cd web && npx vite build
```

Esperado: `✓ built in X.XXs` sem erros.

- [ ] **Step 6: Smoke test no preview**

Abrir `http://localhost:4173` no Simple Browser. Navegar em "Mais" e verificar que "Gestão de equipe" aparece. Clicar no item e confirmar que a lista carrega sem erro.

- [ ] **Step 7: Commit final**

```
git add web/src/App.tsx web/src/screens/Mais.tsx
git commit -m "feat: wiring gestão de equipe — rotas + menu Mais"
```

---

## Self-review checklist

**Cobertura do spec:**
- ✅ `/mais/gestao-equipe` → GestaoEquipe (Task 3)
- ✅ `/mais/gestao-equipe/novo` → GestaoEquipeNovo (Task 4)
- ✅ `/mais/gestao-equipe/:id` → GestaoEquipeDetalhe (Task 5)
- ✅ Edge Function admin-create-collaborator (Task 2)
- ✅ RLS policies admin SELECT + UPDATE (Task 1)
- ✅ Item em Mais.tsx (Task 6)
- ✅ Rotas em App.tsx (Task 6)
- ✅ Restrição de role ao criar/editar (allowedRoles filter)
- ✅ Toggle is_active (GestaoEquipeDetalhe)
- ✅ Reenviar link WhatsApp (GestaoEquipeDetalhe)
- ✅ Desativar conta com confirmação (GestaoEquipeDetalhe)
- ✅ Rollback de auth user se insert em collaborators falhar (Edge Function)

**Consistência de tipos:**
- `CollabRow` em GestaoEquipe e `CollabFull` em GestaoEquipeDetalhe são distintos e coerentes
- `ROLE_RANK` e `ROLES` definidos identicamente em GestaoEquipeNovo e GestaoEquipeDetalhe
- `UNIT_OPTIONS` idênticos em ambos os formulários
- `chipCls` helper idêntico em ambos os formulários

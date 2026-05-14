# Onboarding Wizard PWA + TOM Proativo — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizard visual de 4 telas no PWA (personalizado por cargo) que aparece no primeiro login e termina acionando o TOM proativamente no WhatsApp.

**Architecture:** `OnboardingWizard.tsx` é renderizado por `AppShell.tsx` quando `collaborator.onboarding_completed === false` e localStorage não tem flag de dismissal. Tela 4 chama Edge Function `send-onboarding-message` que envia mensagem via UZapi, depois abre `wa.me/5521997243082`. `onboarding_completed = true` é setado pelo TOM após as 5 perguntas (lógica existente preservada).

**Tech Stack:** React/TypeScript, Supabase Edge Functions (Deno), UZapi (WhatsApp)

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `web/src/lib/onboarding.ts` | Criar — mapeamento de conteúdo por cargo |
| `web/src/components/OnboardingWizard.tsx` | Criar — wizard completo |
| `web/src/components/AppShell.tsx` | Modificar — renderizar wizard quando necessário |
| `supabase/functions/send-onboarding-message/index.ts` | Criar — Edge Function proativa |
| `skills/onboarding.md` | Modificar — melhorar boas-vindas inicial |

---

## Task 1: Criar `web/src/lib/onboarding.ts`

**Files:**
- Create: `web/src/lib/onboarding.ts`

- [ ] **Step 1: Criar o arquivo de conteúdo por cargo**

Crie `D:\la-organizer\_remote\web\src\lib\onboarding.ts`:

```typescript
// Conteúdo da tela 2 do wizard — personalizado por function_title.
// Mapeamento: function_title → {icon, title, subtitle, chips}

export interface OnboardingSlide2 {
  icon: string;
  title: string;
  subtitle: string;
  chips: Array<{ label: string; highlight: boolean }>;
}

const CONTENT: Record<string, OnboardingSlide2> = {
  Farmer: {
    icon: '📋',
    title: 'Seu pipeline e metas em um lugar só',
    subtitle: 'Registra leads, acompanha negociações e nunca perde um follow-up.',
    chips: [
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📊 Projetos',  highlight: true  },
      { label: '📅 Agenda',    highlight: false },
      { label: '📋 Checklists',highlight: false },
    ],
  },
  Hunter: {
    icon: '📋',
    title: 'Seu pipeline e metas em um lugar só',
    subtitle: 'Registra leads, acompanha negociações e nunca perde um follow-up.',
    chips: [
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📊 Projetos',  highlight: true  },
      { label: '📅 Agenda',    highlight: false },
      { label: '📋 Checklists',highlight: false },
    ],
  },
  Professor: {
    icon: '📚',
    title: 'Suas aulas e agenda em um lugar só',
    subtitle: 'Agenda de aulas, lembretes e checklists de rotina num só lugar.',
    chips: [
      { label: '📅 Agenda',     highlight: true  },
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: false },
      { label: '📊 Projetos',   highlight: false },
    ],
  },
  'Assistente Pedagógico': {
    icon: '🎓',
    title: 'Seus checklists e operação em um lugar só',
    subtitle: 'Checklists diários, tarefas e apoio à equipe pedagógica.',
    chips: [
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📊 Projetos',   highlight: false },
    ],
  },
  Financeiro: {
    icon: '💰',
    title: 'Seus projetos e demandas em um lugar só',
    subtitle: 'Acompanha demandas, tarefas e prazos sem perder nada.',
    chips: [
      { label: '📊 Projetos',   highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📋 Checklists', highlight: false },
    ],
  },
  RH: {
    icon: '👥',
    title: 'Seus projetos e demandas em um lugar só',
    subtitle: 'Acompanha demandas, tarefas e prazos sem perder nada.',
    chips: [
      { label: '📊 Projetos',   highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📋 Checklists', highlight: false },
    ],
  },
  Gerente: {
    icon: '🏢',
    title: 'Seu time e operação em um lugar só',
    subtitle: 'Gestão de equipe, projetos, checklists e indicadores reunidos.',
    chips: [
      { label: '👥 Equipe',     highlight: true  },
      { label: '📊 Projetos',   highlight: true  },
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: false },
    ],
  },
  Coordenador: {
    icon: '🏢',
    title: 'Seu time e operação em um lugar só',
    subtitle: 'Gestão de equipe, projetos, checklists e indicadores reunidos.',
    chips: [
      { label: '👥 Equipe',     highlight: true  },
      { label: '📊 Projetos',   highlight: true  },
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: false },
    ],
  },
  Diretor: {
    icon: '🎯',
    title: 'Visão completa da operação da LA',
    subtitle: 'Time, projetos, checklists e indicadores em um painel só.',
    chips: [
      { label: '👥 Equipe',     highlight: true  },
      { label: '📊 Projetos',   highlight: true  },
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: false },
    ],
  },
};

const DEFAULT: OnboardingSlide2 = {
  icon: '📋',
  title: 'Suas tarefas e agenda em um lugar só',
  subtitle: 'Tarefas, lembretes e checklists — tudo num só lugar.',
  chips: [
    { label: '✅ Tarefas', highlight: true  },
    { label: '📅 Agenda',  highlight: true  },
    { label: '📊 Projetos',highlight: false },
    { label: '📋 Checklists', highlight: false },
  ],
};

export function getOnboardingSlide2(functionTitle: string | null): OnboardingSlide2 {
  if (!functionTitle) return DEFAULT;
  return CONTENT[functionTitle] ?? DEFAULT;
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Esperado: sem erros.

---

## Task 2: Criar `web/src/components/OnboardingWizard.tsx`

**Files:**
- Create: `web/src/components/OnboardingWizard.tsx`

- [ ] **Step 1: Criar o componente completo**

Crie `D:\la-organizer\_remote\web\src\components\OnboardingWizard.tsx`:

```tsx
// OnboardingWizard — 4 telas de boas-vindas mostradas no primeiro acesso.
// Disparado por AppShell quando collaborator.onboarding_completed === false
// e localStorage não tem 'onboarding_wizard_dismissed_v1'.
// A tela 4 aciona a Edge Function send-onboarding-message e abre WhatsApp.
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getOnboardingSlide2, type OnboardingSlide2 } from '../lib/onboarding';

export const WIZARD_DISMISSED_KEY = 'onboarding_wizard_dismissed_v1';
const TOM_WA = '5521997243082';

interface Props {
  onDismiss: () => void;
}

export function OnboardingWizard({ onDismiss }: Props) {
  const { collaborator } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const name =
    collaborator?.preferred_name ??
    (collaborator?.full_name?.split(' ')[0] || 'você');

  const slide2 = getOnboardingSlide2(collaborator?.function_title ?? null);

  function dismiss() {
    localStorage.setItem(WIZARD_DISMISSED_KEY, 'true');
    onDismiss();
  }

  function skipToEnd() {
    setStep(3);
  }

  async function handleWhatsApp() {
    setLoading(true);
    try {
      await supabase.functions.invoke('send-onboarding-message');
    } catch {
      // Silent fail — WhatsApp ainda abre mesmo se Edge Function falhar
    }
    window.open(`https://wa.me/${TOM_WA}`, '_blank');
    setLoading(false);
    dismiss();
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg-app flex flex-col items-center justify-between px-lg py-xl">
      {/* Skip link — aparece nas telas 1-3 */}
      {step < 3 && (
        <div className="w-full flex justify-end">
          <button
            type="button"
            onClick={skipToEnd}
            className="text-fg-muted text-body-sm focus-ring rounded-md px-2 py-1"
          >
            Pular
          </button>
        </div>
      )}
      {step === 3 && <div className="h-7" />}

      {/* Conteúdo da tela */}
      <div className="flex-1 w-full max-w-sm flex flex-col items-center justify-center">
        {step === 0 && <WelcomeScreen name={name} />}
        {step === 1 && (
          <AppScreen slide={slide2} functionTitle={collaborator?.function_title ?? null} />
        )}
        {step === 2 && <TomScreen />}
        {step === 3 && (
          <WhatsAppScreen loading={loading} onWhatsApp={handleWhatsApp} onLater={dismiss} />
        )}
      </div>

      {/* Dots de progresso + botão Próximo */}
      <div className="w-full max-w-sm space-y-md">
        <Dots current={step} total={4} />
        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            className="w-full h-12 rounded-xl bg-tom text-white font-semibold text-body-md focus-ring"
          >
            Próximo →
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-telas ──────────────────────────────────────────────────────────── */

function WelcomeScreen({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-lg">
      <img
        src="/tom-avatar.png"
        alt="TOM"
        className="h-36 w-36 object-contain select-none"
        style={{ filter: 'drop-shadow(0 0 32px rgba(233,20,81,0.25))' }}
        draggable={false}
      />
      <div className="space-y-2">
        <h1
          className="text-2xl font-black text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          Oi, {name}! Eu sou o TOM 👽
        </h1>
        <p className="text-fg-muted text-body-md">
          Seu assistente operacional da LA Music.
          Tô aqui pra te ajudar no dia a dia.
        </p>
      </div>
    </div>
  );
}

function AppScreen({
  slide,
  functionTitle,
}: {
  slide: OnboardingSlide2;
  functionTitle: string | null;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-md w-full">
      <div className="text-5xl">{slide.icon}</div>
      {functionTitle && (
        <div className="bg-tom/10 border border-tom/30 rounded-lg px-3 py-1 text-tom text-body-sm">
          🎯 Personalizado para: {functionTitle}
        </div>
      )}
      <div className="space-y-1">
        <h2
          className="text-xl font-bold text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          {slide.title}
        </h2>
        <p className="text-fg-muted text-body-sm">{slide.subtitle}</p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {slide.chips.map(chip => (
          <span
            key={chip.label}
            className={`px-3 py-1 rounded-full text-body-sm border ${
              chip.highlight
                ? 'border-tom text-tom bg-tom/10'
                : 'border-border text-fg-muted bg-bg-elevated'
            }`}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TomScreen() {
  return (
    <div className="flex flex-col gap-md w-full">
      {/* Balões de conversa estilo WhatsApp */}
      <div className="flex items-start gap-2">
        <img
          src="/tom-avatar.png"
          alt="TOM"
          className="h-8 w-8 object-contain shrink-0 mt-1"
          draggable={false}
        />
        <div className="bg-bg-elevated border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-body-sm text-fg">
          Manda mensagem pra mim no WhatsApp. Eu gerencio suas tarefas,
          te aviso dos rituais e cobro o que tá pendente 😅
        </div>
      </div>
      <div className="flex items-start gap-2">
        <img
          src="/tom-avatar.png"
          alt="TOM"
          className="h-8 w-8 object-contain shrink-0 mt-1"
          draggable={false}
        />
        <div className="bg-bg-elevated border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-body-sm text-fg">
          E também te ajudo com sua vida pessoal — hábitos,
          lembretes particulares, agenda. Fica entre a gente 🤐
        </div>
      </div>
      <div className="text-center mt-2 space-y-1">
        <h2
          className="text-xl font-bold text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          Fala comigo no WhatsApp
        </h2>
        <p className="text-fg-muted text-body-sm">
          Sem app extra — só mensagem natural.
        </p>
      </div>
    </div>
  );
}

function WhatsAppScreen({
  loading,
  onWhatsApp,
  onLater,
}: {
  loading: boolean;
  onWhatsApp: () => void;
  onLater: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-lg w-full">
      <div className="relative">
        <img
          src="/tom-avatar.png"
          alt="TOM"
          className="h-32 w-32 object-contain select-none"
          style={{ filter: 'drop-shadow(0 0 32px rgba(233,20,81,0.25))' }}
          draggable={false}
        />
        <span className="absolute -bottom-2 -right-2 text-3xl">💬</span>
      </div>
      <div className="space-y-2">
        <h2
          className="text-xl font-bold text-fg"
          style={{ fontFamily: 'Prompt, sans-serif' }}
        >
          Tudo pronto! Me chama no WhatsApp 🎉
        </h2>
        <p className="text-fg-muted text-body-sm">
          Salva meu contato e manda um "Oi" — eu cuido do resto.
        </p>
      </div>
      <div className="w-full space-y-3">
        <button
          type="button"
          onClick={onWhatsApp}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-[#25D366] text-white font-semibold text-body-md flex items-center justify-center gap-2 focus-ring disabled:opacity-50"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          {loading ? 'Conectando...' : 'Falar com o TOM agora'}
        </button>
        <button
          type="button"
          onClick={onLater}
          className="w-full text-fg-muted text-body-sm focus-ring rounded-md py-2"
        >
          Fazer isso depois
        </button>
      </div>
    </div>
  );
}

/* ─── Dots ───────────────────────────────────────────────────────────────── */

function Dots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === current ? 'w-5 bg-tom' : 'w-1.5 bg-border'
          }`}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Esperado: sem erros.

---

## Task 3: Modificar `web/src/components/AppShell.tsx`

**Files:**
- Modify: `web/src/components/AppShell.tsx`

- [ ] **Step 1: Ler o arquivo atual**

Leia `D:\la-organizer\_remote\web\src\components\AppShell.tsx` para confirmar o conteúdo atual antes de editar.

- [ ] **Step 2: Adicionar imports e lógica do wizard**

Substitua o conteúdo do arquivo por:

```tsx
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { AgendaTabs } from './AgendaTabs';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { ToastHost } from './Toast';
import { OnboardingWizard, WIZARD_DISMISSED_KEY } from './OnboardingWizard';
import { useAuth } from '../contexts/AuthContext';

const FOCUSED_FLOW_PATHS = ['/projetos/novo'];
const AGENDA_PATHS = ['/hoje', '/semana'];

function isFocusedFlow(pathname: string): boolean {
  return FOCUSED_FLOW_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isAgendaRoute(pathname: string): boolean {
  return AGENDA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function AppShell() {
  const { pathname } = useLocation();
  const { collaborator } = useAuth();
  const focused = isFocusedFlow(pathname);
  const showAgendaTabs = isAgendaRoute(pathname);

  // Wizard: mostra se onboarding não concluído E usuário ainda não dispensou nesta sessão/localStorage
  const [wizardDismissed, setWizardDismissed] = useState(
    () => localStorage.getItem(WIZARD_DISMISSED_KEY) === 'true'
  );

  const showWizard =
    collaborator !== null &&
    !collaborator.onboarding_completed &&
    !wizardDismissed;

  if (showWizard) {
    return <OnboardingWizard onDismiss={() => setWizardDismissed(true)} />;
  }

  return (
    <div className="min-h-screen bg-bg-app text-fg flex flex-col">
      <Header />
      {/* AgendaTabs renderizado no shell para a MESMA instância persistir entre
          /hoje ↔ /semana — sem isso o indicador deslizante não anima (re-render
          em cada rota destrói o elemento antes da transição rodar). */}
      {showAgendaTabs && (
        <div className="w-full max-w-content mx-auto px-md pt-md">
          <AgendaTabs />
        </div>
      )}
      <main
        className={[
          'flex-1 w-full max-w-content mx-auto px-md',
          showAgendaTabs ? 'pt-md' : 'pt-md',
          focused ? 'pb-md' : 'pb-[88px] md:pb-md',
        ].join(' ')}
      >
        <Outlet />
      </main>
      {!focused && <BottomNav />}
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      <ToastHost />
    </div>
  );
}
```

- [ ] **Step 3: Verificar TypeScript e build**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit && npm run build 2>&1 | tail -5
```

Esperado: `✓ built in X.XXs` sem erros.

---

## Task 4: Criar Edge Function `send-onboarding-message`

**Files:**
- Create: `supabase/functions/send-onboarding-message/index.ts`

- [ ] **Step 1: Verificar se o diretório existe**

```bash
ls "D:\la-organizer\_remote\supabase\functions\"
```

Esperado: listagem com `admin-create-collaborator/` e outros diretórios.

- [ ] **Step 2: Criar a Edge Function**

Crie `D:\la-organizer\_remote\supabase\functions\send-onboarding-message\index.ts`:

```typescript
// Edge Function: send-onboarding-message
// Dispara mensagem proativa do TOM para o colaborador que acabou de tocar
// em "Falar com o TOM agora" no wizard PWA.
// Chamada via: supabase.functions.invoke('send-onboarding-message')
// Env vars necessárias no Supabase Dashboard → Settings → Edge Functions:
//   UAZAPI_URL   — ex: https://lamusic.uazapi.com
//   UAZAPI_TOKEN — token da instância

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const uazapiUrl   = Deno.env.get('UAZAPI_URL')!;
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN')!;

  // Identifica o usuário pelo JWT
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  // Busca dados do colaborador (phone + nome)
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: collab, error: collabErr } = await adminClient
    .from('collaborators')
    .select('phone, full_name, preferred_name, function_title, role')
    .eq('email', user.email!)
    .single();

  if (collabErr || !collab) return json({ error: 'collaborator_not_found' }, 404);
  if (!collab.phone) return json({ error: 'no_phone' }, 400);

  // Nome de tratamento
  const name =
    (collab.preferred_name as string | null) ??
    ((collab.full_name as string).split(' ')[0]);

  // Mensagem de boas-vindas proativa
  const msg =
    `👽 Oi, ${name}! Aqui é o TOM — seu assistente operacional da LA Music.\n\n` +
    `Tô aqui pra te ajudar no dia a dia: tarefas, agenda, projetos e checklists.\n` +
    `E também pra organizar sua vida pessoal 🤐 — hábitos, lembretes particulares, o que você quiser.\n\n` +
    `📲 Salva meu contato como *TOM - LA* e me manda um "Oi" quando quiser.\n\n` +
    `Agora, pra te atender melhor, preciso de uns minutinhos pra entender suas preferências. Pode ser?`;

  // Envia via UZapi (mesmo formato de src/services/whatsapp.js)
  const waRes = await fetch(`${uazapiUrl}/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: uazapiToken,
    },
    body: JSON.stringify({
      number: collab.phone as string,
      text: msg,
      readchat: true,
    }),
  });

  if (!waRes.ok) {
    const errBody = await waRes.text().catch(() => '');
    console.error('[send-onboarding-message] UZapi error:', waRes.status, errBody);
    return json({ error: 'whatsapp_failed' }, 500);
  }

  return json({ ok: true });
});
```

- [ ] **Step 3: Configurar env vars no Supabase**

No Supabase Dashboard → Settings → Edge Functions → Secrets, confirmar que existem:
- `UAZAPI_URL` — URL base da instância UZapi (mesma usada no VPS)
- `UAZAPI_TOKEN` — token de autenticação

Se não existirem, adicionar com os mesmos valores do `.env` do VPS.

- [ ] **Step 4: Deploy da Edge Function**

```bash
# Via Supabase CLI (se disponível):
cd D:\la-organizer\_remote && npx supabase functions deploy send-onboarding-message
```

Se o CLI não estiver configurado, o deploy pode ser feito via Supabase Dashboard → Edge Functions → New Function.

---

## Task 5: Melhorar `skills/onboarding.md`

**Files:**
- Modify: `skills/onboarding.md`

- [ ] **Step 1: Ler o arquivo atual**

Leia `D:\la-organizer\_remote\skills\onboarding.md` — identifique onde começa o texto da primeira pergunta.

- [ ] **Step 2: Adicionar introdução antes da pergunta 1**

No início da seção de conteúdo da skill (antes da primeira pergunta), adicione este bloco de abertura que o TOM deve enviar como primeira mensagem quando ativa o onboarding:

```markdown
## Mensagem de abertura (enviar ANTES das perguntas)

Ao iniciar o onboarding, envie esta mensagem de boas-vindas ANTES de fazer a primeira pergunta:

> 👽 Boa-vinda ao time, [nome]! Aqui é o TOM.
>
> Acabei de ver que você entrou — fico feliz em te conhecer! Tô aqui pra te ajudar a se organizar no trabalho e na vida pessoal.
>
> Antes de começar, preciso de uns minutinhos pra entender como você prefere trabalhar. São só 5 perguntinhas rápidas, pode ser?

Aguarde o usuário responder qualquer coisa afirmativa (sim, pode, bora, etc.) antes de fazer a pergunta 1.
```

- [ ] **Step 3: Verificar que o arquivo está correto**

```bash
node --check D:\la-organizer\_remote\src\engine.js
```

Esperado: sem erros de sintaxe.

---

## Task 6: Build final + auto-deploy frontend

- [ ] **Step 1: Build com verificação**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit && npm run build 2>&1 | tail -6
```

Esperado: `✓ built in X.XXs` sem erros TypeScript.

- [ ] **Step 2: Auto-deploy (commit + push → Vercel)**

```powershell
& "D:\la-organizer\_remote\scripts\auto-deploy.ps1"
git -C "C:\la-deploy-work" log --oneline -1
```

Esperado: novo commit com 5 arquivos modificados.

- [ ] **Step 3: Verificação manual**

Após Vercel buildar (~2min):
1. Abrir `la-organizer.vercel.app` como usuário com `onboarding_completed = false`
2. Confirmar wizard aparece (4 telas)
3. Clicar "Pular" → confirmar que vai para tela 4
4. Clicar "Fazer isso depois" → confirmar que app aparece normalmente
5. Na próxima sessão: confirmar que wizard NÃO aparece (localStorage)

---

## Self-review checklist (para o implementador)

- [ ] `getOnboardingSlide2` retorna DEFAULT para function_title null ou não mapeado
- [ ] `OnboardingWizard` não renderiza se `collaborator === null` (loading state → `showWizard` é false)
- [ ] Botão WhatsApp abre `wa.me/5521997243082` (sem texto pré-preenchido — TOM já mandou)
- [ ] `WIZARD_DISMISSED_KEY` é exportado de `OnboardingWizard.tsx` e importado em `AppShell.tsx`
- [ ] Edge Function retorna `{ ok: true }` em sucesso, erro silencioso no PWA
- [ ] `npx tsc --noEmit` passa sem erros
- [ ] `npm run build` passa sem warnings críticos

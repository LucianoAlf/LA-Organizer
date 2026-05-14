# Onboarding Unificado — Wizard PWA + Primeira Conversa TOM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma experiência de boas-vindas completa e integrada: wizard visual de 4 telas no PWA (personalizado por cargo) que termina com um botão que aciona o TOM proativamente no WhatsApp, dando início ao onboarding conversacional de preferências.

**Architecture:** Wizard fullscreen no PWA renderizado em `AppShell.tsx` enquanto `onboarding_completed = false`. Tela final dispara mensagem proativa via Edge Function `send-onboarding-message`. TOM recebe contexto do cargo no primeiro contato e conduz 5 perguntas de preferência (skill existente, melhorada). `onboarding_completed = true` é setado pelo TOM ao final das 5 respostas (marcador `<<ONBOARDING_DONE>>` existente).

**Tech Stack:** React/TypeScript (PWA), Supabase Edge Functions, Node.js/UZapi (TOM engine), Markdown (skill TOM)

**TOM WhatsApp:** `5521997243082`

---

## Contexto do sistema atual

### O que já existe

| Componente | Estado |
|---|---|
| `collaborators.onboarding_completed` (boolean, default false) | ✅ Existe no banco |
| `skills/onboarding.md` — 5 perguntas de preferência | ✅ Existe (reescrever texto) |
| `src/engine.js` — detecta `onboarding_completed=false`, carrega skill | ✅ Existe |
| Marcador `<<ONBOARDING_DONE>>{json}<<END>>` | ✅ Existe |
| UZapi — envio proativo de mensagem WhatsApp | ✅ Existe no backend |

### O que não existe

- Nenhuma UI de onboarding no PWA
- Nenhuma Edge Function de mensagem proativa de onboarding
- Nenhuma personalização do TOM por cargo no onboarding

---

## Sub-projeto A: Wizard PWA (4 telas)

### Trigger

Renderizado dentro de `AppShell.tsx`: se `collaborator.onboarding_completed === false`, renderiza `<OnboardingWizard />` no lugar de `<Outlet />`. Ao concluir ou pular, o estado local do React fecha o wizard (`setWizardDismissed(true)`) — o componente desmonta e o `<Outlet />` aparece. **O `onboarding_completed` no banco é setado pelo TOM** após as 5 perguntas, não pelo PWA.

> **Por que não marcar no PWA?** O `onboarding_completed = true` sinaliza que as preferências do TOM estão configuradas. Marcar antes causaria TOM funcionar sem dados de horário/intensidade. O wizard usa estado local para não reaparecer na mesma sessão. Na próxima abertura do app, se o usuário ainda não respondeu ao TOM, o wizard aparece novamente — comportamento desejado.

### Tela 1 — Boas-vindas

```
[TOM avatar — grande, centralizado]

"Oi, [preferred_name]! Eu sou o TOM 👽"
"Seu assistente operacional da LA Music.
Tô aqui pra te ajudar no dia a dia."

● ○ ○ ○

[Próximo →]
```

- `preferred_name` vem de `collaborator.preferred_name || first_name(collaborator.full_name)`
- Link "Pular" no canto superior direito (vai direto para Tela 4, não fecha o wizard)

### Comportamento do "Pular" e "Fazer isso depois"

| Ação | Comportamento |
|---|---|
| "Pular" (telas 1–3) | Avança direto para Tela 4 (CTA do WhatsApp) |
| "Fazer isso depois" (tela 4) | Fecha o wizard; salva `wizard_dismissed = true` em localStorage |
| "Falar com o TOM agora" (tela 4) | Fecha o wizard; salva `wizard_dismissed = true` em localStorage; dispara TOM |
| Nova sessão com `wizard_dismissed = true` mas `onboarding_completed = false` | **Não mostra wizard novamente** — usuário já viu, decisão dele |
| Nova sessão com `onboarding_completed = true` | Não mostra wizard (fluxo normal) |

> **Decisão de design:** uma vez que o usuário viu o wizard e tocou em qualquer CTA (mesmo "Fazer isso depois"), não exibimos novamente. A segunda chance de completar o onboarding do TOM vem das mensagens proativas do próprio TOM, não do wizard reaparecendo.

### Tela 2 — O que o app faz (personalizado por cargo)

```
[Ícone temático por cargo]
[Tag: "Personalizado para: {function_title}"]

"{Título por cargo}"
"{Subtítulo por cargo}"

[Chips de features em destaque]

○ ● ○ ○

[Próximo →]
```

**Mapeamento de conteúdo por cargo:**

| Cargo (`function_title`) | Título | Subtítulo | Chips destaque |
|---|---|---|---|
| Farmer | "Seu pipeline e metas em um lugar só" | "Registra leads, acompanha negociações e nunca perde um follow-up." | Tarefas, Projetos |
| Hunter | "Seu pipeline e metas em um lugar só" | "Registra leads, acompanha negociações e nunca perde um follow-up." | Tarefas, Projetos |
| Professor | "Suas aulas e agenda em um lugar só" | "Agenda de aulas, lembretes e checklists de rotina num só lugar." | Agenda, Checklists |
| Assistente Pedagógico | "Seus checklists e operação em um lugar só" | "Checklists diários, tarefas e apoio à equipe pedagógica." | Checklists, Tarefas |
| Financeiro | "Seus projetos e demandas em um lugar só" | "Acompanha demandas, tarefas e prazos sem perder nada." | Projetos, Tarefas |
| RH | "Seus projetos e demandas em um lugar só" | "Acompanha demandas, tarefas e prazos sem perder nada." | Projetos, Tarefas |
| Gerente | "Seu time e operação em um lugar só" | "Gestão de equipe, projetos, checklists e indicadores reunidos." | Equipe, Projetos, Checklists |
| Coordenador | "Seu time e operação em um lugar só" | "Gestão de equipe, projetos, checklists e indicadores reunidos." | Equipe, Projetos, Checklists |
| Diretor | "Visão completa da operação da LA" | "Time, projetos, checklists e indicadores em um painel só." | Equipe, Projetos, Checklists |

**Fallback** (cargo nulo ou não mapeado): usa conteúdo de "Colaborador" — "Suas tarefas e agenda em um lugar só" / Tarefas, Agenda.

### Tela 3 — Como o TOM funciona

```
[Balões de conversa, estilo WhatsApp]

👽 "Manda mensagem pra mim no WhatsApp.
    Eu gerencio suas tarefas, te aviso dos rituais
    e cobro o que tá pendente 😅"

👽 "E também te ajudo com sua vida pessoal —
    hábitos, lembretes particulares, agenda.
    Fica entre a gente 🤐"

"Fala comigo no WhatsApp"
"Sem app extra — só mensagem natural."

○ ○ ● ○

[Próximo →]
```

### Tela 4 — Comece agora

```
[TOM avatar + ícone WhatsApp]

"Tudo pronto! Me chama no WhatsApp 🎉"
"Salva meu contato e manda um Oi —
eu cuido do resto."

○ ○ ○ ●

[💬 Falar com o TOM agora]   ← botão verde WhatsApp
[Fazer isso depois]           ← texto menor, fecha o wizard
```

**Comportamento do botão verde:**
1. Chama Edge Function `send-onboarding-message` (POST, autenticado)
2. Abre `https://wa.me/5521997243082` (sem texto pré-preenchido — TOM já enviou a mensagem)
3. Fecha o wizard localmente

**"Fazer isso depois":** fecha o wizard sem disparar TOM. Na próxima sessão, wizard reaparece (até `onboarding_completed = true`).

### Componentes novos

| Arquivo | Responsabilidade |
|---|---|
| `web/src/components/OnboardingWizard.tsx` | Wizard completo — 4 telas, estado de step, animação entre telas |
| `web/src/lib/onboarding.ts` | Constantes de conteúdo por cargo (mapeamento da tabela acima) |

### Modificação existente

| Arquivo | Mudança |
|---|---|
| `web/src/components/AppShell.tsx` | Verifica `collaborator.onboarding_completed`; renderiza `<OnboardingWizard />` ou `<Outlet />` |

---

## Sub-projeto B: Edge Function + TOM Onboarding Melhorado

### Edge Function `send-onboarding-message`

**Endpoint:** `POST /functions/v1/send-onboarding-message`
**Auth:** Bearer token do usuário logado (RLS — só pode disparar pra si mesmo)

**O que faz:**
1. Busca `collaborator` do usuário (phone, full_name, preferred_name, role, function_title)
2. Chama UZapi para enviar mensagem proativa para o número do colaborador
3. Retorna `{ ok: true }` ou erro

**Mensagem enviada pelo TOM:**

```
👽 Oi, [nome]! Aqui é o TOM — seu assistente operacional da LA Music.

Tô aqui pra te ajudar no dia a dia: tarefas, agenda, projetos e checklists.
E também pra organizar sua vida pessoal 🤐 — hábitos, lembretes particulares, o que você quiser.

📲 Salva meu contato como *TOM - LA* e me manda um "Oi" quando quiser.

Agora, pra te atender melhor, preciso de uns minutinhos pra entender suas preferências. Pode ser?
```

*(Após o usuário responder qualquer coisa → TOM entra no fluxo de onboarding normal com as 5 perguntas)*

### Melhoria da skill `skills/onboarding.md`

A skill existente já faz as 5 perguntas. Mudanças:

1. **Abertura da skill:** adicionar saudação personalizada por cargo antes das perguntas
2. **Tom de voz:** manter informal mas com contexto do cargo (ex: pra Hunter, "Vou configurar seu briefing de metas...")
3. **Pergunta de planejamento:** já existe (`planning_day`, `planning_time`) — manter
4. **Sem novas perguntas:** YAGNI. As 5 perguntas existentes são suficientes.

**Novos arquivos:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/functions/send-onboarding-message/index.ts` | Edge Function — dispara mensagem proativa TOM |

**Arquivos modificados:**

| Arquivo | Mudança |
|---|---|
| `skills/onboarding.md` | Reescrever texto da abertura; personalizar por cargo |

---

## Fluxo completo integrado

```
[Usuário abre o app pela primeira vez]
        ↓
[onboarding_completed = false]
        ↓
[AppShell renderiza OnboardingWizard]
        ↓
[Tela 1 → 2 (cargo) → 3 (TOM fala) → 4 (WhatsApp)]
        ↓
[Toca "Falar com o TOM agora"]
        ↓
[PWA: chama send-onboarding-message]   [PWA: abre wa.me/5521997243082]
        ↓                                         ↓
[TOM envia boas-vindas proativas]    [Usuário vê o WhatsApp com mensagem]
        ↓
[Usuário responde no WhatsApp]
        ↓
[TOM: skill onboarding — 5 perguntas]
        ↓
[TOM: <<ONBOARDING_DONE>>{prefs}<<END>>]
        ↓
[onboarding_completed = true no banco]
        ↓
[Próxima abertura do app: AppShell renderiza <Outlet /> normalmente]
```

---

## Fora de escopo

- Sub-projeto C (skill de ajuda) — spec separada
- Personalização avançada de UX por cargo além da tela 2
- Onboarding para usuários que já completaram (retroativo)
- Push notification ou email como alternativa ao WhatsApp

---

## Arquivos impactados (resumo)

| Arquivo | Ação |
|---|---|
| `web/src/components/OnboardingWizard.tsx` | Criar |
| `web/src/lib/onboarding.ts` | Criar |
| `web/src/components/AppShell.tsx` | Modificar |
| `supabase/functions/send-onboarding-message/index.ts` | Criar |
| `skills/onboarding.md` | Modificar |

**Zero migrations de banco.** Todos os campos já existem.

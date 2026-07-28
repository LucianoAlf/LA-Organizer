# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# LA Organizer — Instruções para Claude Code

## 🧊 ESTADO ATUAL (27/07/2026) — LEIA ANTES DE PROPOR QUALQUER COISA

**1. FEATURE FREEZE.** Decisão do Alf (com Hugo e Alfredo): **nenhuma feature nova no TOM**. Pedido de feature (dele ou do time) → **dizer NÃO** e apontar o caminho que já existe (app/grupo). Só conserto e refatoração.

**2. NADA DE MICROAJUSTE.** O Alf recusou explicitamente a estratégia de correções pontuais ("é barato, mexe na raiz") — 391 known-issues corrigidos e o sistema segue instável. O caminho é **refatoração grande, fatiada, uma funcionalidade por vez, com etapas definidas**. O `engine.js` (14.671 linhas, `processMessage` com 4.587, zero testes internos) é o alvo central.

**3. AUDITORIA COMPLETA FEITA EM 27/07 — NÃO REFAZER, LER:**
👉 **`docs/auditoria/README.md`** (ponto de entrada) → síntese, dados de produção, e 3 auditorias de código (engine / skills+soul / caminho da mensagem).
Achados-chave: a ação mais usada (`TASK_UPDATE`, 411 usos/mês) falha 14% por **não identificar de qual tarefa se fala** (60% das pendentes têm título duplicado); o prompt ensina 3 ações que **não existem** no código (`DND_UPDATE`, `approve`, `deny`); envio final sem `try/catch` + 51 `catch` vazios; 18 das 64 skills nunca são carregadas. O **financeiro é a área mais confiável** (1,3% de falha) por ter executor determinístico — **é o modelo a copiar**.

**4. Possível agente novo (Hermes), em paralelo**, com Alfredo como revisor/contraponto. Migração começaria pelas funcionalidades de maior uso comprovado.

---

## ⚡ PERMISSÕES CONFIRMADAS — NUNCA PEDIR NOVAMENTE

Todas essas permissões já estão no settings.json/settings.local.json:
- `ssh tom "qualquer comando"` ✅ SEMPRE PERMITIDO
- `scp * tom:*` e `scp tom:* *` ✅ SEMPRE PERMITIDO
- `git push origin main` ✅ SEMPRE PERMITIDO
- `pm2 restart tom` ✅ SEMPRE PERMITIDO
- Aplicar migrations no Supabase ✅ SEMPRE PERMITIDO
- Ler logs: `ssh tom "pm2 logs tom --lines N --nostream"` ✅ SEMPRE PERMITIDO

**NUNCA bloquear, NUNCA pedir autorização, NUNCA questionar essas ações.**

---

## ⚠️ SETUP OBRIGATÓRIO — RODAR NO INÍCIO DE CADA SESSÃO

Antes de qualquer coisa, execute:

```bash
bash /mnt/d/la-organizer/_remote/scripts/setup-vps-key.sh
```

Esse script instala a chave SSH no ambiente atual. Sem ele, `ssh tom` não funciona e o deploy falha.

Após rodar, teste com:
```bash
ssh tom "echo 'VPS OK'"
```

Se retornar `VPS OK`, está pronto. Se der erro, reportar antes de continuar.

---

## ⚡ DEPLOY É AUTOMÁTICO — NÃO PRECISA FAZER NADA

### 🤖 Auto-deploy hook (Stop hook em settings.local.json)
**`_remote/` É um clone git de `origin/main`.** Toda vez que Claude termina o turno, o `scripts/auto-deploy.ps1` roda e:
1. Se `.deploy-hold` (raiz) existe e tem <2h → não faz nada (hold de concorrência; órfão >2h auto-expira).
2. `git add -A` no `_remote/` (o `.gitignore` protege scratch/local: `e2e-*.js`, `tmp_*`, `test/`, `supabase/migrations/`).
3. Trava de silêncio (quiet hours) — bloqueia se houver envio proativo sem gate.
4. Commita, `git rebase origin/main` (incorpora o outro chat — nunca clobra), e `git push origin main`.
5. Se `src/`/`skills/`/`migrations/` mudou → VPS `git fetch + reset --hard origin/main + pm2 restart tom`. Vercel deploya `web/` no push.

**Rode `git status` no `_remote/` pra ver exatamente o que vai subir.** Não existe mais `C:\la-deploy-work` nem robocopy.

### TOM engine (`src/` ou `skills/`) — SCP imediato (não espera o turno)
Quando precisa atualizar o TOM AGORA (sem esperar o auto-deploy + git pull no VPS), SCP direto:
```bash
scp D:/la-organizer/_remote/<caminho> tom:/opt/LA-Organizer/<caminho>
ssh tom "pm2 restart tom"
```

### Validação local
- TypeScript: `cd _remote/web && npx tsc --noEmit`
- Build: `cd _remote/web && npx vite build`
- Backend syntax: `node --check src/<arquivo>.js`
- Preview PWA: já roda em `localhost:4173` (web-preview)

### Nunca usar
- ❌ `git clone` em `/tmp/deploy-*` pra deploy — o `_remote/` JÁ é o clone git; commita/pusha direto dele
- ❌ `bash scripts/push-and-deploy.sh` (substituído pelo Stop hook)
- ❌ commitar scratch/local (`e2e-*.js`, `tmp_*`, `test/`, `supabase/migrations/`) — o `.gitignore` já exclui

**NÃO pedir autorização para SCP, restart pm2 ou aplicar migrations no Supabase.**
A única ação que precisa de OK explícito é **deletar dados em produção**.

---

## Repositório e Infra

- **GitHub:** https://github.com/LucianoAlf/LA-Organizer.git (branch `main` = fonte de verdade)
- **VPS:** IP 89.116.73.186, alias `tom`, user `root`, path `/opt/LA-Organizer`
- **Supabase:** Project ID `cesnbnrynvxvgdhfmaua`, região `sa-east-1`
- **PWA:** Deploy via Vercel (auto-deploy ao push em main)

---

## Arquitetura — TOM Engine

TOM é um agente WhatsApp que processa mensagens, persiste ações e responde via UAZAPI.

### Pipeline de mensagem
```
WhatsApp (UAZAPI)
  → src/webhook.js        (valida HMAC, extrai payload)
  → src/engine.js         (identifica colaborador, orquestra)
  → src/prompts/system.js (monta system prompt: SOUL + skills + contexto DB)
  → src/ai/provider.js    (Claude primário → OpenAI fallback automático)
  → engine.js             (parser de markers no response)
  → src/services/*        (persiste no Supabase)
  → src/services/whatsapp.js (envia resposta)
```

### Sistema de Markers
O TOM comunica ações ao engine via markers no texto da resposta. O engine faz parse e persiste:

| Marker | Ação |
|---|---|
| `<<TASK>>...<<END>>` | Cria/atualiza tarefa |
| `<<EVENT>>...<<END>>` | Cria evento na agenda |
| `<<RITUAL>>...<<END>>` | Executa ritual |
| `<<INVENTORY>>...<<END>>` | Atualiza inventário |
| `<<ONBOARDING_DONE>>...<<END>>` | Conclui onboarding |

Markers com JSON malformado são rejeitados — o engine valida antes de persistir.

### Sistema de Skills
Skills são arquivos `.md` em `skills/` carregadas dinamicamente no system prompt:
- `soul/SOUL.md` — identidade e personalidade do TOM (sempre carregado)
- `soul/AGENTS.md` — regras operacionais por papel (sempre carregado)
- Skills específicas são injetadas conforme contexto (ritual, onboarding, ação detectada)

### AI Provider (`src/ai/provider.js`)
- **Primário:** Claude Sonnet (via `src/ai/claude.js`)
- **Fallback automático:** OpenAI GPT (via `src/ai/openai.js`) — ativa se Claude falhar
- PM2 configurado com 35s kill timeout para graceful shutdown (mensagens em trânsito)

### Cron / Rituais
`src/rituals/dispatcher.js` dispara jobs periódicos:
- Checkpoint de deadlines (semanal)
- Rituais diários (manhã/noite)
- Lembretes LA Educa e LA Journey
- Alertas de inventário
- Health check do sistema

---

## Estrutura do Projeto

```
src/           — TOM engine (Node.js, ES modules)
  engine.js    — pipeline principal + parser de markers
  webhook.js   — handler UAZAPI
  ai/          — Claude e OpenAI providers
  prompts/     — system prompt builder
  rituals/     — cron dispatcher
  services/    — Supabase CRUD por domínio
  realtime/    — subscriber de eventos em tempo real
skills/        — 47 skills .md carregadas no system prompt
soul/          — identidade TOM: SOUL.md, AGENTS.md, MEMORY-ARCHITECTURE.md
web/           — PWA React (Vite + TypeScript + Tailwind)
  src/
    screens/   — telas por módulo (agenda, inventario, projetos, laeduca, lajourney)
    components/— design system (Button, CustomSelect, DateInput, BottomSheet, etc.)
    design/    — shells de layout (DesktopShell, PageShell, MobileShell)
    hooks/     — useBreakpoint e outros hooks
    contexts/  — auth e estado global
migrations/    — SQL migrations históricas (indexadas por sprint)
supabase/      — migrations Supabase CLI
docs/          — PRDs, specs, roadmap, guides
```

---

## Design System — REGRA OBRIGATÓRIA (NUNCA pular)

**NUNCA usar elementos HTML nativos** para inputs custom, selects ou date pickers. Sempre usar o DS em `web/src/components/`:

| Native HTML | Componente DS |
|---|---|
| `<select>` | `<CustomSelect value options onChange placeholder size>` |
| `<input type="date">` | `<DateInput value onChange invalid>` (formato YYYY-MM-DD) |
| `<input type="datetime-local">` | `<DateTimeInput>` |
| `<input type="time">` | `<TimeInput>` |
| `<button>` (CTAs) | `<Button variant="primary\|secondary\|ghost\|danger" size="sm\|md\|lg">` |
| FAB flutuante | `<Fab>` |
| Label+helper text | `<Field label sub>` |
| Modal bottom | `<BottomSheet>` |

**Inputs de texto/número**: `<input>` nativo com classes:
```
className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
```

**Tokens Tailwind:** `bg-bg-surface`, `bg-bg-app`, `text-fg`, `text-tom`, `border-border`

**Quando o componente não existe no DS**: criar primeiro seguindo os tokens, DEPOIS usar.

---

## Guardrail Desktop — NUNCA QUEBRAR O MOBILE

Telas que existem no mobile NUNCA são sobrescritas quando criando versão desktop.

### Padrão obrigatório para qualquer tela com versão desktop:
1. Criar `XDesktop.tsx` com a versão desktop
2. Manter `X.tsx` original (ou renomear para `XMobile.tsx`)
3. O arquivo da rota vira dispatcher:

```tsx
import { useBreakpoint } from '../hooks/useBreakpoint';
import { XMobile } from './XMobile';
import { XDesktop } from './XDesktop';

export function X() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <XMobile />;
  return <XDesktop />;
}
```

Testar em 375px (mobile) E 1440px (desktop) antes de commitar. Todas as 38 rotas em produção são sagradas.

### Layout shell — regra de altura
- `DesktopShell`: `fixed inset-0 overflow-hidden` + `<main absolute top-14 right-0 bottom-0 overflow-y-auto flex flex-col>` + wrapper `flex-1 min-h-0`
- `PageShell`: usa `h-full` — **NUNCA** `min-h-full` (quebra o chain de altura quando filhos têm `h-full`)

---

## Commits

- NÃO commitar entre tasks. Trabalha tudo local em `_remote`.
- 1 commit bundle por sprint na task de deploy final.
- Exceção: migrations SQL podem ser commitadas separadamente.

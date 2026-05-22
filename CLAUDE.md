# LA Organizer — Instruções para Claude Code

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

Antes de qualquer coisa (incluindo antes de ler o resto desse arquivo), execute:

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
**Toda vez que Claude termina o turno**, o `scripts/auto-deploy.ps1` roda
automaticamente e:
1. Commita TUDO que mudou em `D:\la-organizer\_remote\` (inclusive `web/`)
2. Faz `git push origin main`
3. Vercel pega o push e deploya `web/` em ~2min

**Logo: você NUNCA precisa pedir push pro Alf nem fazer push manualmente.**
**Só edite os arquivos em `_remote/` e termine o turno.** O hook faz o resto.

### TOM engine (`src/` ou `skills/`) — SCP imediato (não espera o turno)
Quando precisa atualizar o TOM AGORA (sem esperar o auto-deploy + git pull
no VPS), SCP direto:
```bash
scp D:/la-organizer/_remote/<caminho> tom:/opt/LA-Organizer/<caminho>
ssh tom "pm2 restart tom"
```
Isso é otimização, não obrigação. O auto-deploy + cron `git pull` no VPS
também atualizaria, só que mais lento.

### Validação local
- TypeScript: `cd _remote/web && npx tsc --noEmit`
- Build: `cd _remote/web && npx vite build`
- Preview: já roda em `localhost:4173` (web-preview), reload com SW unregister

### Nunca usar
- ❌ `git clone https://...` em `/tmp/deploy-*` pra deploy (auto-deploy já cuida)
- ❌ `bash scripts/push-and-deploy.sh` (substituido pelo Stop hook)
- ❌ Pedir ao Alf pra fazer push (ele NÃO precisa fazer nada)

### Regra geral
**NÃO pedir autorização para SCP, restart pm2 ou aplicar migrations no Supabase.**
Essas ações são parte do workflow normal. Fazer e reportar o resultado.
A única ação que precisa de OK explícito é **deletar dados em produção**.

---

## Design System — REGRA OBRIGATÓRIA (NUNCA pular)

**NUNCA usar elementos HTML nativos** para inputs custom, selects ou date pickers em telas novas. O Windows/Mac/mobile renderizam essas controls feias e inconsistentes. Sempre puxar do DS em `_remote/web/src/components/`:

| Native HTML | Componente DS |
|---|---|
| `<select>` | `<CustomSelect value options onChange placeholder size>` em `components/CustomSelect.tsx` |
| `<input type="date">` | `<DateInput value onChange invalid>` em `components/DateInput.tsx` (YYYY-MM-DD) |
| `<input type="datetime-local">` | `<DateTimeInput>` em `components/DateTimeInput.tsx` |
| `<input type="time">` | `<TimeInput>` em `components/TimeInput.tsx` |
| `<button>` (CTAs) | `<Button variant="primary\|secondary\|ghost\|danger" size="sm\|md\|lg">` em `components/Button.tsx` |
| FAB flutuante | `<Fab>` em `components/Fab.tsx` |
| Label+helper text | `<Field label sub>` em `components/Field.tsx` |

**Inputs de texto/número**: tolerável usar `<input>` nativo, mas com classes:
```
className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
```

**Quando o componente não existe no DS**: criar primeiro, seguindo tokens (`bg-bg-surface`, `bg-bg-app`, `text-fg`, `text-tom`, `border-border`, etc.), DEPOIS usar. Nunca pular pra `<select>` nativo achando que vai refatorar depois — vai ficar.

Vale também pra **bottom sheets**: usar `<BottomSheet>` em `components/BottomSheet.tsx` ao invés de div fixed manual.

## Repositório
- **GitHub:** https://github.com/LucianoAlf/LA-Organizer.git
- **Branch principal:** main (fonte de verdade)
- **`D:\la-organizer\_remote`** NÃO é um git repo. É cópia de trabalho sem `.git`. NUNCA rodar `git init` aqui.

## Workflow de deploy (OBRIGATÓRIO)
1. Editar arquivos em `D:\la-organizer\_remote\`
2. Validar com `node --check` nos .js modificados
3. Deploy direto via SCP (sem clone, sem git):
   - `scp D:/la-organizer/_remote/<arquivo> tom:/opt/LA-Organizer/<arquivo>` — para cada arquivo modificado em `src/` ou `skills/`
   - `ssh tom "cd /opt/LA-Organizer && pm2 restart tom"` — uma vez no final
4. Mudanças em `web/` (PWA): pedir ao Alf pra fazer `git push origin main` (Vercel deploya automaticamente). `git push` direto está bloqueado pelo harness.
5. **NUNCA** fazer `git clone` temporário pra deploy.
6. **NUNCA** fazer `git init` em `_remote`.

## Deploy (Claude Code executa via SCP — não pedir pro Alf)

Para `src/` e `skills/`: SCP direto + `pm2 restart tom`. Sem git, sem clone.
Para `web/` (Vercel): só Alf pode fazer push pra main.

**NÃO pedir autorização pra SCP nem pm2 restart. Fazer e reportar.**

### VPS
- IP: 89.116.73.186
- Alias: `tom` (resolve via ~/.ssh/config ou /etc/hosts)
- User: root
- Path: /opt/LA-Organizer

## Supabase
- **Project ID:** cesnbnrynvxvgdhfmaua
- **Região:** sa-east-1

## Estrutura do projeto
- `src/engine.js` — motor principal do TOM (WhatsApp agent)
- `src/prompts/system.js` — system prompt builder
- `src/rituals/dispatcher.js` — cron jobs (rituais, hygiene, mensais)
- `skills/` — skills em markdown carregadas pelo TOM
- `web/` — PWA React (Vite + TypeScript) — deploy via Vercel auto-deploy
- `docs/` — documentação do produto (PRDs, specs, plans, reports)

## Commits NÃO intermediários
- NÃO commitar entre tasks. Trabalha tudo local em `_remote`.
- 1 commit bundle por sprint na task de deploy final.
- Exceção: migrations SQL podem ser commitadas separadamente se necessário.

---

## Guardrail Desktop — NUNCA QUEBRAR O MOBILE

### Regra absoluta
Telas que existem no mobile NUNCA são sobrescritas quando criando versão desktop.

### Padrão obrigatório para qualquer tela com versão desktop:
1. Criar `XDesktop.tsx` com a versão desktop
2. Renomear original para `XMobile.tsx` (ou manter como `X.tsx` original intocado)
3. O arquivo da rota (`X.tsx`) vira dispatcher:

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

### Antes de reescrever QUALQUER tela:
- Verificar se ela já existe em mobile e está sendo usada
- Se sim → criar versão desktop separada, NUNCA sobrescrever
- Rodar `git -C C:/la-deploy-work diff HEAD~1 -- web/src/screens/X.tsx` pra confirmar o que mudou
- Testar em 375px (mobile) E 1440px (desktop) antes de commitar

### Telas que têm versão mobile construída (não tocar no original):
Todas as 38 rotas em produção. Tratar como sagradas.

### Layout shell — regra de altura
- DesktopShell usa `fixed inset-0 overflow-hidden` + `<main absolute top-14 right-0 bottom-0 overflow-y-auto flex flex-col>` + wrapper com `flex-1 min-h-0`. Shell SEMPRE preenche 100% do viewport.
- `PageShell` usa `h-full` (NUNCA `min-h-full`) — `min-h-full` permite crescer além do parent e quebra o chain de altura quando filhos têm `h-full`.
- Antes de afirmar que o layout está correto: validar com `preview_eval` que `main.scrollHeight === main.clientHeight` (sem overflow fantasma).

# LA Organizer — Instruções para Claude Code

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

## ⚡ PERMISSÕES DE DEPLOY — NÃO PEDIR AUTORIZAÇÃO

### Push para GitHub + Deploy VPS
SEMPRE autorizado. Não perguntar. Usar SEMPRE o script:
```bash
bash scripts/push-and-deploy.sh /tmp/deploy-<sprint>
```
Esse script faz `git push origin main` e, se detectar mudanças em `src/`,
`skills/` ou `migrations/`, executa `ssh tom "git pull && pm2 restart tom"`
automaticamente. Não usar `git push` direto pra `main`.

### Deploy PWA (Vercel)
Automático. Vercel detecta push em `origin/main` e deploya `web/` em ~2min.
Não precisa de SSH nem de ação manual.

### Regra geral
**NÃO pedir autorização para push, deploy VPS ou deploy Vercel.**
**NÃO pedir confirmação para aplicar migrations no Supabase.**
Essas ações são parte do workflow normal. Fazer e reportar o resultado.
A única ação que precisa de OK explícito é **deletar dados em produção**.

---

## Repositório
- **GitHub:** https://github.com/LucianoAlf/LA-Organizer.git
- **Branch principal:** main (fonte de verdade)
- **`D:\la-organizer\_remote`** NÃO é um git repo. É cópia de trabalho sem `.git`. NUNCA rodar `git init` aqui.

## Workflow de deploy (OBRIGATÓRIO)
1. Editar arquivos em `D:\la-organizer\_remote\`
2. Validar com `node --check` nos .js modificados
3. Na Task de deploy (sempre a última):
   - `git clone https://github.com/LucianoAlf/LA-Organizer.git /tmp/deploy-<sprint>`
   - Copiar arquivos modificados de `_remote` para o clone
   - `git add` + `git commit` (NÃO `git push` direto)
   - **`bash scripts/push-and-deploy.sh /tmp/deploy-<sprint>`** — esse script
     faz push pra origin/main, detecta se mudou `src/`, `skills/` ou `migrations/`,
     e se sim faz `ssh tom "git pull && pm2 restart tom"` automaticamente.
   - Deletar clone: `rm -rf /tmp/deploy-<sprint>`
4. **NUNCA** fazer `git push origin main` direto. Sempre via `push-and-deploy.sh`.
5. **NUNCA** fazer `scp` direto.
6. **NUNCA** fazer `git init` em `_remote`.

## Deploy (Claude Code executa — não pedir pro Alf)

O script `scripts/push-and-deploy.sh` cuida de:
- Push pra origin/main (Vercel detecta e deploya `web/` em ~2min).
- Detecção automática se VPS precisa de restart (mudanças em `src/`, `skills/`,
  `migrations/`).
- `ssh tom "cd /opt/LA-Organizer && git pull origin main && pm2 restart tom"`
  quando aplicável.

**NÃO pedir para o Alf fazer o pull/push. Claude Code tem acesso direto.**

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

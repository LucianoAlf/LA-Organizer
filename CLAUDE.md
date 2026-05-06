# LA Organizer — Instruções para Claude Code

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
   - `git add` + `git commit` + `git push origin main`
   - Deletar clone: `rm -rf /tmp/deploy-<sprint>`
4. Deploy na VPS (após push para origin/main):
```bash
ssh tom "cd /opt/LA-Organizer && git pull origin main && pm2 restart tom"
```
5. **NUNCA** fazer `scp` direto
6. **NUNCA** fazer `git init` em `_remote`

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

## Deploy na VPS (SSH direto)

### Setup da chave (uma vez por sessão — paths WSL)
```bash
bash /mnt/d/la-organizer/_remote/scripts/setup-vps-key.sh
```

### Deploy em 1 linha (após push para origin/main)
```bash
ssh tom "cd /opt/LA-Organizer && git pull origin main && pm2 restart tom"
```

### VPS
- IP: 89.116.73.186
- Alias: `tom` (resolve via ~/.ssh/config ou /etc/hosts)
- User: root
- Path: /opt/LA-Organizer

## Commits NÃO intermediários
- NÃO commitar entre tasks. Trabalha tudo local em `_remote`.
- 1 commit bundle por sprint na task de deploy final.
- Exceção: migrations SQL podem ser commitadas separadamente se necessário.

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
4. Deploy na VPS — Claude Code executa diretamente (ver seção abaixo)
5. **NUNCA** fazer `scp` direto
6. **NUNCA** fazer `git init` em `_remote`

## Deploy (Claude Code executa — não pedir pro Alf)

Após push para origin/main:
```bash
ssh tom "cd /opt/LA-Organizer && git pull origin main && pm2 restart tom"
```

**NÃO pedir para o Alf fazer o pull. Claude Code tem acesso direto via SSH.**

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

# Migração do deploy — `_remote/` vira um clone git de verdade

**Data:** 2026-07-21
**Validado com:** Alf (dono) — aprovou o desenho; steer explícito: "decide o técnico com recomendação, não me faz escolher git".
**Status:** spec → revisão do Alf → plano
**Motivação:** o deploy virou uma "cachaça" recorrente (palavras do Alf). Toda subida exige verificação manual pesada e coisa do outro chat fica pra trás ou é revertida.

---

## 1. O problema (raiz, não sintoma)

Hoje o `D:\la-organizer\_remote` **não é um repositório git** — é um **espelho copiado na mão**. O auto-deploy (`scripts/auto-deploy.ps1`) mantém um clone separado (`C:\la-deploy-work`), reseta ele a `origin/main`, faz **robocopy** do `_remote/` por cima (`/E` pra maioria, `/MIR` só pro web/src), commita e empurra.

Três fragilidades empilhadas:
1. **Espelho que drifta.** O `_remote/` não reflete fielmente `origin/main` — hoje faltavam **9 arquivos tracked** nele (`config.js`, `supabase/client.js`, `utils/creation-claim.js`, `services/context.js`, etc.). Ninguém sabe, sem investigar, se o que vai subir está fresco. Deployar com segurança exigiu **6 verificações manuais** (divergência arquivo-a-arquivo, manifesto md5 de 439 arquivos, checar tracked-vs-untracked, ler o script inteiro, simular o commit).
2. **Dois chats na MESMA pasta `_remote/`** (comprovado pelo comentário do próprio script: "vários chats no MESMO `_remote` local"), com o `.deploy-hold` **manual** como única trava. Um turno encerrando empacota o trabalho pela metade do outro, ou reverte.
3. **Sem `.gitattributes`.** EOL (CRLF/LF) e bit executável (+x) ficam soltos → o `git reset --hard` da VPS derruba o +x dos `.sh` a cada deploy (contornei hoje invocando via `bash`); e há risco de churn de CRLF.
4. **Hold sem validade** — um `.deploy-hold` órfão trava todos os deploys pra sempre (a dor original do Alf; o próprio script tem um TODO sobre isso).

## 2. Objetivo

Deploy previsível e chato: divergência impossível de não-ver, trabalho do outro chat nunca perdido/revertido, sem gremlins de EOL/+x, e hold que não congela pra sempre. **Sem mudar o que o Alf gosta:** deploy continua 100% automático (termina o turno → sobe).

## 3. Decisões (do brainstorm — recomendações minhas, Alf aprovou)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Modelo do `_remote/` | **Clone git de verdade** (mata o espelho + a camada de robocopy). |
| 2 | Concorrência (2 chats, 1 pasta) | **Hold continua**, mas com **TTL ~2h** (órfão auto-expira). O git (`status`/`rebase`) passa a tornar divergência visível em vez de escondê-la. |
| 3 | EOL / +x | **`.gitattributes`** (`eol=lf`, `.sh` executável no git). |
| 4 | Automático vs confirmar | **100% automático mantido** (recomendado; do jeito que o Alf usa). |
| 5 | Cutover | **In-place** (`git init` no `_remote/` + `reset --hard origin/main`), com backup e rollback. Baixo risco: o `_remote/` local **não tem arquivo local-only precioso** (checado: sem `.env` local; o que falta são arquivos tracked que o clone RESTAURA). |

## 4. Estado atual (levantado no código/infra — a spec não inventa)

- `_remote/` = espelho sem `.git`. CLAUDE.md hoje **proíbe** `git init` nele (regra que só existe POR CAUSA do espelho — esta migração a reverte).
- `auto-deploy.ps1` (Stop hook): hold-check → reset `C:\la-deploy-work` a `origin/main` → robocopy dirs (`/E` src/skills/docs/scripts/migrations, `/MIR` web/src) → trava de silêncio (`scripts/check-quiet-gates.js`, exit 2 bloqueia) → commit → push → se `src|skills|migrations` mudou: VPS `git fetch + reset --hard origin/main + pm2 restart`.
- VPS `/opt/LA-Organizer` = clone git, remote `git@github.com:LucianoAlf/LA-Organizer.git` (SSH). Puxa via `fetch + reset --hard origin/main` (só toca tracked; `.env`/`.claude-tom/` untracked sobrevivem).
- `C:\la-deploy-work` empurra via HTTPS (credential manager do Windows já funciona).
- **Sem `.gitattributes`** em lugar nenhum.
- `.gitignore` do repo: `.ssh/`, `scripts/setup-vps-key.sh`, `system-commandline-sentinel-files/`, `.superpowers/` (+ VPS: `.mcp.json`, `node_modules/`).

## 5. Arquitetura alvo

### 5.1 `_remote/` = clone git
Após o cutover, `_remote/` é um clone de `origin/main` (remote **HTTPS**, reusando o caminho de credencial que já funciona no `la-deploy-work`). `git status` mostra divergência na hora. Os arquivos "faltando" hoje voltam. `C:\la-deploy-work` fica **aposentado** (o hook não usa mais).

### 5.2 `.gitattributes` (novo, na raiz do repo)
```
* text=auto eol=lf
*.sh text eol=lf
```
Mais: marcar os scripts como executáveis no índice do git (uma vez, commitado): `git update-index --chmod=+x scripts/*.sh`. Assim o `reset --hard` da VPS **preserva o +x** — o bug de hoje morre na origem (o wrapper pode até voltar a ser invocado direto; manter `bash` é inofensivo).

### 5.3 `auto-deploy.ps1` reescrito (mais simples)
Fluxo novo (sem robocopy, sem `la-deploy-work`):
```
0. HOLD c/ TTL: se .deploy-hold existe:
     - idade < TTL (2h)  → exit 0 (bloqueia, como hoje)
     - idade >= TTL      → apaga o arquivo + loga "hold expirado (órfão)"; segue
1. cd _remote  (agora é clone git)
2. git add -A
3. trava de silêncio: node scripts/check-quiet-gates.js  (exit 2 → bloqueia, exit 1/erro → fail-open, igual hoje)
4. nada staged (git diff --cached --quiet) → exit 0
5. git commit -m "Auto-deploy <ts>\n\nCo-Authored-By: ..."
6. git fetch origin main; git rebase origin/main
     - conflito → git rebase --abort; recria .deploy-hold; alerta (WhatsApp dono, reusa a Sentinela/owner-phone); exit  (raro; precisa humano)
7. git push origin main
8. se mudou src/|skills/|migrations/ → ssh VPS: git fetch + reset --hard origin/main + pm2 restart tom
```
**Ganho:** o `git rebase origin/main` (passo 6) incorpora os commits que o OUTRO chat já empurrou ANTES de subir os meus — o trabalho do outro chat **nunca some** (hoje o robocopy podia clobrá-lo silenciosamente). Conflito real vira alerta explícito, não perda silenciosa.

### 5.4 CLAUDE.md atualizado
Remover a proibição "❌ git init em _remote" e a seção que descreve o robocopy/`la-deploy-work`. Documentar o novo modelo: `_remote/` é clone; `git status` antes de agir; hold com TTL; deploy = commit/push direto.

## 6. Cutover (in-place, reversível)

1. **Backup:** copiar `_remote/` → `_remote.bak-<ts>` (rollback total).
2. `cd _remote && git init -b main`.
3. `git remote add origin https://github.com/LucianoAlf/LA-Organizer.git`.
4. `git fetch origin main`.
5. `git reset --hard origin/main` → working tree vira EXATAMENTE `origin/main` (restaura os 9 faltantes; nenhum trabalho não-commitado a perder — tudo já foi deployado nesta sessão). Arquivos untracked locais (ex.: docs novos) sobrevivem.
6. `git config core.autocrlf false` (o `.gitattributes eol=lf` manda; evita conversão dupla).
7. **Verificação:** `git status` limpo (fora untracked esperado); contagem de arquivos bate com a VPS; `node --check` nos arquivos-chave; suíte roda.
8. Só então trocar o `auto-deploy.ps1` velho pelo novo (guardar o velho como `.bak`).

**Rollback:** se qualquer passo falhar → `rm -rf _remote/.git`; restaurar de `_remote.bak-<ts>`; restaurar `auto-deploy.ps1.bak`. A VPS e o `origin/main` **não são tocados** até o cutover estar verde (o novo hook só roda depois).

## 7. Zero-regressão / riscos

| Risco | Mitigação |
|---|---|
| Cutover corrompe/perde o `_remote/` | Backup `_remote.bak-<ts>` antes; rollback pronto; `reset --hard` seguro porque não há trabalho não-commitado agora. |
| Novo hook empurra lixo / reverte outro chat | `git rebase origin/main` antes do push incorpora o outro chat; conflito → aborta + alerta (nunca clobra). Trava de silêncio idêntica à de hoje. |
| Push do `_remote/` sem credencial | Usa a MESMA URL HTTPS do `la-deploy-work` (credential manager já autentica). |
| VPS quebra | A VPS **não muda** (continua `fetch + reset --hard + pm2 restart`). O cutover não toca nela até o hook novo estar validado. |
| Hold TTL expira no meio de edição legítima longa | 2h é folgado pra um turno; e o dono é avisado no rebase-conflito. (TTL só mata ÓRFÃO, não turno ativo.) |
| `.gitattributes` renormaliza tudo num commit gigante | Aplicar `eol=lf` + `git add --renormalize .` UMA vez, num commit dedicado e revisável, antes do resto. |
| CLAUDE.md desatualizado engana o próximo chat | Atualizar CLAUDE.md no mesmo PR/commit. |

## 8. Validação

- **Cutover:** `git status`/`git log` no `_remote/` batendo com `origin/main`; contagem de arquivos == VPS; suíte `node --test 'src/**/*.test.js'` roda (baseline de ambiente esperado).
- **Hook novo:** dry-run — fazer uma mudança boba (ex.: 1 comentário), rodar o hook, confirmar que commita SÓ ela, empurra, e a VPS reseta + restarta. Depois `git log origin/main` mostra o commit limpo.
- **`.gitattributes`/+x:** após um deploy, `ls -l scripts/tom-relogin.sh` na VPS mostra `+x` preservado.
- **Hold TTL:** criar `.deploy-hold` com mtime > 2h atrás, rodar o hook, confirmar que ele apaga + segue; criar fresco, confirmar que bloqueia.
- **Rebase-concorrência:** simular commit remoto à frente, confirmar que o hook rebaseia e não perde.

## 9. Fora de escopo (YAGNI)
- Worktree/clone separado por chat (complexo; compartilham uma pasta e o Alf não vai gerir isso).
- Mudar o mecanismo da VPS (o `reset --hard` de lá já é bom).
- Passo de confirmação manual no deploy (Alf quer automático).
- Migrar credencial pra SSH no Windows (HTTPS já funciona).
- CI/CD externo, GitHub Actions, etc.

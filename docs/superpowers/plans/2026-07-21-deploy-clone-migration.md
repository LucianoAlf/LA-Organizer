# Migração do deploy (`_remote/` → clone git) — Implementation Plan

> **For agentic workers:** este plano é uma migração de INFRA, sequencial e stateful (git state + VPS ao vivo). Executar INLINE (controller/catraca), NÃO subagente-driven — as tasks dependem uma da outra e mexem em estado que não dá pra paralelizar. Cada task valida com comandos reais.

**Goal:** transformar `D:\la-organizer\_remote` de espelho-copiado-na-mão em clone git de verdade, simplificar o auto-deploy (commit/push direto + rebase), e matar os gremlins de EOL/+x e de hold-órfão.

**Architecture:** cutover in-place do `_remote/` pra clone; novo `auto-deploy.ps1` que commita/pusha direto com `rebase` antes do push; `.gitattributes` pra EOL/+x; hold com TTL de 2h. VPS inalterada. Tudo com backup + rollback; `origin/main` e VPS só são tocados quando cada passo está verde.

**Tech Stack:** git, PowerShell (Stop hook), ssh/pm2 (VPS), node (trava de silêncio).

## Global Constraints

- **`.deploy-hold` (raiz) fica ATIVO** durante toda a migração — protege contra o hook velho E contra o outro chat. Só a Task 5 o remove.
- **`origin/main` e a VPS NÃO são tocados** até cada task estar validada. O cutover (Task 1) é 100% local.
- **Backup antes de destruir:** `_remote.bak-<ts>` antes do cutover; `auto-deploy.ps1.bak` antes de trocar o hook.
- **Remote via HTTPS:** `https://github.com/LucianoAlf/LA-Organizer.git` (credential manager do Windows já autentica — mesmo caminho do `la-deploy-work`).
- **VPS inalterada:** continua `git fetch + reset --hard origin/main + pm2 restart tom`.
- **Rollback sempre pronto** e documentado em cada task.
- Executor = catraca (controller), inline. Sem subagente.

---

### Task 1: Cutover — `_remote/` vira clone git (LOCAL, não toca VPS/origin)

**Files:**
- Backup: `D:\la-organizer\_remote.bak-<ts>` (cópia completa)
- Transform: `D:\la-organizer\_remote\.git` (novo)

**Interfaces:**
- Produces: `_remote/` passa a ser clone git de `origin/main`, working tree == `origin/main` + docs untracked (spec/plano desta migração). `C:\la-deploy-work` fica órfão (não removido ainda).

- [ ] **Step 1: Backup completo do `_remote/`**

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item -Recurse -Force "D:\la-organizer\_remote" "D:\la-organizer\_remote.bak-$ts"
Write-Output "backup: D:\la-organizer\_remote.bak-$ts"
```
Expected: pasta de backup criada. (Rollback desta task inteira = apagar `_remote/.git` e restaurar deste backup.)

- [ ] **Step 2: Snapshot pré-cutover (contagem de arquivos, pra comparar depois)**

```powershell
(Get-ChildItem -Recurse -File "D:\la-organizer\_remote\src" -Filter *.js | Measure-Object).Count
```
Anote o número (vai ser MENOR que a VPS — faltam os ~9 tracked; o cutover restaura).

- [ ] **Step 3: `git init` + remote + fetch**

```powershell
cd D:\la-organizer\_remote
git init -b main
git remote add origin https://github.com/LucianoAlf/LA-Organizer.git
git fetch origin main
```
Expected: fetch baixa `origin/main` (HEAD `4fc003c` ou mais novo se o outro chat empurrou).

- [ ] **Step 4: `reset --hard` → working tree vira EXATAMENTE `origin/main`**

```powershell
git -C D:\la-organizer\_remote reset --hard origin/main
git -C D:\la-organizer\_remote config core.autocrlf false
```
Expected: restaura os arquivos tracked que faltavam (`config.js`, `supabase/client.js`, `utils/creation-claim.js`, etc.). Untracked (docs novos, `node_modules/`) sobrevivem.

- [ ] **Step 5: Validar o cutover**

```powershell
cd D:\la-organizer\_remote
git status --short | Select-Object -First 20
git rev-parse --short HEAD
(git ls-files -- "src/**/*.js" | Measure-Object).Count
```
Expected: HEAD == origin/main; `git status` limpo fora untracked esperado (docs, node_modules); contagem de `src/*.js` agora BATE com a VPS (439). Comparar com a VPS:
```powershell
ssh tom "cd /opt/LA-Organizer && git ls-files -- 'src/**/*.js' | wc -l"
```
Expected: mesmo número dos dois lados.

- [ ] **Step 6: Suíte roda no clone**

```powershell
cd D:\la-organizer\_remote; node --test 'src/**/*.test.js' 2>&1 | Select-String -Pattern 'tests|pass|fail' | Select-Object -Last 4
```
Expected: baseline de ambiente (`fail 2`: system-loadout, pending-intents-detect); nada novo quebrado. Se a suíte explodir de forma diferente → ROLLBACK (Step 1) e investigar.

---

### Task 2: `.gitattributes` + renormalize + scripts executáveis

**Files:**
- Create: `D:\la-organizer\_remote\.gitattributes`

**Interfaces:**
- Consumes: `_remote/` como clone git (Task 1).
- Produces: `origin/main` ganha `.gitattributes` (eol=lf) e os `.sh` marcados 100755 (executáveis) no índice.

- [ ] **Step 1: Criar `.gitattributes`**

Conteúdo de `D:\la-organizer\_remote\.gitattributes`:
```
* text=auto eol=lf
*.sh text eol=lf
```

- [ ] **Step 2: Renormalizar EOL + marcar scripts executáveis**

```powershell
cd D:\la-organizer\_remote
git add .gitattributes
git add --renormalize .
git update-index --chmod=+x scripts/tom-relogin.sh
git ls-files -s scripts/tom-relogin.sh
```
Expected: `git ls-files -s` mostra modo `100755` pro `tom-relogin.sh`.

- [ ] **Step 3: Commit + push (direto — já é clone)**

```powershell
cd D:\la-organizer\_remote
git commit -m "chore: .gitattributes (eol=lf) + scripts executaveis no git

Co-Authored-By: Claude <noreply@anthropic.com>"
git fetch origin main; git rebase origin/main
git push origin main
```
Expected: push aceito. (Se rebase conflitar — raro — abortar e investigar; o outro chat empurrou algo.)

- [ ] **Step 4: Validar**

```powershell
git -C D:\la-organizer\_remote show --stat HEAD | Select-Object -First 15
```
Expected: o commit tem `.gitattributes` + o modo do `.sh`. VPS ainda NÃO resetada (não precisa até a Task 5).

---

### Task 3: Novo `auto-deploy.ps1` (commit/push direto + rebase + hold-TTL)

**Files:**
- Backup: `D:\la-organizer\auto-deploy.ps1.bak-<ts>` (FORA do `_remote/`, pra não entrar no git)
- Replace: `D:\la-organizer\_remote\scripts\auto-deploy.ps1`

**Interfaces:**
- Consumes: `_remote/` clone (Task 1).
- Produces: hook novo que commita/pusha do `_remote/` direto, com hold-TTL e rebase-antes-do-push.

- [ ] **Step 1: Backup do hook velho (fora do repo)**

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item "D:\la-organizer\_remote\scripts\auto-deploy.ps1" "D:\la-organizer\auto-deploy.ps1.bak-$ts" -Force
Write-Output "backup do hook: D:\la-organizer\auto-deploy.ps1.bak-$ts"
```

- [ ] **Step 2: Substituir `auto-deploy.ps1` pelo novo conteúdo**

Conteúdo COMPLETO de `D:\la-organizer\_remote\scripts\auto-deploy.ps1`:
```powershell
# auto-deploy.ps1 (v2 — _remote e clone git; sem robocopy/la-deploy-work)
# Stop hook: commita/pusha o _remote DIRETO e reseta a VPS.
$ErrorActionPreference = "SilentlyContinue"
$srcRoot = "D:\la-organizer\_remote"

# 0. HOLD com TTL — bloqueia deploy concorrente; orfao (>2h) auto-expira.
$holdFile = Join-Path (Split-Path $srcRoot -Parent) ".deploy-hold"
$holdTtlHours = 2
if (Test-Path $holdFile) {
    $age = (Get-Date) - (Get-Item $holdFile).LastWriteTime
    if ($age.TotalHours -lt $holdTtlHours) {
        Write-Output "=== DEPLOY EM HOLD (.deploy-hold, $([int]$age.TotalMinutes)min < ${holdTtlHours}h) ==="
        exit 0
    }
    Write-Output "=== HOLD ORFAO ($([int]$age.TotalHours)h >= ${holdTtlHours}h) -- apagando e seguindo ==="
    Remove-Item $holdFile -Force 2>$null
}

# 1. _remote TEM que ser clone git.
if (-not (Test-Path (Join-Path $srcRoot ".git"))) {
    Write-Output "=== ERRO: _remote nao e clone git (cutover nao feito). Abortando. ==="
    exit 0
}

# 2. Stage tudo.
git -C $srcRoot add -A 2>$null

# 3. TRAVA DE SILENCIO (quiet hours) — exit 2 = violacao (bloqueia); 1/erro = fail-open.
$guard = Join-Path $srcRoot "scripts\check-quiet-gates.js"
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if ($nodeExe -and (Test-Path $guard)) {
    $guardOut = & node $guard 2>&1 | Out-String
    if ($LASTEXITCODE -eq 2) {
        Write-Output "=== DEPLOY BLOQUEADO: trava de silencio (quiet hours) ==="
        Write-Output $guardOut
        exit 1
    }
}

# 4. Nada staged -> sai.
git -C $srcRoot diff --cached --quiet 2>$null
if ($LASTEXITCODE -eq 0) { exit 0 }

# 5. Commit.
$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
git -C $srcRoot commit -m "Auto-deploy $ts

Co-Authored-By: Claude <noreply@anthropic.com>" 2>$null
if ($LASTEXITCODE -ne 0) { exit 0 }

# 6. Incorpora o que o outro chat ja empurrou ANTES do push (nunca clobra).
$beforeSha = git -C $srcRoot rev-parse origin/main 2>$null
git -C $srcRoot fetch origin main --quiet 2>$null
git -C $srcRoot rebase origin/main 2>$null
if ($LASTEXITCODE -ne 0) {
    git -C $srcRoot rebase --abort 2>$null
    Set-Content -Path $holdFile -Value "HOLD auto: rebase-conflito no deploy $ts -- resolver a mao (git status em _remote)." -Encoding utf8
    Write-Output "=== DEPLOY ABORTADO: rebase-conflito com origin/main. Hold recriado. Resolver manualmente. ==="
    exit 0
}

# 7. Push.
git -C $srcRoot push origin main 2>$null

# 8. VPS reset + restart se backend (src/skills/migrations) mudou.
$changed = git -C $srcRoot diff --name-only $beforeSha HEAD 2>$null
$needsVPS = $changed | Where-Object { $_ -match "^(src/|skills/|migrations/)" }
if ($needsVPS) {
    ssh tom "cd /opt/LA-Organizer && git fetch origin main --quiet 2>&1 | tail -2 && git reset --hard origin/main --quiet 2>&1 | tail -2 && pm2 restart tom --no-color 2>&1 | tail -2" 2>$null
}
exit 0
```

- [ ] **Step 3: Checar a sintaxe do PowerShell (sem RODAR)**

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile("D:\la-organizer\_remote\scripts\auto-deploy.ps1", [ref]$null, [ref]$errs); if ($errs) { $errs } else { "sintaxe OK" }
```
Expected: `sintaxe OK`.

- [ ] **Step 4: Commit + push (o hold ATIVO garante que o hook novo, se rodar, sai no passo 0)**

```powershell
cd D:\la-organizer\_remote
git add scripts/auto-deploy.ps1
git commit -m "feat(deploy): hook v2 — commit/push direto do _remote clone + rebase + hold-TTL

Co-Authored-By: Claude <noreply@anthropic.com>"
git fetch origin main; git rebase origin/main; git push origin main
```
Expected: push aceito. **NÃO rodar o hook ainda** — validação end-to-end é na Task 5.

---

### Task 4: Atualizar CLAUDE.md (novo modelo de deploy)

**Files:**
- Modify: `D:\la-organizer\_remote\CLAUDE.md`

**Interfaces:**
- Produces: CLAUDE.md descrevendo o modelo de clone (remove a proibição de `git init` e a descrição do robocopy).

- [ ] **Step 1: Trocar a linha da proibição de `git init`**

Em `CLAUDE.md`, na seção "### Nunca usar", trocar:
```
- ❌ `git init` em `_remote` (`D:\la-organizer\_remote` NÃO é um git repo)
```
por:
```
- ❌ `git clone https://...` em `/tmp/deploy-*` pra deploy (o `_remote/` já é o clone; commita/pusha direto dele)
```

- [ ] **Step 2: Trocar a descrição do auto-deploy hook**

Em `CLAUDE.md`, no bloco "### 🤖 Auto-deploy hook", trocar a lista antiga (robocopy) por:
```
**Toda vez que Claude termina o turno**, o `scripts/auto-deploy.ps1` roda e:
1. Se `.deploy-hold` (raiz) existe e tem <2h → não faz nada (hold de concorrência; órfão >2h auto-expira).
2. `git add -A` no `_remote/` (que É um clone git de origin/main).
3. Trava de silêncio (quiet hours) — bloqueia se houver envio proativo sem gate.
4. Commita, faz `git rebase origin/main` (incorpora o outro chat — nunca clobra), e `git push origin main`.
5. Se `src/`/`skills/`/`migrations/` mudou → VPS `git fetch + reset --hard origin/main + pm2 restart tom`.

**`_remote/` é um clone git.** Rode `git status` nele quando quiser ver o que vai subir. Não existe mais `C:\la-deploy-work` nem robocopy.
```

- [ ] **Step 3: Commit + push**

```powershell
cd D:\la-organizer\_remote
git add CLAUDE.md
git commit -m "docs: CLAUDE.md reflete o modelo de _remote-clone (fim do robocopy/git-init-proibido)

Co-Authored-By: Claude <noreply@anthropic.com>"
git fetch origin main; git rebase origin/main; git push origin main
```

---

### Task 5: Validar o hook novo end-to-end + cutover final (remove hold, retira la-deploy-work)

**Files:**
- Remove: `D:\la-organizer\.deploy-hold`
- Retire (opcional): `C:\la-deploy-work` (órfão)

**Interfaces:**
- Consumes: tudo das Tasks 1-4 (no `origin/main`).

- [ ] **Step 1: Testar a lógica do HOLD-TTL (órfão expira, fresco bloqueia)**

```powershell
# hold ÓRFÃO (mtime 3h atrás) → hook deve apagar + seguir
$h = "D:\la-organizer\.deploy-hold"; Set-Content $h "teste orfao"; (Get-Item $h).LastWriteTime = (Get-Date).AddHours(-3)
& powershell -ExecutionPolicy Bypass -File "D:\la-organizer\_remote\scripts\auto-deploy.ps1"
Test-Path $h    # deve ser False (apagado)
```
Expected: log "HOLD ORFAO ... apagando e seguindo"; o arquivo some. (Como não há mudança pendente, o hook segue e sai no passo 4 sem commitar.)
```powershell
# hold FRESCO → hook deve bloquear
Set-Content $h "teste fresco"
& powershell -ExecutionPolicy Bypass -File "D:\la-organizer\_remote\scripts\auto-deploy.ps1"
```
Expected: log "DEPLOY EM HOLD ... < 2h"; nada acontece.

- [ ] **Step 2: Dry-run end-to-end do hook novo (com mudança boba)**

```powershell
Remove-Item "D:\la-organizer\.deploy-hold" -Force   # libera
Add-Content "D:\la-organizer\_remote\scripts\auto-deploy.ps1" "# deploy v2 validado $(Get-Date -Format o)"
$before = ssh tom "cd /opt/LA-Organizer && git rev-parse --short HEAD"
& powershell -ExecutionPolicy Bypass -File "D:\la-organizer\_remote\scripts\auto-deploy.ps1"
$after = ssh tom "cd /opt/LA-Organizer && git rev-parse --short HEAD"
Write-Output "VPS: $before -> $after"
git -C D:\la-organizer\_remote log -1 --format="%h %s"
```
Expected: o hook commitou SÓ o comentário, empurrou, e a VPS avançou pro novo HEAD (`$before` != `$after`). `git log` mostra 1 commit "Auto-deploy ...".

- [ ] **Step 3: Confirmar tom online + +x preservado após o reset da VPS**

```powershell
ssh tom "pm2 jlist" ; ssh tom "ls -l /opt/LA-Organizer/scripts/tom-relogin.sh"
```
Expected: `tom online`; `tom-relogin.sh` com `-rwxr-xr-x` (**+x preservado** — o `.gitattributes`/chmod resolveu o bug de hoje).

- [ ] **Step 4: Aposentar o `la-deploy-work` (opcional, só renomeia — reversível)**

```powershell
if (Test-Path "C:\la-deploy-work") { Rename-Item "C:\la-deploy-work" "C:\la-deploy-work.retired-$(Get-Date -Format yyyyMMdd)" }
```
Expected: pasta renomeada (o hook novo não usa mais). Deixar renomeada 1 semana antes de apagar.

- [ ] **Step 5: Verificação final + limpar backups depois de estável**

```powershell
git -C D:\la-organizer\_remote status --short
ssh tom "cd /opt/LA-Organizer && git status --short | head"
```
Expected: `_remote/` limpo (fora untracked esperado); VPS limpa no HEAD novo. Manter `_remote.bak-<ts>` e `auto-deploy.ps1.bak` até rodar limpo por ~2 dias; depois apagar.

**Rollback global (se a Task 5 mostrar algo quebrado):** restaurar `D:\la-organizer\auto-deploy.ps1.bak-<ts>` → `_remote\scripts\auto-deploy.ps1`; se o clone estiver ruim, `_remote.bak-<ts>` volta o espelho; recriar `.deploy-hold`. `origin/main` pode ser revertido com `git revert` dos commits da migração.

---

## Notas de execução
- **Inline/controller (catraca).** Não delegar — é git-state + VPS ao vivo, sequencial.
- **Ordem é sagrada:** cutover (T1) antes de tudo; o hook novo (T3) só é VALIDADO na T5 (antes disso o hold o neutraliza).
- **`origin/main`/VPS intocados até cada passo verde.** T1 é 100% local.

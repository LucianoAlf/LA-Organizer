# auto-deploy.ps1
# Chamado automaticamente pelo Stop hook do Claude Code.
# Detecta mudancas em _remote vs repositorio, faz commit+push no GitHub
# e restart na VPS se arquivos de backend foram alterados.

$ErrorActionPreference = "SilentlyContinue"

$workDir = "C:\la-deploy-work"
$srcRoot = "D:\la-organizer\_remote"
$repoUrl = "https://github.com/LucianoAlf/LA-Organizer.git"

# 1. Clone inicial ou reset para origin/main se ja existe
if (-not (Test-Path (Join-Path $workDir ".git"))) {
    git clone $repoUrl $workDir --quiet 2>$null
    if ($LASTEXITCODE -ne 0) { exit 0 }
} else {
    git -C $workDir fetch origin main --quiet 2>$null
    git -C $workDir reset --hard origin/main --quiet 2>$null
}

# 2. Sincronizar diretorios de _remote para o clone.
#    /E (sem deletar) para a maioria: src/skills/etc. podem ter arquivos so-no-repo/VPS
#    (ver project_local_vps_desync, ex.: src/supabase/client.js) que NAO devem sumir.
#    /MIR (espelha delecoes) SO para web/src: e 100% fonte-de-verdade local e e o que o
#    `tsc -b` da Vercel compila — sem /MIR, arquivo deletado local fica orfao no repo e
#    quebra o build (caso GROUPCHAT-GROUP-NOTES-V2 / DEPLOY-ORPHAN-TSC). Seguro porque o
#    web/src local compila sozinho: nada local depende de arquivo so-no-repo.
$dirs = @("web/src", "web/public", "web/api", "skills", "src", "migrations", "docs", "scripts")
$mirrorDirs = @("web/src")

foreach ($d in $dirs) {
    $src = Join-Path $srcRoot ($d -replace "/", "\")
    $dst = Join-Path $workDir ($d -replace "/", "\")
    if (Test-Path $src) {
        $mode = if ($mirrorDirs -contains $d) { "/MIR" } else { "/E" }
        robocopy $src $dst $mode /XD node_modules .git dist /NFL /NDL /NJH /NJS /nc /ns /np 2>$null | Out-Null
    }
}

# Arquivos raiz do web/ (vite.config.ts, package.json, tsconfig, etc.)
$webRootFiles = Get-ChildItem (Join-Path $srcRoot "web") -File -ErrorAction SilentlyContinue
foreach ($f in $webRootFiles) {
    Copy-Item $f.FullName (Join-Path $workDir "web\$($f.Name)") -Force 2>$null
}

# Sprint 26 — package.json + package-lock.json do TOM (raiz) versionados.
# Antes ficavam apenas no VPS; se o servidor caía, dependências viravam
# adivinhação. Agora sobem junto e auto-recovery via `npm install` funciona.
$tomRootFiles = @("package.json", "package-lock.json", "ecosystem.config.js")
foreach ($name in $tomRootFiles) {
    $src = Join-Path $srcRoot $name
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $workDir $name) -Force 2>$null
    }
}

# 2.5 TRAVA DE SILENCIO (anti-regressao quiet hours) — bloqueia o deploy se algum
#     envio proativo em src/ ficou sem gate de silencio. Exit 2 = violacao (bloqueia);
#     0 = limpo; 1/outros = erro interno do guard -> fail-open (nao bloqueia deploy).
$guard = Join-Path $workDir "scripts\check-quiet-gates.js"
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if ($nodeExe -and (Test-Path $guard)) {
    $guardOut = & node $guard 2>&1 | Out-String
    if ($LASTEXITCODE -eq 2) {
        Write-Output "=== DEPLOY BLOQUEADO: trava de silencio (quiet hours) ==="
        Write-Output $guardOut
        exit 1
    }
}

# 3. Nada mudou -> sai sem fazer nada
$status = git -C $workDir status --porcelain 2>$null
if ([string]::IsNullOrWhiteSpace($status)) { exit 0 }

# 4. Commit
$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
git -C $workDir add -A 2>$null
git -C $workDir commit -m "Auto-deploy $ts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>$null
if ($LASTEXITCODE -ne 0) { exit 0 }

# 5. Push para GitHub (Vercel auto-deploya web/ em ~2min)
git -C $workDir push origin main 2>$null

# 6. VPS restart apenas se arquivos de backend mudaram
$changed = git -C $workDir diff HEAD~1 --name-only 2>$null
$needsVPS = $changed | Where-Object { $_ -match "^(src/|skills/|migrations/)" }

# 6.1 GOVERNANCA — modo HOLD (licao 19/06, Balde A recorrencia).
#     Se a flag existe, o ENGINE (src/skills/migrations) NAO sobe pra VPS sozinho.
#     Commit+push (versionamento + web/ via Vercel) continuam; so o deploy do TOM
#     fica RETIDO ate OK explicito. Pra liberar: apague a flag e rode
#     scripts\deploy-tom.ps1. Motivo: o auto-deploy ja subiu backend antes do OK
#     do Alf/Alfredo (Balde A) — producao nunca mais muda sem aprovacao.
$holdFlag = "D:\la-organizer\.deploy-hold"

if ($needsVPS -and (Test-Path $holdFlag)) {
    Write-Output "=================================================================="
    Write-Output "  [HOLD ATIVO] backend NAO deployado na VPS (flag: $holdFlag)"
    Write-Output "  Backend commitado+pushado, MAS RETIDO do engine TOM:"
    $needsVPS | ForEach-Object { Write-Output "    - $_" }
    Write-Output "  Pra deployar: remova a flag e rode scripts\deploy-tom.ps1"
    Write-Output "=================================================================="
}
elseif ($needsVPS) {
    # Sprint 26 — fetch + reset --hard origin/main em vez de git pull.
    # Diferença crítica: reset --hard SÓ TOCA arquivos tracked. Untracked
    # (.env, .claude-tom/, node_modules/) ficam intactos. Nunca mais arrastar
    # com -u por engano. Pull com merge conflict virava intervenção manual
    # com stash -u (que apagou .env em 18/05).
    ssh tom "cd /opt/LA-Organizer && git fetch origin main --quiet 2>&1 | tail -2 && git reset --hard origin/main --quiet 2>&1 | tail -2 && pm2 restart tom --no-color 2>&1 | tail -2" 2>$null
}

exit 0

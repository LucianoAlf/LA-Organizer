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

# 2. Stage tudo (o .gitignore protege scratch/local).
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

# 4. Nada staged -> nao ha o que commitar, mas NAO sai: a VPS ainda pode estar atras.
#    Este `exit 0` era o bug. Com dois chats commitando A MAO durante o turno, a arvore chega
#    limpa aqui todo fim de turno, o hook saia, e a etapa 8 (a unica que atualiza a producao)
#    nunca rodava. Resultado real: a VPS ficou 74 commits atras por 5 dias, e so nao virou
#    incidente porque as pessoas lembravam de fazer `scp` a mao arquivo por arquivo.
git -C $srcRoot diff --cached --quiet 2>$null
$temCommit = ($LASTEXITCODE -ne 0)

$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
if ($temCommit) {
    # 5. Commit.
    git -C $srcRoot commit -m "Auto-deploy $ts

Co-Authored-By: Claude <noreply@anthropic.com>" 2>$null

    # 6. Incorpora o que o outro chat ja empurrou ANTES do push (nunca clobra).
    if ($LASTEXITCODE -eq 0) {
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
    }
}

# 8. Sincroniza a VPS pelo ESTADO DELA, nao pelo que este turno fez.
#    O criterio antigo (`diff $beforeSha HEAD`) so via o commit do proprio turno: commit feito
#    a mao, ou trabalho vindo do outro chat pelo rebase, nao disparavam deploy nenhum.
$vpsAtras = (ssh tom "cd /opt/LA-Organizer && git fetch origin main --quiet 2>/dev/null; git rev-list --count HEAD..origin/main 2>/dev/null" 2>$null) -as [int]
if ($vpsAtras -gt 0) {
    # Restart so quando muda o que o processo carrega; doc/plano nao precisa derrubar o TOM.
    $backend = (ssh tom "cd /opt/LA-Organizer && git diff --name-only HEAD origin/main 2>/dev/null | grep -cE '^(src/|skills/|migrations/)'" 2>$null) -as [int]
    Write-Output "=== VPS estava $vpsAtras commit(s) atras -- sincronizando (backend: $backend arquivo(s)) ==="
    if ($backend -gt 0) {
        ssh tom "cd /opt/LA-Organizer && git reset --hard origin/main --quiet && pm2 restart tom --no-color 2>&1 | tail -2" 2>$null
    } else {
        ssh tom "cd /opt/LA-Organizer && git reset --hard origin/main --quiet" 2>$null
    }
}
exit 0

# v2 (clone git) no ar desde 2026-07-21.

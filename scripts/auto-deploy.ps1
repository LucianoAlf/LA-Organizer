# auto-deploy.ps1 (v2 — _remote e clone git; sem robocopy/la-deploy-work)
# ATENCAO: este .ps1 nao tem BOM e o Windows PowerShell 5.1 le arquivo sem BOM como ANSI.
# Um caractere nao-ASCII dentro de STRING vira bytes que incluem aspas (o travessao vira
# `a€"`), a string fecha no lugar errado e o script inteiro para de parsear. Em COMENTARIO e
# inofensivo (o parser pula), e por isso os travessoes antigos nunca deram problema.
# Regra: comentario pode ter acento; codigo e string, so ASCII.
# Stop hook: commita/pusha o _remote DIRETO e reseta a VPS.
$ErrorActionPreference = "SilentlyContinue"
$srcRoot = "D:\la-organizer\_remote"

# 0. HOLD com TTL — bloqueia deploy concorrente; orfao (>2h) auto-expira.
#
# DEPLOYHOLD-CAMINHO-INVISIVEL (10/08/2026): o hold era procurado SO na raiz, mas todo o
# trabalho acontece dentro de _remote\ — entao criar o hold "na raiz" exige lembrar de sair do
# diretorio de trabalho, e errar era o comportamento default. Aconteceu duas vezes no mesmo dia:
# o hold foi criado em _remote\.deploy-hold, o script nunca olhou la, e o deploy subiu por cima
# de um ciclo de governanca em andamento. Nao "falhou": ele nunca existiu para o script.
# Agora vale nos DOIS caminhos — quem cria nao tem mais como errar.
$holdRaiz = Join-Path (Split-Path $srcRoot -Parent) ".deploy-hold"
$holdRemote = Join-Path $srcRoot ".deploy-hold"
$holdTtlHours = 2
foreach ($holdFile in @($holdRaiz, $holdRemote)) {
    if (-not (Test-Path $holdFile)) { continue }
    $age = (Get-Date) - (Get-Item $holdFile).LastWriteTime
    if ($age.TotalHours -lt $holdTtlHours) {
        Write-Output "=== DEPLOY EM HOLD ($holdFile, $([int]$age.TotalMinutes)min < ${holdTtlHours}h) ==="
        exit 0
    }
    Write-Output "=== HOLD ORFAO ($([int]$age.TotalHours)h >= ${holdTtlHours}h) -- apagando e seguindo ==="
    Remove-Item $holdFile -Force 2>$null
}
# Recriacao automatica (rebase-conflito, etapa 6) sempre na raiz: fora do repo, nunca versionavel.
$holdFile = $holdRaiz

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

# Estado do gate da Vercel. Inicializado aqui porque o bloco de push e condicional: sem isto
# o gate leria variavel indefinida quando o turno nao empurra nada (VPS atras por push do
# outro chat, por exemplo). `$empurrou` responde "este turno moveu main?" — se nao moveu, o
# gate pertence ao turno que moveu, nao a este.
# LOCK DE DEPLOY (laudo v2.4, bloqueador 4). Entre publicar o objeto, medir o preflight,
# empurrar e aplicar existe uma janela de minutos. Duas reconciliacoes concorrentes nessa
# janela medem uma coisa e aplicam outra. `mkdir` e atomico no POSIX — ou cria, ou falha —
# entao serve de lock sem depender de daemon nenhum. TTL para orfao nao travar o deploy para
# sempre; quem tomar o lock registra quem e e quando.
# BOOTSTRAP DO CANDIDATO (laudo v2.6, bloqueador 3). A v2.6 carregava
# /opt/LA-Organizer/scripts/lib-lock.sh -- que NAO existe no runtime v2.5 vivo -- e rodava o
# preflight da arvore VELHA para decidir se o candidato podia entrar. O pre-requisito
# escondido era eu ter feito `scp` a mao.
# Agora: os objetos do candidato vao para um ref isolado, `bootstrap-candidato.sh` e mandado
# pelo STDIN do ssh (nao precisa existir la), e ele materializa scripts/ do commit em
# /run/tom-cand-<sha> -- fora da worktree -- conferindo cada arquivo contra o blob id.
# Dai em diante, lock e preflight sao os DO CANDIDATO.
$tipBoot = ((git -C $srcRoot rev-parse HEAD 2>$null) | Out-String).Trim()
if ($tipBoot -notmatch '^[0-9a-f]{40}$') {
    Write-Output "=== DEPLOY ABORTADO: nao resolvi o tip local para o bootstrap. ==="
    exit 1
}
$bsFile = Join-Path $srcRoot "scripts\bootstrap-candidato.sh"
if (-not (Test-Path $bsFile)) {
    Write-Output "=== DEPLOY ABORTADO: scripts/bootstrap-candidato.sh ausente no clone local. ==="
    exit 1
}
function Materializar-Candidato($sha) {
    # transporta objetos para um ref isolado (nao move main, nao mexe em HEAD, nao dispara build)
    git -C $srcRoot push tom:/opt/LA-Organizer "${sha}:refs/bootstrap/$sha" --force 2>$null | Out-Null
    $out = (Get-Content -Raw $bsFile | ssh tom "bash -s -- $sha /opt/LA-Organizer" 2>$null) | Out-String
    $dir = ""
    foreach ($linha in ($out -split "`n")) { if ($linha -match '^candidato=(.+)$') { $dir = $Matches[1].Trim() } }
    if ($dir -eq "") { Write-Output ($out.Trim()) }
    return $dir
}
$candDir = Materializar-Candidato $tipBoot
if ($candDir -eq "") {
    Write-Output "=== DEPLOY ABORTADO: bootstrap do candidato falhou. Sem os guardas do candidato, nao ha gate. ==="
    exit 1
}
Write-Output "=== Candidato materializado em $candDir (fora da worktree viva) ==="

$lockDir = "/run/tom-deploy.lock"
$lockTtlMin = 30
# DONO VERIFICAVEL (laudo v2.5, bloqueador 1). O lock antigo era `mkdir` + `rm -rf` cru:
#   * quem recebia OCUPADO chamava a liberacao e APAGAVA o lock do dono. O segundo turno nao
#     entrava na janela — ele destruia a protecao do primeiro, que seguia deployando sem lock;
#   * o caminho sem commit nunca ADQUIRIA, mas soltava ao sair — apagando lock alheio.
# Agora o protocolo mora em scripts/lib-lock.sh (testavel, e por isso o bug apareceu) e cada
# turno carrega um nonce: so o dono solta.
$lockNonce = ([guid]::NewGuid()).ToString("N")
$script:lockAdquirido = $false
$libLock = "$candDir/scripts/lib-lock.sh"   # do CANDIDATO, nunca da arvore viva
function Tomar-LockDeploy {
    $r = (ssh tom ". $libLock 2>/dev/null || { echo SEM-LIB; exit 3; }; LOCK_DONO_DESC=auto-deploy-$env:COMPUTERNAME lock_tomar $lockDir $lockNonce $lockTtlMin" 2>$null) | Out-String
    $r = $r.Trim()
    if ($r -match 'ADQUIRIDO|ORFAO-REMOVIDO') { $script:lockAdquirido = $true }
    return $r
}
# Soltar SO solta o que este turno adquiriu. Duas barreiras: a flag local (nao chama a
# liberacao sem ter adquirido) e o nonce remoto (a lib recusa lock de outro dono).
# LEASE (laudo v2.6, bloqueador 9). Entre um passo e outro passam minutos. Sem renovacao,
# TTL vencido significava "deploy demorou" e o lock era roubado de um deploy VIVO, que
# seguia rodando em paralelo com quem roubou. Com heartbeat, TTL vencido passa a significar
# "ninguem renova ha X min" -- afirmacao sobre vida, nao sobre duracao.
# Devolve $false se o lock ja nao for nosso; quem chama ABORTA em vez de seguir.
function Bater-LockDeploy {
    if (-not $script:lockAdquirido) { return $false }
    $r = (ssh tom ". $libLock 2>/dev/null || exit 3; lock_heartbeat $lockDir $lockNonce && echo VIVO" 2>$null) | Out-String
    if ($r.Trim() -eq "VIVO") { return $true }
    Write-Output "=== LOCK PERDIDO: outro processo tomou a janela. Abortando antes de qualquer efeito. ==="
    $script:lockAdquirido = $false
    return $false
}

# GUARDA UNICA ANTES DE CADA EFEITO CRITICO (laudo v2.7, bloqueador 7). A v2.7 so confirmava
# posse antes do reset backend -- push, reset de docs, restart e patch-crontab entravam sem
# perguntar se o lock ainda era nosso. E o alvo so era reconferido no reset backend, entao o
# ramo docs ainda resetava `origin/main`, uma ref MUTAVEL (bloqueador 2).
# Esta funcao junta as duas coisas: renova/confirma o lease E reconfere que origin/main
# continua sendo o deploy_sha medido. Qualquer uma falhando, o efeito nao acontece.
function Confirmar-AntesDoEfeito($efeito) {
    if (-not (Bater-LockDeploy)) {
        Set-Content -Path $holdFile -Value "HOLD auto: lock perdido antes de $efeito em $ts." -Encoding utf8
        Write-Output "=== ABORTADO antes de $efeito : o lock nao e mais nosso. ==="
        return $false
    }
    if ($script:deploySha -ne $null -and $script:deploySha -ne "") {
        $agora = ((ssh tom "cd /opt/LA-Organizer && git fetch origin main --quiet && git rev-parse origin/main" 2>$null) | Out-String).Trim()
        if ($agora -ne $script:deploySha) {
            Set-Content -Path $holdFile -Value "HOLD auto: origin/main moveu antes de $efeito em $ts." -Encoding utf8
            Write-Output "=== ABORTADO antes de $efeito : origin/main moveu ($($script:deploySha.Substring(0,8)) -> $($agora.Substring(0,8))). ==="
            return $false
        }
    }
    return $true
}

function Soltar-LockDeploy {
    if (-not $script:lockAdquirido) { return }
    ssh tom ". $libLock 2>/dev/null || exit 3; lock_soltar $lockDir $lockNonce" 2>$null | Out-Null
    $script:lockAdquirido = $false
}

# AQUISICAO UNICA, ANTES DE QUALQUER CAMINHO. A v2.5 so tomava o lock dentro do ramo que
# commita; o ramo que apenas SINCRONIZA a VPS (push do outro chat) media e resetava producao
# inteiramente fora da janela protegida.
$lk = Tomar-LockDeploy
if (-not $script:lockAdquirido) {
    if ($lk -eq 'SEM-LIB') {
        Write-Output "=== DEPLOY ABORTADO: lib-lock.sh ausente na VPS -- sem protocolo de lock nao ha janela protegida. ==="
        exit 1
    }
    Write-Output "=== DEPLOY ADIADO: outra reconciliacao esta em andamento ($lk). Proximo turno tenta. ==="
    exit 0
}
Write-Output "=== Lock de deploy: $lk (nonce $($lockNonce.Substring(0,8))) ==="

# ESCOPO UNICO (laudo v2.6, bloqueador 9). Havia caminho de rollback/exit que saia sem
# soltar o lock -- e lock nao liberado trava todo deploy seguinte ate o TTL. Daqui ate o
# fim tudo roda dentro de um try/finally: qualquer saida, inclusive `exit` e excecao,
# passa pelo finally. As chamadas explicitas a Soltar-LockDeploy continuam (sao
# idempotentes) para liberar o quanto antes; o finally e a rede que pega o que escapar.
try {

$empurrou = $false
$temBaseline = $false
$webMudou = 0
$blFile = "/opt/backups/la-organizer/bundle-baseline.txt"
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
            Soltar-LockDeploy; exit 0
        }
        # 6b. PREFLIGHT ANTES DO PUSH, CONTRA O TIP CANDIDATO (laudo v2.3, bloqueador 1).
        #     A v2.2 media contra `origin/main` — o alvo VELHO, que nao e o que sera resetado.
        #     Reproduzido: alvo velho e candidato dao vereditos DIFERENTES sobre a mesma
        #     colisao untracked. Medir o alvo errado antes de um push irreversivel e pior que
        #     nao medir, porque produz confianca.
        #     Solucao: empurra os objetos do candidato para um ref ISOLADO na VPS
        #     (`refs/candidato/pendente`). Isso nao move main, nao move HEAD, nao dispara
        #     Vercel — so deixa os objetos disponiveis para o preflight medir o alvo REAL.
        $tip = (git -C $srcRoot rev-parse HEAD 2>$null) | Out-String
        $tip = $tip.Trim()
        if ($tip -notmatch '^[0-9a-f]{40}$') {
            Write-Output "=== DEPLOY ABORTADO: nao consegui resolver o tip local. ==="
            Soltar-LockDeploy; exit 1
        }
        # REF IMUTAVEL (laudo v2.3, bloqueador 7). `refs/candidato/pendente` era um nome fixo
        # e mutavel: entre conferir "o ref bate com o tip" e o preflight medir contra ele,
        # outro processo podia reescrever o ref e o preflight mediria outra arvore. O nome
        # agora CONTEM o sha, entao e enderecado por conteudo: nao existe "o mesmo ref com
        # outro conteudo". Sem --force de proposito — se ja existe com esse nome, e o mesmo
        # objeto. E o ref e apagado no fim, para nao virar lixo acumulado.
        $refCand = "refs/candidato/$tip"
        git -C $srcRoot push tom:/opt/LA-Organizer "HEAD:$refCand" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: nao consegui publicar o tip candidato na VPS no deploy $ts -- nada empurrado." -Encoding utf8
            Write-Output "=== PUSH ABORTADO: nao consegui enviar o candidato para a VPS medir. Nada empurrado. ==="
            Soltar-LockDeploy; exit 1
        }
        $refRemoto = (ssh tom "cd /opt/LA-Organizer && git rev-parse $refCand" 2>$null) | Out-String
        if ($refRemoto.Trim() -ne $tip) {
            Set-Content -Path $holdFile -Value "HOLD auto: candidato na VPS ($($refRemoto.Trim())) != tip local ($tip) no deploy $ts." -Encoding utf8
            Write-Output "=== PUSH ABORTADO: o candidato na VPS nao bate com o tip local. Nada empurrado. ==="
            Soltar-LockDeploy; exit 1
        }
        # SHA LITERAL, nao o nome do ref (laudo v2.4, bloqueador 4). A ref transporta o objeto;
        # a MEDICAO usa o sha ja verificado acima. Assim, mover a ref depois da conferencia nao
        # muda o que o preflight mede nem o que o reset aplica — o alvo e imutavel por natureza.
        # PREFLIGHT DO CANDIDATO, medindo a worktree VIVA. `PREFLIGHT_REPO` existe para isto:
        # medir sem precisar instalar o script dentro do repo medido.
        $candDir = Materializar-Candidato $tip
        if ($candDir -eq "") { Write-Output "=== PUSH ABORTADO: bootstrap do tip candidato falhou. ==="; exit 1 }
        $pfPre = (ssh tom "PREFLIGHT_REPO=/opt/LA-Organizer $candDir/scripts/preflight-deploy.sh $tip --sem-snapshot 2>&1" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: preflight contra o TIP CANDIDATO reprovou no deploy $ts -- nada foi empurrado." -Encoding utf8
            Write-Output "=== PUSH ABORTADO: a VPS tem trabalho que o reset para o candidato destruiria. ==="
            Write-Output (($pfPre -split "`n" | Select-String "RECUSADO|PREFLIGHT") -join "`n")
            Write-Output "=== Nada empurrado, main nao moveu, Vercel nao disparou. Hold criado. ==="
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== Preflight contra o candidato $($tip.Substring(0,8)): OK ==="

        # 6c. BASELINE DO BUNDLE ANTES DO PUSH (laudo v2.3, bloqueador 2). O gate da Vercel so
        #     existe se for tirado ANTES do build novo; depois nao ha com o que comparar.
        $webMudou = (git -C $srcRoot diff --name-only origin/main HEAD -- web/ 2>$null | Measure-Object).Count
        ssh tom "cd /opt/LA-Organizer && ./scripts/verificar-bundle.sh --baseline $blFile >/dev/null 2>&1" 2>$null
        $temBaseline = ($LASTEXITCODE -eq 0)
        if (-not $temBaseline) {
            # FALHA FECHADA (laudo v2.3, bloqueador 2): a v2.3 so AVISAVA e empurrava assim
            # mesmo — o gate da Vercel ficava indisponivel exatamente no deploy que ia mexer
            # no bundle. Gate opcional nao e gate. E o --baseline agora tambem reprova quando
            # o bundle tem achado nao aprovado, entao "nao consegui tirar baseline" pode
            # significar "ha segredo novo no ar". Motivo de mais para parar.
            Set-Content -Path $holdFile -Value "HOLD auto: baseline do bundle FALHOU no deploy $ts -- nada empurrado." -Encoding utf8
            Write-Output "=== PUSH ABORTADO: nao consegui tirar o baseline do bundle. ==="
            Write-Output "=== Pode ser rede, ou pode ser achado novo no bundle publico. Rodar --baseline a mao. ==="
            ssh tom "cd /opt/LA-Organizer && git update-ref -d $refCand" 2>$null
            Soltar-LockDeploy; exit 1
        }

        # 7. Push — com retorno conferido. Push que falha calado deixava o resto do script
        #    agindo como se main tivesse movido.
        # guarda adjacente (laudo v2.7, bloqueadores 2 e 7)
        if (-not (Confirmar-AntesDoEfeito "git push origin main")) { exit 1 }
        git -C $srcRoot push origin main 2>$null
        if ($LASTEXITCODE -ne 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: git push origin main FALHOU no deploy $ts." -Encoding utf8
            Write-Output "=== PUSH FALHOU (exit $LASTEXITCODE). Nada mais foi feito. Hold criado. ==="
            Soltar-LockDeploy; exit 1
        }
        $empurrou = $true
    }
}

# 8. SHA UNICO E IMUTAVEL PARA A TRANSACAO INTEIRA (laudo v2.6, bloqueador 4).
#    A v2.6 media com SHA literal so no preflight do candidato; a sincronizacao voltava a
#    falar em `origin/main` -- media A, e se outro chat empurrasse B no meio, o reset aplicava
#    B. Reproduzido pelo Alfredo. O lock da VPS nao ajuda: ele serializa a VPS, nao impede
#    ninguem de mover o GitHub.
#    Agora: um `git fetch` com rc conferido, um `rev-parse` que resolve `deploy_sha` UMA vez,
#    e esse literal em tudo -- rev-list, diff, preflight, reset, testes, health e relatorio.
#    No fim, `origin/main` e reconferido: se moveu durante a transacao, o turno REPROVA.
$fetchOut = (ssh tom "cd /opt/LA-Organizer && git fetch origin main --quiet && git rev-parse origin/main" 2>$null) | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Output "=== DEPLOY ADIADO: git fetch/rev-parse na VPS falhou (exit $LASTEXITCODE). Nada medido, nada aplicado. ==="
    exit 1
}
$script:deploySha = $fetchOut.Trim()
if ($script:deploySha -notmatch '^[0-9a-f]{40}$') {
    Write-Output "=== DEPLOY ABORTADO: nao resolvi um sha de 40 hex para origin/main (recebi '$script:deploySha'). ==="
    exit 1
}
Write-Output "=== deploy_sha = $($script:deploySha.Substring(0,8)) (literal usado em TODA a transacao) ==="

# rc conferido tambem aqui: saida vazia por erro nao pode virar "0 commits atras".
$atrasOut = (ssh tom "cd /opt/LA-Organizer && git rev-list --count HEAD..$script:deploySha" 2>$null) | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Output "=== DEPLOY ADIADO: git rev-list falhou (exit $LASTEXITCODE) -- nao sei se a VPS esta atras. ==="
    exit 1
}
$atrasTxt = $atrasOut.Trim()
if ($atrasTxt -notmatch '^\d+$') {
    Write-Output "=== DEPLOY ABORTADO: rev-list devolveu '$atrasTxt', que nao e contagem. ==="
    exit 1
}
$vpsAtras = [int]$atrasTxt
if ($vpsAtras -gt 0) {
    # 8a. CICLO DE GOVERNANCA EM ANDAMENTO -> nao mexer no disco dele.
    #     O gov-runner trabalha DENTRO de /opt/LA-Organizer e edita src/ durante a rodada. Um
    #     `git reset --hard` no meio apaga trabalho ja testado e nao-commitado: aconteceu duas
    #     vezes (09/08 e 10/08), a segunda registrada pelo proprio agente na escada dele.
    #     Reusa o flock que o dispatcher JA usa pra serializar o ciclo, em vez de inventar
    #     protocolo novo: `flock -n ... true` so testa, adquire e solta na hora.
    ssh tom "flock -n /tmp/la-gov.lock true" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Output "=== DEPLOY ADIADO: ciclo de governanca rodando (lock /tmp/la-gov.lock). VPS $vpsAtras commit(s) atras; proximo turno sincroniza. ==="
        Soltar-LockDeploy; exit 0
    }

    # Restart so quando muda o que o processo carrega; doc/plano nao precisa derrubar o TOM.
    # rc conferido: `grep -c` sai 1 quando nao ha match, e saida vazia por erro nao pode
    # virar backend=0 (que decide se o TOM e reiniciado).
    $bkOut = (ssh tom "cd /opt/LA-Organizer && git diff --name-only HEAD $script:deploySha | grep -cE '^(src/|skills/|migrations/)'; exit \${PIPESTATUS[0]}" 2>$null) | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Output "=== DEPLOY ADIADO: git diff falhou (exit $LASTEXITCODE) -- nao sei o que mudou. ==="
        exit 1
    }
    $bkTxt = $bkOut.Trim()
    if ($bkTxt -notmatch '^\d+$') {
        Write-Output "=== DEPLOY ABORTADO: contagem de backend veio '$bkTxt', que nao e numero. ==="
        exit 1
    }
    $backend = [int]$bkTxt
    Write-Output "=== VPS estava $vpsAtras commit(s) atras -- sincronizando (backend: $backend arquivo(s)) ==="

    # 8-pre. PREFLIGHT + PONTO DE RETORNO (laudo v2.2, bloqueadores 1 e 3).
    #   O preflight recusa se algum caminho — rastreado OU untracked que exista na arvore
    #   alvo — divergir do que o reset vai escrever. E `$prev` guarda o commit atual: sem
    #   ponto de retorno, uma falha DEPOIS do reset deixa HEAD e disco novos com o processo
    #   antigo, e o turno seguinte ve `HEAD..origin/main = 0` e conclui que a VPS ja esta
    #   atualizada. O deploy nunca mais e retomado e ninguem percebe.
    # de novo o preflight DO CANDIDATO (deploy_sha), nao o da arvore que sera substituida.
    $candDir = Materializar-Candidato $script:deploySha
    if ($candDir -eq "") { Write-Output "=== DEPLOY ABORTADO: bootstrap de $($script:deploySha.Substring(0,8)) falhou. ==="; exit 1 }
    $preflight = (ssh tom "PREFLIGHT_REPO=/opt/LA-Organizer $candDir/scripts/preflight-deploy.sh $script:deploySha 2>&1" 2>$null) | Out-String
    if ($LASTEXITCODE -ne 0) {
        Set-Content -Path $holdFile -Value "HOLD auto: preflight reprovou no deploy $ts -- VPS NAO resetada." -Encoding utf8
        Write-Output "=== DEPLOY ABORTADO no preflight: ==="
        Write-Output (($preflight -split "`n" | Select-String "RECUSADO|PREFLIGHT|snapshot") -join "`n")
        Soltar-LockDeploy; exit 1
    }
    Write-Output "=== Preflight OK ==="
    $prev = (ssh tom "cd /opt/LA-Organizer && git rev-parse HEAD" 2>$null) | Out-String
    $prev = $prev.Trim()
    if ($prev -notmatch '^[0-9a-f]{40}$') {
        Write-Output "=== DEPLOY ABORTADO: nao consegui registrar o ponto de retorno da VPS. ==="
        Soltar-LockDeploy; exit 1
    }

    # Volta a VPS ao estado anterior E devolve os guardas. Usada em toda falha pos-reset:
    # estado hibrido (disco novo + processo velho) e pior que nao ter feito o deploy, porque
    # se disfarca de sucesso.
    #
    # v2.3 (laudo bloqueador 3): a v2.2 escrevia "VPS revertida para $prev" sem conferir NADA
    # — nem o reset, nem a restauracao, nem o processo. Rollback que mente e a pior peca do
    # conjunto: ele e acionado justamente quando algo ja deu errado, e uma mensagem de sucesso
    # falsa ali encerra a investigacao. Agora cada etapa e verificada e o resultado e um
    # veredito honesto: REVERTIDA (tudo comprovado) ou CRITICO (intervencao humana).
    function Invoke-RollbackVps([string]$motivo) {
        Write-Output "=== ROLLBACK: $motivo -- voltando a VPS para $($prev.Substring(0,8)) ==="
        $problemas = @()

        ssh tom "cd /opt/LA-Organizer && git reset --hard $prev --quiet" 2>$null
        if ($LASTEXITCODE -ne 0) { $problemas += "reset --hard retornou erro" }
        $head = ((ssh tom "cd /opt/LA-Organizer && git rev-parse HEAD" 2>$null) | Out-String).Trim()
        if ($head -ne $prev) { $problemas += "HEAD ficou em $head, esperado $prev" }

        # modos primeiro; se os guardas nem existirem mais, restaura do snapshot
        $r = (ssh tom "cd /opt/LA-Organizer && ./scripts/pos-deploy-modos.sh 2>&1" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output $r.Trim()
            $r = (ssh tom "/opt/backups/la-organizer/guardas/restaurar-guardas.sh 2>&1" 2>$null) | Out-String
            if ($LASTEXITCODE -ne 0) { $problemas += "guardas NAO restaurados" }
        }
        Write-Output $r.Trim()

        # o processo tem que voltar a rodar o codigo anterior, e isso se prova com health
        ssh tom "pm2 restart tom --no-color >/dev/null 2>&1" 2>$null
        if ($LASTEXITCODE -ne 0) { $problemas += "pm2 restart do codigo anterior retornou erro" }
        $h = ((ssh tom "for i in 1 2 3 4 5 6 7 8 9 10; do C=`$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3100/health); [ `"`$C`" = 200 ] && { echo 200; exit 0; }; sleep 3; done; echo `"`$C`"; exit 1" 2>$null) | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { $problemas += "health nao voltou 200 apos o rollback (ultimo: $h)" }

        if ($problemas.Count -eq 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: $motivo no deploy $ts -- VPS REVERTIDA e comprovada em $prev (HEAD, guardas, health 200)." -Encoding utf8
            Write-Output "=== ROLLBACK COMPROVADO: HEAD=$($prev.Substring(0,8)), guardas ok, health 200. ==="
        } else {
            $txt = "CRITICO auto: $motivo no deploy $ts -- ROLLBACK INCOMPLETO: " + ($problemas -join '; ')
            Set-Content -Path $holdFile -Value $txt -Encoding utf8
            Write-Output "=== ROLLBACK INCOMPLETO -- NAO confie no estado da VPS: ==="
            $problemas | ForEach-Object { Write-Output "    - $_" }
            ssh tom "cd /opt/LA-Organizer && [ -x scripts/alertar.sh ] && ./scripts/alertar.sh --chave rollback-incompleto --intervalo-min 30 'TOM: ROLLBACK INCOMPLETO no deploy -- $motivo' >/dev/null 2>&1" 2>$null
        }
    }

    if ($backend -gt 0) {
        # CONFIRMA POSSE antes do efeito irreversivel, e reseta para o LITERAL medido.
        # guarda adjacente (laudo v2.7, bloqueadores 2 e 7)
        if (-not (Confirmar-AntesDoEfeito "reset backend")) { exit 1 }
        # (a reconferencia de origin/main mora dentro de Confirmar-AntesDoEfeito, para que a
        #  guarda fique ADJACENTE ao efeito e nao haja codigo entre uma e outro)
        ssh tom "cd /opt/LA-Organizer && git reset --hard $script:deploySha --quiet" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Invoke-RollbackVps "o proprio reset --hard falhou"
            Soltar-LockDeploy; exit 1
        }

        # 8a. MODOS DEPOIS DO RESET — a trava que faltava (laudo v2, bloqueador 1).
        #     Git so grava 100644/100755; a contencao vive em 0750/0640. Medido em repo
        #     descartavel: `reset --hard` sobrescreve untracked sem recusar e derruba 0750
        #     para 0644 — os crons de backup/sentinela/varredura param, e `alertar.sh` sem
        #     +x faz o guard `[ -x ]` da sentinela emudecer o canal junto.
        #     O runbook manual consertava UMA vez; o proximo deploy reabria tudo. Por isso
        #     mora AQUI, no caminho que roda de verdade, e antes do restart.
        $modos = (ssh tom "cd /opt/LA-Organizer && ./scripts/pos-deploy-modos.sh 2>&1" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output $modos.Trim()
            Invoke-RollbackVps "modos de contencao errados apos o reset"
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== Modos reaplicados: $($modos.Trim()) ==="

        # 8b. SUITE ANTES DO RESTART — a trava que faltava.
        #     Ate 10/08 o restart vinha primeiro e a verificacao era humana, DEPOIS: se dois
        #     trabalhos concorrentes conflitassem, a gente descobria com o TOM ja no ar. Rodar
        #     aqui inverte a ordem. Seguro porque o disco ja foi atualizado mas o PROCESSO ainda
        #     roda o codigo anterior: suite vermelha = nao reinicia = producao segue no que
        #     funcionava. Baseline 3 = os testes de loadout de prompt que falham por env ausente.
        #     POR IDENTIDADE, nao por contagem (laudo v2.2, bloqueador 4). `fail <= 3` aprovava
        #     QUALQUER conjunto de ate 3 vermelhos: os 3 conhecidos podiam virar verdes e 3
        #     regressoes novas entrarem no lugar, com o mesmo numero e o mesmo verde. Contar
        #     falhas nao e o mesmo que reconhece-las. Os 3 conhecidos sao os de
        #     system-loadout.test.js (falta TEST_COLLAB_ID no ambiente do cron), e a linha
        #     `not ok` traz so o NOME do teste — o arquivo aparece na linha `location:`.
        $tapOut = (ssh tom "cd /opt/LA-Organizer && timeout 240 node --env-file=.env --test src/ 2>&1" 2>$null) | Out-String
        $falhas = if ($tapOut -match '# fail (\d+)') { [int]$Matches[1] } else { -1 }
        $total  = if ($tapOut -match '# tests (\d+)') { [int]$Matches[1] } else { 0 }
        # Por NOME, e a comparacao acontece na VPS contra o arquivo versionado
        # scripts/suite-vermelhos-conhecidos.txt — fonte unica, a mesma que o smoke usa.
        # Contar vermelhos por ARQUIVO deixava passar regressao nova dentro daquele arquivo.
        $desconhecidos = ($tapOut | ssh tom "cd /opt/LA-Organizer && grep -v '^#' scripts/suite-vermelhos-conhecidos.txt | grep -v '^[[:space:]]*`$' | LC_ALL=C sort -u > /tmp/.kn.`$`$; cat > /tmp/.tap.`$`$; grep '^not ok' /tmp/.tap.`$`$ | sed -E 's/^not ok [0-9]+ - //' | LC_ALL=C sort -u > /tmp/.rd.`$`$; LC_ALL=C comm -13 /tmp/.kn.`$`$ /tmp/.rd.`$`$ | grep -c . || true; rm -f /tmp/.kn.`$`$ /tmp/.rd.`$`$ /tmp/.tap.`$`$" 2>$null) | Out-String
        $desconhecidos = [int]($desconhecidos.Trim())

        if ($falhas -lt 0 -or $total -lt 100) {
            Invoke-RollbackVps "nao consegui medir a suite (tests=$total)"
            Soltar-LockDeploy; exit 1
        }
        #     A regra e IDENTIDADE, nao numero: todo vermelho tem que estar em
        #     system-loadout.test.js, e no maximo os 3 conhecidos. Assim:
        #       fail=3 todos em loadout  -> passa (o baseline conhecido)
        #       fail=0                   -> passa (se alguem exportar TEST_COLLAB_ID no cron os
        #                                  3 ficam verdes; bloquear deploy porque o teste
        #                                  MELHOROU seria a trava trabalhando contra si mesma)
        #       qualquer vermelho fora   -> reprova (a regressao que a suite existe para pegar)
        #       fail=4+ mesmo em loadout -> reprova (vermelho novo naquele arquivo)
        if ($desconhecidos -gt 0 -or $falhas -gt 3) {
            Write-Output "=== Suite: fail=$falhas de $total; $desconhecidos vermelho(s) NAO reconhecido(s) pelo nome ==="
            Invoke-RollbackVps "vermelhos fora dos 3 conhecidos (por nome)"
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== Suite OK ($total testes; $falhas vermelho(s), todos reconhecidos pelo nome) -- reiniciando ==="
        # guarda adjacente (laudo v2.7, bloqueadores 2 e 7)
        if (-not (Confirmar-AntesDoEfeito "pm2 restart")) { exit 1 }
        ssh tom "cd /opt/LA-Organizer && pm2 restart tom --no-color 2>&1 | tail -2" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Invoke-RollbackVps "pm2 restart retornou erro"
            Soltar-LockDeploy; exit 1
        }

        # 8b2. HEALTH + SMOKE OBRIGATORIOS (laudo v2.2, bloqueador 4). Restart sem retorno era
        #      um verde por omissao: o comando voltava, ninguem perguntava se o processo subiu.
        #      A fase `reconciliacao` roda tudo menos o gate do P0-4, que reprova por desenho
        #      enquanto o segredo estiver no bundle (bloqueador 5).
        $health = (ssh tom "for i in 1 2 3 4 5 6 7 8 9 10; do C=`$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3100/health); [ `"`$C`" = 200 ] && { echo 200; exit 0; }; sleep 3; done; echo `"`$C`"; exit 1" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output "=== Health nao voltou 200 apos o restart (ultimo: $($health.Trim())) ==="
            Invoke-RollbackVps "TOM nao respondeu health apos o restart"
            ssh tom "pm2 restart tom --no-color 2>&1 | tail -1" 2>$null
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== Health 200 apos o restart ==="

        $smoke = (ssh tom "cd /opt/LA-Organizer && ./scripts/smoke-pos-aplicacao.sh --fase reconciliacao 2>&1 | tail -20" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output $smoke.Trim()
            Invoke-RollbackVps "smoke de reconciliacao reprovou apos o restart"
            ssh tom "pm2 restart tom --no-color 2>&1 | tail -1" 2>$null
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== Smoke de reconciliacao aprovado ==="

        # 8c. GUARDA-COSTAS PÓS-RESTART. Barato de proposito (segundos): confere que os 4
        #     scripts agendados seguem executaveis e que os 4 marcadores continuam no
        #     crontab. Nao roda o smoke completo aqui — smoke pesado no caminho quente
        #     de TODO deploy vira flaky que bloqueia entrega. Isto so responde
        #     "os guardas sobreviveram a este deploy?", que e a pergunta do dia.
        # CRON INSTALADO PELO CAMINHO CANONICO (laudo v2.5, bloqueador 9). O auto-deploy
        # VALIDAVA os cinco marcadores mas nunca os instalava -- eles estavam vivos porque eu
        # ROLLBACK TRANSACIONAL (laudo v2.6, bloqueador 2). O `--reverter` nao aceita mais
        # "o backup mais novo": ele exige o caminho do backup criado por ESTA tentativa,
        # que o `--aplicar` imprime como `backup=<caminho>`. Se a aplicacao falhar antes de
        # criar o backup, nao ha o que reverter -- e nao reverter e o resultado correto,
        # porque restaurar o passado de outra tentativa troca CURRENT por OLD.
        # guarda adjacente (laudo v2.7, bloqueadores 2 e 7)
        if (-not (Confirmar-AntesDoEfeito "patch-crontab --aplicar")) { exit 1 }
        $cron = (ssh tom "cd /opt/LA-Organizer && ./scripts/patch-crontab.sh --aplicar 2>&1 | tail -12" 2>$null) | Out-String
        $rcCron = $LASTEXITCODE
        $cronBackup = ""
        foreach ($linha in ($cron -split "`n")) {
            if ($linha -match '^backup=(.+)$') { $cronBackup = $Matches[1].Trim() }
        }
        if ($rcCron -ne 0) {
            if ($cronBackup -ne "") {
                ssh tom "cd /opt/LA-Organizer && ./scripts/patch-crontab.sh --reverter $cronBackup" 2>$null | Out-Null
                Write-Output "=== Crontab revertido para o backup desta tentativa: $cronBackup ==="
            } else {
                Write-Output "=== Crontab NAO foi alterado (a tentativa falhou antes do backup) -- nada a reverter. ==="
            }
            Set-Content -Path $holdFile -Value "HOLD auto: patch-crontab --aplicar FALHOU no deploy $ts." -Encoding utf8
            Write-Output "=== DEPLOY ABORTADO: nao consegui instalar os crons dos guardas. ==="
            Write-Output $cron.Trim()
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== Crons dos guardas instalados (backup desta tentativa: $cronBackup) ==="
        $guardas = (ssh tom "cd /opt/LA-Organizer && F=0; for s in backup-db backup-secrets check-backup conter-permissoes alertar pos-deploy-modos; do [ -x scripts/\$s.sh ] || { echo \"sem +x: \$s.sh\"; F=1; }; done; for m in tom-backup-db tom-backup-secrets tom-check-backup tom-varrer-permissoes tom-restore-drill; do crontab -l 2>/dev/null | grep -q -- \"# \$m\$\" || { echo \"cron faltando: \$m\"; F=1; }; done; [ \$F -eq 0 ] && echo 'guardas ok: 6 scripts executaveis, 5 crons presentes'; exit \$F" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: guardas de seguranca quebrados apos deploy $ts -- $($guardas.Trim())" -Encoding utf8
            Write-Output "=== ATENCAO: TOM reiniciou, mas os guardas NAO passaram: ==="
            Write-Output $guardas.Trim()
            Write-Output "=== Hold criado. Backup/sentinela/varredura podem estar mudos. ==="
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== $($guardas.Trim()) ==="
    } else {
        # Caminho de docs: tambem passa pelo preflight (8-pre, acima) e tambem reseta — logo
        # tambem derruba os modos. Nao ha restart aqui, mas ha o mesmo estado hibrido possivel,
        # entao usa o mesmo ponto de retorno.
        # guarda adjacente (laudo v2.7, bloqueadores 2 e 7)
        if (-not (Confirmar-AntesDoEfeito "reset de docs/script-only")) { exit 1 }
        ssh tom "cd /opt/LA-Organizer && git reset --hard $script:deploySha --quiet" 2>$null
        if ($LASTEXITCODE -ne 0) { Invoke-RollbackVps "reset --hard de docs falhou"; exit 1 }
        $modosDoc = (ssh tom "cd /opt/LA-Organizer && ./scripts/pos-deploy-modos.sh 2>&1" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output $modosDoc.Trim()
            Invoke-RollbackVps "modos errados apos o reset de docs"
            Soltar-LockDeploy; exit 1
        }
        Write-Output "=== Docs sincronizados. $($modosDoc.Trim()) ==="
    }

    # 9. GATE DA VERCEL NO CAMINHO CANONICO (laudo v2.3, bloqueador 2). A v2.2 documentava que
    #    o automatico fazia isso e o codigo nao fazia — o smoke so via HTTP 200, que uma pagina
    #    de erro tambem devolve. Roda nos DOIS ramos de proposito: mudanca so em `web/` cai no
    #    ramo de docs (o filtro de backend e src|skills|migrations), entao amarrar o gate ao
    #    ramo de backend deixaria justamente o deploy de front sem gate nenhum.
    if (-not $empurrou) {
        Write-Output "=== Gate Vercel nao se aplica: este turno nao moveu main (sincronizacao de push alheio). ==="
    } elseif ($temBaseline) {
        # DUAS PERGUNTAS DIFERENTES (laudo v2.3, bloqueador 2). A v2.3 usava
        # `--aceitar-inalterado` automatico quando web/ nao mudava — ou seja, afirmava
        # "o bundle e o mesmo porque nada mudou", que e suposicao vestida de medicao, e
        # ainda por cima sem provar que houve deployment. Nao da para provar READY sem a API
        # da Vercel (x-vercel-id e id de REQUISICAO, nao de deploy), entao paro de fingir que
        # provo e passo a afirmar so o que da para medir:
        #   web/ MUDOU     -> exijo bundle novo e comparo com o baseline (--pos-deploy).
        #                     Se nao mudar na janela: INDETERMINADO, nao aprovado.
        #   web/ NAO MUDOU -> nao ha o que esperar. Rodo o detector simples, que exige que o
        #                     bundle SERVIDO tenha exatamente os achados aprovados. Isso
        #                     responde a pergunta de seguranca ("tem segredo novo no ar?")
        #                     sem alegar nada sobre deployment.
        Write-Output "=== Gate Vercel (web/ com $webMudou arquivo(s) alterado(s)) ==="
        if ($webMudou -gt 0) {
            # web/ MUDOU: exige bundle novo e comparacao com o baseline. E, para amarrar ao
            # COMMIT exato com estado READY, seria preciso a API da Vercel — que este host nao
            # tem credencial para chamar. Sem isso nao ha como provar "este deployment e o do
            # commit X e esta READY", entao o gate NAO declara aprovado: devolve INDETERMINADO
            # e para. `x-vercel-id` nao serve: e id de REQUISICAO, nao de deployment.
            # --commit <sha> (laudo v2.5, bloqueador 2). Sem o commit, o modo compara so
            # CONTEUDO -- e conteudo igual nao diz de qual deployment o bundle veio. Com o
            # commit, o script tenta PROVAR (API da Vercel ou carimbo servido) e devolve 2
            # quando nao consegue. Neste host nao ha VERCEL_TOKEN, entao o resultado honesto
            # e INDETERMINADO -- que segura o deploy em vez de carimba-lo de verificado.
            $vb = (ssh tom "cd /opt/LA-Organizer && BUNDLE_ESPERA_SEG=300 ./scripts/verificar-bundle.sh --pos-deploy $blFile --commit $tip 2>&1 | tail -12" 2>$null) | Out-String
            $rcVb = $LASTEXITCODE
        } else {
            # web/ NAO mudou: nao ha deployment novo a esperar, e a pergunta que importa e de
            # seguranca — "o bundle servido tem exatamente os achados aprovados?". O modo
            # --conferir-esperados responde isso. O modo normal serviria de nada aqui: ele sai
            # 1 sempre que existe achado nao-allowlistado, e o P0-4 e um achado conhecido e
            # aceito. Reprovar todo deploy por um problema ja registrado ensina a ignorar o gate.
            $vb = (ssh tom "cd /opt/LA-Organizer && ./scripts/verificar-bundle.sh --conferir-esperados 2>&1 | tail -8" 2>$null) | Out-String
            $rcVb = $LASTEXITCODE
        }
        Write-Output $vb.Trim()

        # CADA CODIGO TRATADO EXPLICITAMENTE, e desconhecido FALHA FECHADO (laudo v2.4,
        # bloqueador 3). Antes havia um `else` generico que engolia qualquer retorno nao
        # previsto como se fosse sucesso — o formato exato de falso-verde que este gate existe
        # para nao ter.
        switch ($rcVb) {
            0 {
                if ($webMudou -gt 0) {
                    # rc 0 aqui SO acontece com prova de deployment: o script devolve 2 sem ela.
                    Write-Output "=== Gate Vercel APROVADO: conteudo conferido E deployment do commit $($tip.Substring(0,8)) provado READY ==="
                } else {
                    # web/ nao mudou: nao ha deployment novo a provar. O que foi respondido e
                    # a pergunta de SEGURANCA, e a mensagem nao pode sugerir mais do que isso.
                    Write-Output "=== Gate Vercel: bundle publico com exatamente os achados aprovados (web/ inalterado; nenhuma afirmacao sobre deployment) ==="
                }
            }
            1 {
                Set-Content -Path $holdFile -Value "CRITICO auto: gate da Vercel REPROVOU no deploy $ts -- bundle publico com achado inesperado." -Encoding utf8
                ssh tom "cd /opt/LA-Organizer && [ -x scripts/alertar.sh ] && ./scripts/alertar.sh --chave gate-vercel --intervalo-min 60 'TOM: gate do bundle publico REPROVOU apos deploy' >/dev/null 2>&1" 2>$null
                Write-Output "=== ATENCAO: bundle publico com achado inesperado. TOM segue no ar; investigar antes do proximo deploy. ==="
                Soltar-LockDeploy; exit 1
            }
            2 {
                Set-Content -Path $holdFile -Value "HOLD auto: gate da Vercel INDETERMINADO no deploy $ts -- build pode nao ter terminado." -Encoding utf8
                Write-Output "=== Gate Vercel INDETERMINADO: nao consegui provar o deployment do commit $($tip.Substring(0,8)) em estado READY. ==="
                Write-Output "=== Confirme no painel e rode --pos-deploy de novo. NAO estou declarando o deploy verificado. ==="
                Soltar-LockDeploy; exit 1
            }
            3 {
                Set-Content -Path $holdFile -Value "HOLD auto: gate da Vercel nao pode rodar no deploy $ts (baseline/allowlist ilegivel)." -Encoding utf8
                Write-Output "=== Gate Vercel INDISPONIVEL (rc=3): arquivo de referencia ilegivel. ==="
                Soltar-LockDeploy; exit 1
            }
            default {
                Set-Content -Path $holdFile -Value "HOLD auto: gate da Vercel devolveu codigo DESCONHECIDO ($rcVb) no deploy $ts." -Encoding utf8
                Write-Output "=== Gate Vercel devolveu codigo desconhecido ($rcVb) -- falhando fechado por desenho. ==="
                Soltar-LockDeploy; exit 1
            }
        }
    } else {
        Set-Content -Path $holdFile -Value "HOLD auto: deploy $ts sem baseline do bundle -- gate da Vercel NAO foi executado." -Encoding utf8
        Write-Output "=== Gate Vercel NAO executado (sem baseline). Hold criado para nao passar por verificado. ==="
        Soltar-LockDeploy; exit 1
    }
}
exit 0
}
finally {
    # a rede: solta o lock em QUALQUER saida deste escopo.
    Soltar-LockDeploy
}

# v2 (clone git) no ar desde 2026-07-21.

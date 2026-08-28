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
            exit 0
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
            exit 1
        }
        $refRemoto = (ssh tom "cd /opt/LA-Organizer && git rev-parse $refCand" 2>$null) | Out-String
        if ($refRemoto.Trim() -ne $tip) {
            Set-Content -Path $holdFile -Value "HOLD auto: candidato na VPS ($($refRemoto.Trim())) != tip local ($tip) no deploy $ts." -Encoding utf8
            Write-Output "=== PUSH ABORTADO: o candidato na VPS nao bate com o tip local. Nada empurrado. ==="
            exit 1
        }
        $pfPre = (ssh tom "cd /opt/LA-Organizer && ./scripts/preflight-deploy.sh $refCand --sem-snapshot 2>&1" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: preflight contra o TIP CANDIDATO reprovou no deploy $ts -- nada foi empurrado." -Encoding utf8
            Write-Output "=== PUSH ABORTADO: a VPS tem trabalho que o reset para o candidato destruiria. ==="
            Write-Output (($pfPre -split "`n" | Select-String "RECUSADO|PREFLIGHT") -join "`n")
            Write-Output "=== Nada empurrado, main nao moveu, Vercel nao disparou. Hold criado. ==="
            exit 1
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
            exit 1
        }

        # 7. Push — com retorno conferido. Push que falha calado deixava o resto do script
        #    agindo como se main tivesse movido.
        git -C $srcRoot push origin main 2>$null
        if ($LASTEXITCODE -ne 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: git push origin main FALHOU no deploy $ts." -Encoding utf8
            Write-Output "=== PUSH FALHOU (exit $LASTEXITCODE). Nada mais foi feito. Hold criado. ==="
            exit 1
        }
        $empurrou = $true
    }
}

# 8. Sincroniza a VPS pelo ESTADO DELA, nao pelo que este turno fez.
#    O criterio antigo (`diff $beforeSha HEAD`) so via o commit do proprio turno: commit feito
#    a mao, ou trabalho vindo do outro chat pelo rebase, nao disparavam deploy nenhum.
$vpsAtras = (ssh tom "cd /opt/LA-Organizer && git fetch origin main --quiet 2>/dev/null; git rev-list --count HEAD..origin/main 2>/dev/null" 2>$null) -as [int]
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
        exit 0
    }

    # Restart so quando muda o que o processo carrega; doc/plano nao precisa derrubar o TOM.
    $backend = (ssh tom "cd /opt/LA-Organizer && git diff --name-only HEAD origin/main 2>/dev/null | grep -cE '^(src/|skills/|migrations/)'" 2>$null) -as [int]
    Write-Output "=== VPS estava $vpsAtras commit(s) atras -- sincronizando (backend: $backend arquivo(s)) ==="

    # 8-pre. PREFLIGHT + PONTO DE RETORNO (laudo v2.2, bloqueadores 1 e 3).
    #   O preflight recusa se algum caminho — rastreado OU untracked que exista na arvore
    #   alvo — divergir do que o reset vai escrever. E `$prev` guarda o commit atual: sem
    #   ponto de retorno, uma falha DEPOIS do reset deixa HEAD e disco novos com o processo
    #   antigo, e o turno seguinte ve `HEAD..origin/main = 0` e conclui que a VPS ja esta
    #   atualizada. O deploy nunca mais e retomado e ninguem percebe.
    $preflight = (ssh tom "cd /opt/LA-Organizer && ./scripts/preflight-deploy.sh origin/main 2>&1" 2>$null) | Out-String
    if ($LASTEXITCODE -ne 0) {
        Set-Content -Path $holdFile -Value "HOLD auto: preflight reprovou no deploy $ts -- VPS NAO resetada." -Encoding utf8
        Write-Output "=== DEPLOY ABORTADO no preflight: ==="
        Write-Output (($preflight -split "`n" | Select-String "RECUSADO|PREFLIGHT|snapshot") -join "`n")
        exit 1
    }
    Write-Output "=== Preflight OK ==="
    $prev = (ssh tom "cd /opt/LA-Organizer && git rev-parse HEAD" 2>$null) | Out-String
    $prev = $prev.Trim()
    if ($prev -notmatch '^[0-9a-f]{40}$') {
        Write-Output "=== DEPLOY ABORTADO: nao consegui registrar o ponto de retorno da VPS. ==="
        exit 1
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
        ssh tom "cd /opt/LA-Organizer && git reset --hard origin/main --quiet" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Invoke-RollbackVps "o proprio reset --hard falhou"
            exit 1
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
            exit 1
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
            exit 1
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
            exit 1
        }
        Write-Output "=== Suite OK ($total testes; $falhas vermelho(s), todos reconhecidos pelo nome) -- reiniciando ==="
        ssh tom "cd /opt/LA-Organizer && pm2 restart tom --no-color 2>&1 | tail -2" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Invoke-RollbackVps "pm2 restart retornou erro"
            exit 1
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
            exit 1
        }
        Write-Output "=== Health 200 apos o restart ==="

        $smoke = (ssh tom "cd /opt/LA-Organizer && ./scripts/smoke-pos-aplicacao.sh --fase reconciliacao 2>&1 | tail -20" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output $smoke.Trim()
            Invoke-RollbackVps "smoke de reconciliacao reprovou apos o restart"
            ssh tom "pm2 restart tom --no-color 2>&1 | tail -1" 2>$null
            exit 1
        }
        Write-Output "=== Smoke de reconciliacao aprovado ==="

        # 8c. GUARDA-COSTAS PÓS-RESTART. Barato de proposito (segundos): confere que os 4
        #     scripts agendados seguem executaveis e que os 4 marcadores continuam no
        #     crontab. Nao roda o smoke completo aqui — smoke pesado no caminho quente
        #     de TODO deploy vira flaky que bloqueia entrega. Isto so responde
        #     "os guardas sobreviveram a este deploy?", que e a pergunta do dia.
        $guardas = (ssh tom "cd /opt/LA-Organizer && F=0; for s in backup-db backup-secrets check-backup conter-permissoes alertar pos-deploy-modos; do [ -x scripts/\$s.sh ] || { echo \"sem +x: \$s.sh\"; F=1; }; done; for m in tom-backup-db tom-backup-secrets tom-check-backup tom-varrer-permissoes; do crontab -l 2>/dev/null | grep -q -- \"# \$m\$\" || { echo \"cron faltando: \$m\"; F=1; }; done; [ \$F -eq 0 ] && echo 'guardas ok: 6 scripts executaveis, 4 crons presentes'; exit \$F" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Set-Content -Path $holdFile -Value "HOLD auto: guardas de seguranca quebrados apos deploy $ts -- $($guardas.Trim())" -Encoding utf8
            Write-Output "=== ATENCAO: TOM reiniciou, mas os guardas NAO passaram: ==="
            Write-Output $guardas.Trim()
            Write-Output "=== Hold criado. Backup/sentinela/varredura podem estar mudos. ==="
            exit 1
        }
        Write-Output "=== $($guardas.Trim()) ==="
    } else {
        # Caminho de docs: tambem passa pelo preflight (8-pre, acima) e tambem reseta — logo
        # tambem derruba os modos. Nao ha restart aqui, mas ha o mesmo estado hibrido possivel,
        # entao usa o mesmo ponto de retorno.
        ssh tom "cd /opt/LA-Organizer && git reset --hard origin/main --quiet" 2>$null
        if ($LASTEXITCODE -ne 0) { Invoke-RollbackVps "reset --hard de docs falhou"; exit 1 }
        $modosDoc = (ssh tom "cd /opt/LA-Organizer && ./scripts/pos-deploy-modos.sh 2>&1" 2>$null) | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output $modosDoc.Trim()
            Invoke-RollbackVps "modos errados apos o reset de docs"
            exit 1
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
            $vb = (ssh tom "cd /opt/LA-Organizer && BUNDLE_ESPERA_SEG=300 ./scripts/verificar-bundle.sh --pos-deploy $blFile 2>&1 | tail -12" 2>$null) | Out-String
        } else {
            $vb = (ssh tom "cd /opt/LA-Organizer && ./scripts/verificar-bundle.sh 2>&1 | tail -8" 2>$null) | Out-String
        }
        $rcVb = $LASTEXITCODE
        Write-Output $vb.Trim()
        if ($rcVb -eq 1) {
            # literal novo (ou achado conhecido sumindo) no bundle PUBLICO: nao se reverte a
            # VPS por isso — sao sistemas independentes — mas ninguem segue sem saber.
            Set-Content -Path $holdFile -Value "CRITICO auto: gate da Vercel REPROVOU no deploy $ts -- bundle publico mudou de forma nao esperada." -Encoding utf8
            ssh tom "cd /opt/LA-Organizer && [ -x scripts/alertar.sh ] && ./scripts/alertar.sh --chave gate-vercel --intervalo-min 60 'TOM: gate do bundle publico REPROVOU apos deploy' >/dev/null 2>&1" 2>$null
            Write-Output "=== ATENCAO: bundle publico com achado inesperado. TOM segue no ar; investigar antes do proximo deploy. ==="
            exit 1
        }
        if ($rcVb -eq 2) {
            Set-Content -Path $holdFile -Value "HOLD auto: gate da Vercel INDETERMINADO no deploy $ts -- build pode nao ter terminado." -Encoding utf8
            Write-Output "=== Gate Vercel INDETERMINADO: confirmar no painel se o deployment ficou READY e rodar --pos-deploy de novo. ==="
            exit 1
        }
        Write-Output "=== Gate Vercel aprovado ==="
    } else {
        Set-Content -Path $holdFile -Value "HOLD auto: deploy $ts sem baseline do bundle -- gate da Vercel NAO foi executado." -Encoding utf8
        Write-Output "=== Gate Vercel NAO executado (sem baseline). Hold criado para nao passar por verificado. ==="
        exit 1
    }
}
exit 0

# v2 (clone git) no ar desde 2026-07-21.

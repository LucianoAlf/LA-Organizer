# deploy-tom.ps1 — Deploy MANUAL e EXPLICITO do engine TOM (src/skills/migrations) na VPS.
#
# Use quando o modo HOLD (.deploy-hold) reteve mudancas de backend e o deploy foi APROVADO.
# Pre-requisito: as mudancas ja estao commitadas/pushadas em origin/main (o auto-deploy.ps1
# faz commit+push mesmo em HOLD — so o deploy do engine fica retido).
#
# Governanca (licao 19/06, Balde A): exige DOIS passos deliberados pra producao mudar —
#   (1) remover a flag de HOLD;  (2) rodar este script.
# Assim o engine TOM nunca sobe sem OK explicito.

$ErrorActionPreference = "Stop"
$holdFlag = "D:\la-organizer\.deploy-hold"

if (Test-Path $holdFlag) {
    Write-Output "BLOQUEADO: a flag de HOLD ainda existe -> $holdFlag"
    Write-Output ""
    Write-Output "Se o deploy do backend foi REALMENTE aprovado, remova a flag primeiro:"
    Write-Output "    Remove-Item '$holdFlag'"
    Write-Output "...e rode este script de novo."
    exit 1
}

Write-Output "Deployando engine TOM na VPS (git fetch + reset --hard origin/main + pm2 restart)..."
ssh tom "cd /opt/LA-Organizer && git fetch origin main 2>&1 | tail -2 && git reset --hard origin/main 2>&1 | tail -2 && pm2 restart tom --no-color 2>&1 | tail -3 && echo '--- status ---' && pm2 info tom --no-color | grep -E 'status|restarts|uptime'"

Write-Output ""
Write-Output "Deploy concluido. Confira status/restarts acima e os logs:"
Write-Output "    ssh tom `"pm2 logs tom --lines 30 --nostream`""

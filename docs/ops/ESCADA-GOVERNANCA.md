# Escada de evolução do agente de governança

O agente LÊ este arquivo no início de cada rodada e ESCREVE nele no fim, quando tiver
evidência. Subir de degrau é mudança no próprio agente — **precisa de OK do Alf ou do Hugo no
grupo**, não cabe na autonomia dele.

## Onde estamos

**Degrau 1** — o LLM executa todas as etapas, guiado pelo protocolo.

## Os degraus

| degrau | o que é | quando sobe |
|---|---|---|
| 1 | LLM executa tudo, guiado pelo protocolo | — |
| 2 | as etapas que provarem ser mecânicas viram código | uma etapa erra ≥3× no mesmo padrão |
| 3 | pipeline determinístico; LLM só onde exige julgamento | maioria das etapas no degrau 2 |

## Regra para propor subida

Não proponha melhoria genérica ("acho que devia ser mais determinístico"). Proponha a partir
do próprio erro medido, com o caso na mão:

> etapa X falhou N vezes, no padrão Y. Casos: [links/códigos]. Proposta: virar código assim.

## Registro de falhas por etapa

### ETAPA 5 — o comando de teste do protocolo não roda nesta VPS ✅ RESOLVIDO (09/08)

**Ocorrências:** 1 (09/08). **Corrigido no mesmo dia — o protocolo já manda `node --test src/`.**

> ⚠️ Este registro descreve o protocolo **como ele era antes do fix**. Os dois arquivos vão
> juntos no seu system prompt: vale o que está na ETAPA 5 do PROTOCOLO, não o literal citado
> abaixo. Está aqui como histórico do incidente, não como instrução.

O protocolo mandava `node --test "src/**/*.test.js"`. A VPS roda **Node v20.20.2**, e suporte a
glob no `--test` só entrou no Node 21 — o comando morria com
`Could not find '/opt/LA-Organizer/src/**/*.test.js'`. O que funciona é `node --test src/`, e
o baseline `fail 3` (env ausente, `src/prompts/system-loadout.test.js`) se reproduz igual.

Risco concreto: o agente lê "não achei os testes", conclui que não dá pra validar e ou pula a
ETAPA 5 ou reverte um fix bom. Proposta de virar código: o `gov-runner` expõe o comando de
suíte como uma função só, e o protocolo cita a função em vez do literal.

### ETAPA 6/7 — trabalho não-commitado é apagado por deploy externo no meio da rodada

**Ocorrências:** 2 (09/08, 10/08). **É a falha mais cara registrada até aqui — e reincidiu.**

> ⚠️ **REINCIDÊNCIA EM 10/08, PIOR QUE A PRIMEIRA — e a regra 1 abaixo, como estava escrita,
> NÃO teria salvado.** Duas coisas novas foram medidas:
>
> 1. **O arquivo de teste NÃO é rede de segurança.** Em 09/08 ele sobreviveu por ser untracked.
>    Em 10/08 o alvo era `src/lib/coord-send-honesty.test.js`, que **já existia no repo** — o
>    `reset --hard` apagou o fix (`coord-send-honesty.js`) **e** o teste, juntos. O que denunciou
>    foi um `system-reminder` mostrando o arquivo sem a edição; sem isso, o `grep` de conferência
>    é que teria pego. Não conte com o teste para denunciar.
> 2. **Commit local não protege — só `push` protege.** O reflog mostra `reset: moving to
>    origin/main`. Um commit local em `main` que não está em `origin` é simplesmente abandonado
>    pelo reset. A regra 1 dizia "commitar"; o que ela precisa dizer é **commitar E dar push**,
>    senão ela dá uma falsa sensação de segurança.
>
> Cronologia de 10/08: `HEAD` no início `078b73b`; dois resets durante a rodada
> (`078b73b` → `de59bb3`), o segundo no meio da ETAPA 5. `src/engine.js` sobreviveu por sorte de
> timing (a edição caiu entre os dois resets). Correção refeita e publicada em `74bf803`.
>
> Isto reforça a proposta de virar código que já estava aqui embaixo, e acrescenta uma:
> **o `gov-runner` deveria segurar o auto-deploy enquanto a rodada de governança corre** (o
> mecanismo de `.deploy-hold` descrito no CLAUDE.md já existe para exatamente esse tipo de
> concorrência — a rodada de governança simplesmente não o usa).

O que aconteceu: a correção da rodada (12 pontos de saída dos interceptors de fatura passando
a gravar em `conversation_history`) foi feita, testada e ficou **verde** no `engine.js`. Em
seguida o agente foi para a varredura do acervo, que é longa. Durante a varredura, um deploy
externo mexeu no `HEAD` (`e0127aa` → `b75fef1`) e o `git reset --hard origin/main` do
auto-deploy **apagou o `engine.js` modificado**. Só sobrou o arquivo de teste, por ser
untracked — e foi ele que denunciou, ao voltar vermelho na re-execução da suíte.

Quase-erro evitado: sem a re-execução da suíte no fim, o relatório teria anunciado uma
correção que **não existia mais no disco**. É a mesma classe de confabulação do restart
fantasma de 09/08 08:21 — afirmar entrega sem verificar.

Duas regras que isto sugere, ambas mecânicas:

1. **Commitar a correção antes de começar a varredura**, não no fim da rodada. A varredura só
   escreve no banco; a correção é a única coisa que o `reset --hard` consegue destruir.
2. **Re-rodar a suíte imediatamente antes de escrever o relatório**, sempre — e não confiar no
   resultado medido antes da varredura.

Proposta de virar código: o `gov-runner` guarda o SHA do `HEAD` no início da rodada e, antes de
postar, compara com o `HEAD` atual; se mudou, avisa no relatório em vez de deixar o LLM
descobrir por acaso.

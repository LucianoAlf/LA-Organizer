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

### ETAPA 5 — o comando de teste do protocolo não roda nesta VPS

**Ocorrências:** 1 (09/08).

O protocolo manda `node --test "src/**/*.test.js"`. A VPS roda **Node v20.20.2**, e suporte a
glob no `--test` só entrou no Node 21 — o comando morre com
`Could not find '/opt/LA-Organizer/src/**/*.test.js'`. O que funciona é `node --test src/`, e
o baseline `fail 3` (env ausente, `src/prompts/system-loadout.test.js`) se reproduz igual.

Risco concreto: o agente lê "não achei os testes", conclui que não dá pra validar e ou pula a
ETAPA 5 ou reverte um fix bom. Proposta de virar código: o `gov-runner` expõe o comando de
suíte como uma função só, e o protocolo cita a função em vez do literal.

### ETAPA 6/7 — trabalho não-commitado é apagado por deploy externo no meio da rodada

**Ocorrências:** 1 (09/08). **É a falha mais cara registrada até aqui.**

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

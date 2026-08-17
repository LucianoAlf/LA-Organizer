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

### ETAPA 2 (varredura) — "o guard existe e nasceu depois do incidente" NÃO é prova

**Ocorrências:** 1 (13/08), mas medida em cima de 152 achados de uma vez.

Tentei industrializar a varredura: rodei os 152 abertos não-altos contra os guards
determinísticos que existem hoje (`sync-excuse-guard`, `mechanism-leak`, `promise-honesty`,
`inventory-error-message`) e filtrei por "o regex casa E o guard nasceu **depois** do
incidente". Deu **9 candidatos — e 8 eram falsos.**

O erro: o `REPLY_PROMISE_RE` do `promise-honesty` casa em "Te cobro depois", "me avisa?" — mas
aqueles achados são de pedido DERRUBADO, e o TOM já tinha sido honesto ("_não consegui
registrar_"). O guard casa o texto e mesmo assim **não conserta o bug do achado**. Casar regex
≠ consertar. Só sobrou 1 verdadeiro (`eb518cfa`, erro cru de inventário), e ele só ficou de pé
porque rodei a string exata pela função e comparei a saída.

Segundo resultado, mais caro: eu ia fechar em lote a família do `optimistic-confirm` (7
achados de 25/06 a 02/07, todos com "✅ …" + "_não consegui registrar_" na mesma mensagem) por
parecer óbvio que meses de correção já teriam pego. **Rodei os textos reais e o chokepoint não
dispara em nenhum**: `hasCompletionClaim` dá `false` em "Ficam abertas agora: …", "• Reunião
com Juliana ✓ … Junho encerrado redondo", "As 3 tarefas já estão no banco". O gate é verbo de
conclusão em 1ª pessoa; **afirmação de ESTADO ("já estão no banco", "ficam abertas") passa
inteira.** Se eu tivesse fechado por parecer, teria enterrado um buraco real e ainda declarado
progresso.

Regra que isto sugere, e que já segui nesta rodada: **na varredura, o que fecha um achado é a
saída da função rodada com o literal do banco — não o regex casar, não a data bater.** Data e
regex servem pra escolher o candidato; a prova é a execução.

Proposta de virar código: o `gov-runner` expõe um `provar(literal, guard)` que roda o texto e
devolve `{antes, depois, mudou}`; o agente só pode fechar um achado da varredura anexando esse
retorno no `verified_note`. Sem o retorno, o fechamento é recusado.

### ETAPA 2 (varredura) — nem um COMENTÁRIO que cita o caso pelo nome é prova

**Ocorrências:** 2 (13/08, 14/08). **Reincidiu — e em 14/08 num filtro que eu achava seguro.**

Em 13/08 aprendi que "o regex casa e o guard nasceu depois do incidente" não fecha achado. Em
14/08 tentei um filtro mais forte, que parecia inatacável: **cruzar as datas citadas nos
comentários do `src/` com as datas dos achados abertos**, e só considerar candidato quando o
comentário nomeasse a PESSOA e a HORA. Deu 3 candidatos. **Só 1 sobreviveu à execução.**

O que derrubou os outros dois:

- `8efa7be0` (Rafinha, 26/06 09:18 BRT — "Coloca o prazo até final de julho" respondendo a um
  card de projeto). O comentário em `src/engine.js:9432` **cita o caso literalmente**: "Caso
  Rafinha: 'Coloca o prazo até final de julho' … → finance-edit redirect curto-circuitava o
  handler de tarefa". Fix datado 27/06, posterior ao incidente. Eu ia fechar. Rodei: o
  `detectCorrection`/`detectFinanceEditIntent` devolve `null` **nas duas versões** (a de 26/06 e
  a de hoje) — ou seja minha reprodução estava errada, o desvio de 26/06 nunca passou por ali.
  Rodei então pelo `pickSkill`: **`financeiro-pessoal` ainda hoje**, com a fala real roteando
  `null`. O achado não só não estava corrigido como revelou um QUARTO irmão da família de
  quote-contamination que o fix desta mesma rodada não cobriu.
- `545b8fe0` (Alf, 02/07 07:00 BRT). O `stripMechanismLeak` dispara e limpa o vazamento
  ("convite sai quando o `engine` confirmar"). Mas o achado é `frustration` — "usuário repetiu a
  demanda". Tirar a linha do vazamento **não faz a demanda parar de ser repetida**. Guard verde,
  achado aberto.

A regra de 13/08 continua valendo e ganha uma segunda metade: **o candidato só vira fechamento
quando a execução reproduz o SINTOMA DO ACHADO — não quando um guard qualquer muda a saída.**
Antes de rodar, escreva qual saída, se aparecer, prova o achado; se a execução não bate com o
que você escreveu, a hipótese caiu, não o achado.

**Medição de população, feita na mesma rodada:** a frase "não consegui registrar" (o maior
cluster do acervo, ~12 achados abertos de 24/06 a 09/07) aparecia em **0,98% das respostas na
janela dos achados (29/2946)** e aparece em **0,91% nas últimas duas semanas (20/2201)**. Seis
semanas e dezenas de correções depois, o patamar é o MESMO. Isso é evidência forte de que essa
família não é fila de bug pontual — é raiz aberta.

Proposta de virar código (reforça a de 13/08): além do `provar(literal, guard)`, o `gov-runner`
deveria exigir do agente uma **predição escrita ANTES da execução** ("espero ver X; X prova o
achado porque Y") e recusar o fechamento quando a saída medida não for a predita.

### ETAPA 3/4 — a reprodução usa a FORMA errada de argumento e o falso resultado vira veredito

**Ocorrências:** 2 (14/08, 15/08). **Nas duas o erro estava na minha reprodução, não no código.**

Em 14/08 (`8efa7be0`) rodei o caso pelo `detectCorrection`/`detectFinanceEditIntent`, deu `null`,
e por pouco não li isso como "o desvio não passa por aqui" — a reprodução é que estava no lugar
errado; o `pickSkill` mostrou o bug vivo.

Em 15/08 o mesmo padrão, agora com o sinal INVERTIDO — mais perigoso, porque falha para o lado
de "ainda quebrado" e nada te avisa. Testando o achado `4ab5a8ad` (Kailane, briefing de domingo)
chamei `isQuietNow(uuid, new Date('2026-06-21T22:19:55Z'), 'work')` e recebi
`{quiet:false}` — leitura: guard não pega, achado segue aberto. **Errado.** A assinatura é
`isQuietNow(collabOrId, now, context)` onde `now` é `{hour, minute, dow}` (documentado em
`quiet-hours.js:8`), não um `Date`. Com um `Date`, `now.dow` é `undefined` e
`w.days.includes(undefined)` é sempre `false`: **o silêncio inteiro fica invisível e o guard
devolve "não é quiet" para qualquer entrada.** Re-rodado com `{hour:19,minute:19,dow:0}`:
`{quiet:true, reason:"quiet_day_work:0"}`, e o achado fechou com prova.

O que salvou: a predição escrita antes de rodar (regra de 14/08). Eu tinha escrito "espero
`quiet:true` com razão de quiet_day"; o medido veio `quiet:false` **e sem reason nenhum** — um
guard que ignora a config não devolve nem o motivo. A discrepância entre o predito e o medido é
que mandou conferir a assinatura em vez de aceitar o resultado.

Regra que isto sugere: **quando a execução devolve o resultado NEUTRO (`false`/`null`/`{}`),
confira a assinatura antes de concluir qualquer coisa.** Resultado neutro é o que uma chamada
malformada devolve — é indistinguível de "o guard não pega", e só a assinatura desempata.
Resultado positivo é auto-evidente; resultado neutro exige uma chamada de controle que você
saiba que DEVE disparar (aqui: `dow:0` vs `dow:1` no mesmo colaborador).

Proposta de virar código: o `provar(literal, guard)` do `gov-runner` (proposto em 13/08) deve
rodar **dois** casos por fechamento — o do incidente e um controle que obrigatoriamente dispara —
e recusar o fechamento quando os dois derem o mesmo resultado neutro, porque aí o que está
quebrado é a chamada, não o código sob teste.

### ETAPA 2 (varredura) — metade do acervo antigo é IRREFUTÁVEL por construção

**Ocorrências:** 1 (16/08), mas é uma medição de população, não um caso isolado.

O protocolo manda varrer o acervo do mais antigo para o mais novo, na expectativa de que "quase
todos são anteriores a dezenas de correções e devem cair como 'já corrigido'". **Em 16/08 a
varredura fechou ZERO por "já corrigido"** — três ângulos independentes, todos honestamente
negativos:

1. Cruzamento por `marker_logs` (chokepoint `promise_nomarker`) em todos os abertos não-altos:
   só 2 casaram, e nos dois o guard segue disparando **corretamente** ("✅ Academia e bombinha da
   Alice — anotado!" é promessa vazia de verdade). O fix do dia não os alcança.
2. Guard a guard: `falha-diz-alvo` só dispara com `okCount===0` (não cobre "Registrei 1 de 2");
   `task-done-recente` injeta instrução com janela de 10 min (não cobre "já foram feitos há muito
   tempo"); `count-honesty` compara prosa contra markers do MESMO turno (não cobre contagem de
   fechamento semanal).
3. Ao ir buscar o literal, o motivo real apareceu.

**A medição.** No subconjunto inequívoco (evidência com `USUÁRIO:`, janela ±2h, casamento por 25
caracteres): **37 achados, 19 literais recuperados, 18 ausentes — 49%.** E **10 dos 18 não têm
NENHUMA mensagem inbound na janela de ±2h**: a conversa inteira sumiu do `conversation_history`.

Consequência direta no protocolo: a ETAPA 3 exige o literal do banco, e a regra de 13/08 exige
rodar esse literal pela função. **Para ~metade do acervo antigo, esses dois passos são impossíveis
— não por falta de esforço, mas porque a evidência não existe mais.** Esses achados não podem ser
nem confirmados nem refutados; ficam abertos para sempre e inflam o número que a ETAPA 1 lê. O
acervo não é uma fila que a refutação drena; é uma fila com um piso duro.

Dos 19 recuperáveis, a maioria se confirmou BUG REAL e ficou aberta (`edba1c46`, `da5f0750`,
`cfdf9bdb`, `ded67aeb`, `bf25d692`, `4b815042`, `784e4eb0`, `de6a1feb`, `c7fe3096`, `735239a9`,
`03f2c79b`). O único fechamento possível foi por **falso positivo do auditor** (3): `f63e65fa`
(resumo dizia "usuário repetiu a solicitação"; o literal mostra duas perguntas distintas, ambas
atendidas de primeira) e `733a461a`/`b15b871f`, que são **o mesmo turno duplicado** — mesmo
`occurred_at` ao microssegundo — e onde o TOM acertou ao pedir esclarecimento.

Três propostas de virar código, em ordem de retorno:

1. **Marcar `irrefutavel` no próprio achado.** Um passe do `gov-runner` tenta recuperar o literal
   de cada aberto; falhando, grava `status='irrefutavel'` com a razão. Sem isso o agente re-tenta
   os mesmos 18 toda rodada e paga o custo de novo.
2. **O auditor deveria persistir o literal no finding, no momento em que abre.** A causa raiz é
   que o achado guarda um `summary` gerado e um ponteiro para uma conversa que depois some. Se o
   turno viesse anexado, a refutação seria sempre possível.
3. **Deduplicar por `occurred_at` + colaborador na abertura.** `733a461a` e `b15b871f` são o mesmo
   evento contado duas vezes no acervo.

### ETAPA 3/4 — o resultado NEUTRO reincidiu, e a regra de 15/08 PAGOU

**Ocorrências:** 3 (14/08, 15/08, 17/08). **Em 17/08 a regra funcionou: pegou o erro na hora.**

Verificando o alto `771b5bc1` (Rose, "apaga a fatura Itaú de R$ 950,21" → apagou Canva de
R$34,90) rodei `resolveTxnTarget` com o literal e recebi `{kind:'none'}` — o resultado que o fix
`b29a726` promete. Ia anotar "corrigido". O controle que a regra de 15/08 obriga
(`'apaga a de 34,90'`, valor que EXISTE entre os candidatos) devolveu **`none` também**. Dois
neutros → chamada malformada, não veredito.

Lendo a função: o regex captura só a parte inteira (`34`) e compara com
`Math.round(Number(c.amount))`, que para `34.90` dá **35**. O controle nunca poderia casar. Com
um candidato de valor inteiro (`180`) o controle virou `one:merc`, e o segundo controle
(`'apaga isso'`, sem referência) virou `one:canva` — o fallback legítimo, preservado. Só então a
comparação antes/depois teve valor: pré-`b29a726` o caso Rose dava **`one:canva`** (o sintoma
exato), pós dá `none`.

Refinamento que isto acrescenta à regra: **o controle tem que ser escolhido contra a COMPARAÇÃO
que a função faz, não contra "um valor que existe nos dados".** Aqui o dado existia e mesmo assim
não casava, porque a comparação é sobre o inteiro arredondado. Controle mal escolhido é
indistinguível de código quebrado — e produz exatamente o mesmo neutro que ele deveria desempatar.

### ETAPA 2 (varredura) — `auto_triage.decision='suppress'` NÃO é evidência, nem a 0.95

**Ocorrências:** 1 (17/08), medida no candidato de MAIOR confiança do acervo.

O acervo traz `auto_triage` com `decision`, `matched_code` e `match_confidence`. É tentador
tratar `suppress` + confiança alta como "já corrigido" e fechar em lote — são só 7 entre os 145
abertos não-altos, o que parece uma varredura barata e segura.

Testei a de confiança mais alta. `de012fc1` (Anne, 05/08 22:05 BRT): `suppress`,
`match_confidence 0.95`, `matched_code CONFAB-WRITE-DATE-NO-RELLABEL`, cujo KI está `corrigido`
em 09/08 — **posterior ao incidente**, o filtro clássico. O literal: _"Pode mudar e colocar pra
amanhã"_ numa QUARTA (05/08) → o TOM respondeu _"reagendei pra amanhã (sex 07/08)"_, quando
amanhã era quinta 06/08.

Rodei o guard com o literal, nas duas hipóteses do que foi gravado (06/08 e 07/08):
`corrigeRotuloDeEscrita` devolve **`{corrigiu:false, motivo:'data_colada'}` nas duas**. O próprio
módulo documenta o porquê — uma data numérica colada ao rótulo ("amanhã (sex 07/08)") é território
do `date-claim.js`, e ele se abstém de propósito. Controle sem data colada corrige normalmente
(`amanhã` → `sexta (07/08)`), então a chamada estava boa. **O achado segue aberto e a supressão de
0.95 estava errada.**

Isto estende a regra de 13/08 para um alvo novo: antes eu tinha medido que *eu* não podia fechar
por regex+data; agora está medido que **o pipeline de auto-triagem fecha pelo mesmo critério fraco
que me é proibido**, e erra no caso em que está mais confiante.

Proposta de virar código: o `auto_triage` não deveria poder gravar `suppress` só com
`matched_code` + comparação de datas. Deveria ser obrigado a rodar o literal pelo guard do
`matched_code` (o mesmo `provar(literal, guard)` proposto em 13/08) e registrar `{antes, depois}`
no próprio campo; sem isso, `decision` no máximo `candidato`, nunca `suppress`.

### ETAPA 2 (varredura) — "mesma família do fix de hoje" quase virou fechamento

**Ocorrências:** 3 (13/08, 14/08, 17/08). É a mesma regra reincidindo pela terceira vez.

A correção de 17/08 (`DUP-INTENT-NOT-CLOSED-CHOICE13`) fechou a intent de dup nas escolhas "1"/"3".
Na varredura apareceu `06576ec4` (Ana, 07/07 07:05 BRT): menu de dup oferecendo _"Liberar a folha
para conferência da Direção"_, usuária responde **"2"**, e o TOM cria **"Avisar William sobre
treinamentos"** — outra tarefa. Mesmo sintoma de superfície do achado que eu tinha acabado de
corrigir, mesma família, mesmo dia da mesma pessoa.

Não é o mesmo bug. O meu era intent RESPONDIDA que ficava aberta e era ressuscitada por uma
afirmativa posterior. Neste, o `pendingDupTasks` é um Map **chaveado só por `collab.id`**: menus de
dup sucessivos no mesmo turno sobrescrevem um ao outro, e o "2" amarra no último escrito, não no
menu exibido. O meu fix não encosta nisso — fechar `06576ec4` apontando pro meu KI teria enterrado
um buraco vivo e ainda declarado progresso.

Regra: **"mesma família" é o começo da investigação, nunca a conclusão dela.** O que fecha continua
sendo a execução reproduzindo o sintoma DAQUELE achado. Vale inclusive — principalmente — contra o
fix que você mesmo acabou de escrever, que é quando a tentação é maior.

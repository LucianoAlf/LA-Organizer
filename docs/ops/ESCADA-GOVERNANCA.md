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

### ETAPA 3 — a medição "49% do acervo é IRREFUTÁVEL" (16/08) era ARTEFATO de coluna errada

**Ocorrências:** 1 (18/08), mas invalida uma conclusão que já estava na memória e na escada.

Em 16/08 ficou registrado que ~metade do acervo antigo não tem mais o literal em
`conversation_history` (18 de 37), e que por isso a ETAPA 3 seria impossível nesses achados. **Está
errado.** A query daquela medição selecionava `role` e filtrava `role === 'user'`. A tabela não tem
`role`: as colunas são **`direction`** (`inbound`/`outbound`) e `content`. No supabase-js, pedir
coluna inexistente devolve `error` com `data === null` — e um `(data || []).filter(...)` em cima
disso dá **0 sem estourar exceção**. O resultado é indistinguível de "a conversa sumiu".

Refeito hoje com `direction`, sobre os 152 abertos não-altos:

- 74 achados trazem literal rotulado (`USUÁRIO:`) na evidência;
- **71 desses 74 têm o literal recuperável** em `conversation_history` (janela ±24h);
- **67 caem dentro de ±2h**, e o desalinhamento entre `occurred_at` e o instante real da fala tem
  **mediana 0 min, p90 2 min** — `occurred_at` é confiável, ao contrário do que eu suspeitei no meio
  da rodada (suspeita nascida de viés de seleção: eu só tinha olhado os casos de 1 inbound);
- só **3** são de fato irrefutáveis.

Ou seja: ~71 achados antigos estavam contabilizados como impossíveis de refutar e **não são**. O
piso duro do acervo, descrito em 16/08 como estrutural, não existe.

Isto é a mesma classe do neutro de 15/08 (`isQuietNow` com `Date`), agora numa query em vez de numa
função: **resultado neutro em BLOCO — 60 de 60 zerados — é sintoma de chamada malformada, não de
acervo vazio.** O que me fez desconfiar foi rodar um controle (achados recentes, cujo literal eu
tinha recuperado na mesma rodada) e ver que ele também vinha zerado.

Proposta de virar código: o `gov-runner` expõe `literalDoAchado(finding)` — uma única função que
sabe o schema, faz o casamento e devolve `{literal, quando, distanciaMin}` ou `null`. Enquanto cada
rodada reescrever a query à mão, esse erro volta. E o `provar(literal, guard)` proposto em 13/08
deveria consumir essa função em vez de receber texto solto.

### ETAPA 2 (varredura) — mudar de veredito entre a época e hoje NÃO fecha: falta provar o GATE

**Ocorrências:** 1 (18/08). É o filtro mais forte que testei até agora, e mesmo assim errou.

Montei o que parecia ser finalmente a prova certa, e mecânica: para cada achado, extrair o literal
do banco, reconstruir a versão do módulo **na data do incidente** (`git rev-list -1 --before=...`) e
rodar o mesmo literal nas duas versões. Só vira candidato quem **muda de veredito**. Sobre 162
execuções, deu **2 candidatos** — `cbd0c7b2` e `688dc7e6` (Yuri, 28/07 20:37 BRT), literal
`"Todas feitas"`, `antes=null → hoje=yes`, exatamente o `CONFIRM-QUANTIFIER-BLIND`. O `summary`
descrevia o sintoma ao pé da letra ("confirmou que todas as tarefas foram feitas, mas TOM não deu
baixa e pediu confirmação de novo"). Datas certas, sintoma certo, execução certa. Eu ia fechar os dois.

**Os dois seguem abertos.** O fix é *gated* em `allowDone`, e `allowDone` não é escolha minha: sai de
`_anchoredComplete || _batchComplete` (`engine.js:10164-10169`), lido do payload da intent ABERTA
naquele turno. Fui buscar em `pending_intents`: a intent viva às 20:37 (`8853b9d3`) tem payload
`{last_tom_reply, last_user_text}` — **sem `action`, sem `anchor`, sem `batch_complete`**. Logo
`allowDone=false`, e com `allowDone=false` o código de hoje devolve `null` para `"Todas feitas"`
(a própria suíte fixa isso: _"FIX quantificador segue GATED"_). O turno cairia no LLM hoje igual.

Regra que isto acrescenta: **quando o fix é gated, rodar a função com o gate LIGADO prova só que o
fix existe — não que ele alcança o caso.** O gate tem que ser lido do estado real daquele turno
(aqui, `pending_intents`), nunca assumido. Chamar com `{allowDone:true}` porque "era um fluxo de
conclusão" é a versão sofisticada de fechar por parecer.

Subproduto: isso revela um buraco vivo, não corrigido (deixado aberto, fora do teto de 1/rodada).
A intent de RE-PERGUNTA — criada justamente porque o fechamento em lote falhou — nasce com payload
`{last_tom_reply, last_user_text}` e **perde o contexto de ação**. Ou seja, `allowDone` está
desligado exatamente no turno em que o usuário responde a um "confirma que já foi feito?". Todo o
vocabulário de conclusão ("todas feitas", "já fiz", "feito") fica cego na re-pergunta, que é o
segundo tempo de um fluxo que já falhou uma vez.

### ETAPA 3 — `occurred_at` aponta o turno ERRADO, e o erro empurra para "não reproduzi"

**Ocorrências:** 1 rodada (19/08), mas 4 achados de 6 investigados. **Contradiz a medição de 18/08.**

Em 18/08 ficou registrado que `occurred_at` é confiável (desalinhamento com mediana 0 min, p90 2 min).
Isso vale para o subconjunto que aquela medição olhou — achados cuja evidência tem rótulo `USUÁRIO:`.
Hoje investiguei achados cuja evidência é rotulada `TOM:`, e o quadro é outro:

| achado | `occurred_at` | turno real | desvio |
|---|---|---|---|
| `7701ee2f` | 11/07 11:09 | 11/07 09:37 | −1h32 |
| `bffe4be4` | 18/06 20:30 | 18/06 14:02 | −6h28 |
| `1e85605f` | 25/06 21:01 | 25/06 19:31 | −1h30 |
| `766df0bd` | 19/06 00:18 | 19/06 00:18 | 0 |

O caso caro é o `7701ee2f`. O `occurred_at` não caiu num turno vazio: caiu num turno em que **o mesmo
fluxo, com a mesma pessoa, no mesmo dia, FUNCIONOU** — 11:08:51 "Aviso o Luciano? Confirma?" →
"Confirma" → "📨 Recado enviado!". Quem confere pelo `occurred_at` mede o sucesso, conclui "não
reproduz" e fecha como falso positivo. O incidente real estava 1h32 antes: três afirmativas
seguidas ("Confirma", "Confirmo", "Sim, avisa") e a mesma pergunta de volta nas três.

Isto é pior que o buraco de 16/08. Lá o literal sumia e o achado ficava irrefutável — falha visível.
Aqui a evidência errada **produz um veredito confiante e invertido**: o filtro empurra para o lado de
"já está bom", que é justamente o lado onde o erro enterra bug vivo e ainda declara progresso.

Regra: **não use `occurred_at` para localizar o turno. Use o literal da evidência como agulha**
(`conversation_history`, `ilike`, `direction` conforme o rótulo) e trate o `occurred_at` só como
desempate quando a agulha casar em mais de um ponto. Quando o turno encontrado pelo `occurred_at`
mostrar o comportamento CERTO, isso não é refutação — é sinal de que a agulha ainda não foi lançada.

Proposta de virar código: é o `literalDoAchado(finding)` já proposto em 18/08, com uma correção de
desenho — ele deve buscar **pela agulha primeiro** e só depois usar a janela temporal, e deve devolver
`{literal, quando, distanciaMin, viaAgulha:true|false}`. Enquanto a busca for ancorada em tempo, este
erro volta, e volta silencioso.

### ETAPA 2 (varredura) — o CHOKEPOINT apaga a própria evidência

**Ocorrências:** 1 (19/08), medida sobre o maior cluster do acervo.

A família "não consegui registrar" é **23 dos 153 abertos não-altos** — o maior alvo isolado, e o
alvo natural do fix desta rodada. Cruzei os 23 contra `marker_logs` para rodar o literal pelo gate.
Não dá, e a razão é estrutural: o `raw_excerpt` da linha `CHOKEPOINT/redirected` guarda **a nota já
rebaixada**, não a resposta original. A entrada que o gate precisa receber é exatamente a que o
guard destruiu ao disparar.

Só 3 dos 23 tinham alguma linha `ACTIONABLE_NO_MARKER` (que preserva o texto pré-rebaixamento), e
nenhuma alinhava com o turno do incidente. No caso Dudu 18/08 — a correção desta rodada — a resposta
original sobreviveu **por acaso**, porque havia uma linha `ACTIONABLE_NO_MARKER` separada, não por
desenho.

Consequência prática: o fix de hoje é gated em `restatesRecentWrite`, que precisa da resposta
original E de um título persistido em até 180s. **Nenhum dos 23 pode ser fechado por ele** — fechar
seria a terceira reincidência do erro "mesma família = conclusão" (13/08, 14/08, 17/08).

Proposta de virar código: gravar a resposta ORIGINAL no `raw_excerpt` (ou num campo irmão) quando o
chokepoint rebaixa. Sem isso, o maior cluster do acervo é permanentemente improvável — e é o cluster
que mais gera achado novo.

### ETAPA 2 (varredura) — resultado da rodada: refutação NÃO drena acervo antigo

**Ocorrências:** 2 (16/08, 19/08). Reincidiu, e a expectativa do protocolo continua errada.

O protocolo diz que na varredura "quase todos são anteriores a dezenas de correções e devem cair como
'já corrigido'". Segunda rodada seguida em que isso **não se confirma**: de 6 achados antigos
investigados a fundo hoje, **zero** caíram por "já corrigido". Caíram 2, e por outros motivos —
1 falso positivo do auditor (`766df0bd`) e 1 que não era bug (`94cbe50e`, feature). Os outros 4 se
confirmaram bugs VIVOS, com raiz localizada no código de hoje (`bffe4be4`, `1e85605f`, `e84dd423`,
`7701ee2f`).

O acervo antigo não é um estoque de coisas já resolvidas esperando baixa: é uma fila de bugs reais
que ninguém corrigiu, porque o teto de 1 correção/rodada é muito menor que a taxa de entrada. A
varredura, feita com rigor, **produz diagnóstico — não produz baixa**. Isso é útil (os 4 saem da
rodada com raiz escrita e arquivo:linha), mas quem lê "varredura sem teto" esperando o acervo
encolher vai continuar decepcionado.

Proposta: o valor real da varredura é o `verified_note` com raiz provada, que transforma um achado
de 2 meses em algo corrigível em minutos na próxima rodada. Vale medir isso explicitamente — quantos
achados anotados viraram correção depois — em vez de medir quantos fecharam.

### ETAPA 4 — o TESTE do fix usa a frase limpa; a entrada real traz prefixo e a rota muda

**Ocorrências:** 1 (20/08), mas medida **dentro de um fix escrito por uma rodada anterior**.

O protocolo já manda reproduzir com a entrada real do turno (regra de 08/08, 8 tentativas em branco).
Até hoje isso valia para a MINHA reprodução. Em 20/08 apareceu o mesmo erro do outro lado: um fix
**já mergeado, verde na suíte, e morto em produção**.

`aaacef90` (Rafinha, 17/08 12:44 BRT) é o caso citado no cabeçalho de
`src/prompts/skill-lista-trabalho-routing.test.js` — "coloca no checklist aí, telão de LED
finalizado". O fix `62b13964` (18/08) abriu o gatilho de adição explícita e o teste passa. Rodei o
LITERAL do banco pelo `pickSkill`: **`tratamento-audio` ANTES e `tratamento-audio` HOJE — não mudou.**

O isolamento é de uma linha: a mesma frase **sem** o prefixo `[áudio transcrito] ` roteia para
`listas-pessoais`; **com** o prefixo, `tratamento-audio` a captura antes. O teste do fix usa a frase
limpa. Os controles confirmam que a chamada estava boa (`"coloca na minha lista aí…"` foi
`null → listas-pessoais`; o retrieve `"me manda a lista de compras"` ficou igual nas duas). Ou seja:
o fix funciona para texto digitado e **não alcança nenhum pedido por áudio** — que era exatamente a
natureza do caso que o motivou.

Regra: **o fixture do teste de um fix não substitui o literal do banco.** Quando for verificar se um
fix alcança o caso, puxe a entrada de `conversation_history`, não a string do `.test.js` — mesmo (e
principalmente) quando o cabeçalho do teste cita o caso pelo nome e pela hora.

Proposta de virar código: o `literalDoAchado(finding)` proposto em 18/08 e 19/08 resolve isto de
graça, e vale estender o uso — todo teste que se declara "prova de reversão de um achado" deveria
poder puxar a entrada do banco em vez de embutir uma paráfrase. Um passe do `gov-runner` pode
comparar o fixture de cada teste-de-achado com o literal real e apontar as divergências.

### ETAPA 2 (varredura) — o lever que FINALMENTE drenou: data + nome do colaborador nos comentários

**Ocorrências:** 3 (16/08, 19/08, 20/08) — e em 20/08 o resultado **inverteu**.

Nas duas rodadas anteriores registrei que a varredura não fecha nada por "já corrigido". Em 20/08
isso deixou de valer, e a diferença foi o gerador de candidatos, não mais rigor.

Os levers que deram **zero**: (a) cruzar todos os 151 abertos não-altos contra o guard do dia
(`sanitizeOptimisticConfirm` antes/depois) — 91 com agulha, 67 literais recuperados, **1 mudou**, e
esse 1 era um turno já tratado; (b) procurar o id do achado citado no `src/` — **0 ocorrências em
151**, ninguém referencia finding por id no código.

O lever que funcionou: **cruzar a data `DD/MM` do incidente com o primeiro nome do colaborador nos
comentários do `src/`** → **50 candidatos**. Dos que investiguei, 2 fecharam com prova completa
(`e4a434b2` folga→DND, `df94ce87` checkin-window) e 2 caíram na execução, virando anotação de raiz
(`aaacef90`, `8dcf1d97`). Precisão em torno de 50% — a mesma dos levers anteriores, mas com
**recall muito maior**, porque o repositório documenta caso por nome+data com muito mais frequência
do que por id.

Correção do que escrevi em 19/08: a varredura **pode** drenar; o que não drena é varrer sem um
gerador de candidatos que case com o modo como o código registra os casos.

Proposta de virar código: o `gov-runner` roda esse cruzamento (data+nome → linhas do `src/`) e
entrega a lista pronta no início da rodada, em vez de cada rodada redescobrir o lever.

### ETAPA 3 — o gate desligado é o achado: `skill_active` some no turno de INSISTÊNCIA

**Ocorrências:** 2 (18/08, 20/08). A regra do gate pagou de novo, e revelou um padrão.

Em 18/08 aprendi que rodar um fix *gated* com o gate ligado prova só que o fix existe. Em 20/08
apliquei em `8dcf1d97` (Matheus 24/06): o TOM respondeu "não tenho como editar transações
financeiras pelo chat. Não existe o comando pra isso aqui" — recusa falsa, `edit_transaction` está
em `FINANCE_CAN`. O `detectDefeatism` devolve `phrase:"não tenho como"` no literal (e `null` no
controle de limitação honesta, então a chamada está boa). Mas a interceptação em `engine.js:12979`
exige `_metrics.skill_active === 'financeiro-pessoal'`.

Li o gate do turno real: o inbound que gerou a recusa (`08:34:27`, _"Então, eu pedi pra você jogar
lá.. bora, você consegue! Não é a sua primeira vez nao.."_) roteia para **`null`**. O turno anterior
(`08:32:19`, com a imagem da planilha) roteava `financeiro-pessoal`.

O padrão, que vale além deste achado: **o turno de insistência não carrega vocabulário de domínio** —
o usuário já disse "lançamento", "cartão", "transação" no turno anterior e agora só diz "bora, você
consegue". O roteador perde a skill exatamente no turno em que a pessoa está reclamando, e com ela
caem todas as redes gated por `skill_active`. É a mesma classe do quote-contamination (Quintela
12/08). Vale medir quantas das redes determinísticas estão gated em `skill_active` — se forem
muitas, o gate é uma raiz, não um detalhe de cada uma.

### ETAPA 3/4 — `pending_intents` prova bug de BINDING sem reconstruir versão antiga

**Ocorrências:** 1 (21/08), e foi o que sustentou a correção da rodada.

A ETAPA 3 empurra para "rode o literal pela função". Para o achado de hoje (`9263bc28`, alto, Ana
07/07) isso era caro: o caminho é o `applyTaskActions`, que não roda sem banco. A prova veio pronta
do próprio banco.

O bug é de **binding**: o menu de duplicidade exibia o PRIMEIRO conflito do lote e o "1/2/3"
resolvia o ÚLTIMO. `pending_intents` guarda os dois lados do binding — as 3 intents do lote de
07:04:49 abrem **no mesmo instante ao segundo**, e a `resolution=confirmed` caiu na de
_"Avisar William sobre treinamentos"_ enquanto o `conversation_history` mostra o menu citando
_"Liberar a folha para conferência da Direção"_. Duas tabelas, um turno, sintoma provado — sem
`git rev-list --before`, sem stub, sem reconstruir módulo.

Regra que isto acrescenta: **quando o achado é "o TOM resolveu outra coisa do que perguntou",
comece por `pending_intents` cruzado com `conversation_history`.** O que o usuário viu está numa
tabela e o que o sistema resolveu está na outra; a divergência entre as duas É o sintoma, e é
inspecionável sem executar nada. Rodar a função vira confirmação da raiz, não a prova do sintoma.

Proposta de virar código: o `literalDoAchado(finding)` proposto em 18/08 e 19/08 deveria devolver
também as `pending_intents` abertas na janela do turno — hoje toda rodada refaz essa query à mão, e
ela é o que desempata a classe inteira de achados de binding.

### ETAPA 2 (varredura) — "mesma família" reincidiu pela 4ª vez, agora com o fix da PRÓPRIA rodada

**Ocorrências:** 4 (13/08, 14/08, 17/08, 21/08). A regra não está sendo aprendida — está sendo
redescoberta.

Corrigi hoje o `DUP-BATCH-MENU-MISBIND` (menu de dup mostra a 1ª tarefa, "1/2/3" resolve a última).
Na varredura apareceu `e9039c5e` (Jéssica 25/07 14:42→14:45 BRT): menu de dup de _"Festa da Mari"_,
ela responde **por reply-quote** ao próprio menu, e recebe _"Já está na agenda como **Viagem**"_.
Sintoma idêntico ao que eu tinha acabado de consertar, na mesma semana de acervo.

**Não é o mesmo bug, e o meu fix não encosta nele.** Três diferenças, todas fatais para o
fechamento: (1) é o caminho de EVENTO (`pendingDupEvents`, `engine.js:193`), não de task;
(2) os dois menus são de TURNOS diferentes, então o gate `if (!integrityPayload)` do meu fix — que
é por chamada de `applyTaskActions` — não os veria; (3) a raiz aqui é outra: o `tryDupBypass` lê o
Map primeiro e só consulta o `pickDupBypassIntentForReply` (que sabe casar por quote) quando
`!hasEv && !hasTk` (`engine.js:7586`) — **com o Map quente, o quote inequívoco nunca é lido.**

O que isto acrescenta ao registro de 17/08 ("vale principalmente contra o fix que você mesmo acabou
de escrever"): a tentação é maior ainda quando o fix é da MESMA rodada, porque o sintoma está fresco
na cabeça e a família parece obviamente coberta. Quatro ocorrências em nove dias é sinal de que isto
não deve seguir dependendo de disciplina do LLM.

Proposta de virar código, reforçando a de 13/08: o fechamento de achado deveria exigir o campo
`prova` preenchido com `{funcao, entrada, antes, depois}` **executado**, e o `gov-runner` recusar
qualquer `status=corrigido` cujo `verified_note` cite um KI sem esse campo. Hoje nada impede o
fechamento por prosa convincente — só a minha própria checagem, que já falhou quatro vezes.

### ETAPA 3 — o gate `skill_active` reincidiu: o guard existe HÁ MESES e mesmo assim está apagado

**Ocorrências:** 2 (20/08, 22/08). Nas duas o achado é recusa falsa em finança, nas duas o
interceptor existia e não disparou — **pela mesma razão**.

Em 20/08 medi que o turno de INSISTÊNCIA não carrega vocabulário de domínio ("bora, você
consegue!"), o `pickSkill` devolve `null` e toda rede *gated* em `skill_active` cai junto
(caso Matheus 24/06, `8dcf1d97`).

Em 22/08 o mesmo padrão, agora no turno de AÇÃO. `9a0a173a` (Rose, 16/07 01:50:57 BRT — turno
localizado pela agulha, não pelo `occurred_at`): TOM responde _"não consigo executar o lançamento
por aqui diretamente — o módulo de cartões funciona pelo app"_ depois de ter passado 12 minutos
cruzando 4 fotos da fatura. O interceptor de derrotismo (`engine.js:13024-13031`) é de `88c055aa`,
**26/06 — três semanas ANTES do incidente**. O filtro clássico "o fix nasceu depois" diria que aqui
não havia fix; havia, e ele estava apagado.

Medido: `detectDefeatism(literal,{})` → `{phrase:"não consigo"}` (dispara; controles bons — a
exclusão de mídia devolve `null` em _"não consigo encaminhar a imagem em si"_, e uma fala sem
derrotismo devolve `null`). Mas `engine.js:13031` exige
`_metrics.skill_active === 'financeiro-pessoal'`, e o inbound real daquele turno era
**"lança pra mim o que falta pfvr, tom"**: `FINANCE_RE=false`, `financeProposalOpen=false`,
`listingOpen=false` → skill não ativa → interceptor dark. Controles do gate:
`"gastei 100 no mercado no débito"`=true, `"lança 75,99 no cartão Latam PASS"`=true.

Subproduto medido no mesmo lugar, e é um buraco separado: no `FINANCE_RE` as alternativas
`fatura` e `cart[ãa]o` são seguidas de `\b`, então **plural escapa** —
`"Como estão as faturas dos meus cartões em julho?"` dá **false**. O cabeçalho do
`finance-gate.js` promete "contas fixas (singular E PLURAL)", mas o plural só foi tratado em
`contas`. O próprio arquivo diz que esse regex já causou 2 incidentes de
"skill: none → TOM nega capacidade / manda usar o app". Deixado aberto (teto de 1 correção).

Regra que isto acrescenta à ETAPA 3: **quando o guard existe e é ANTERIOR ao incidente, não
conclua "não havia fix" — leia o GATE do turno real.** É a mesma disciplina de 18/08 (fix gated
com `allowDone`), agora do lado inverso: lá o risco era ligar o gate na mão e fechar por parecer;
aqui é ver o guard velho e concluir que ele não existia.

Proposta de virar código: **medir quantas redes determinísticas estão gated em `skill_active`.**
Se forem muitas, `skill_active` é uma raiz — e o conserto certo não é abrir o `FINANCE_RE` mais
uma vez (3º incidente do mesmo regex), é a skill do turno anterior sobreviver ao turno de
ação/insistência.

### ETAPA 5 — o gate `includeWeak` está desligado em 11 de 11 ramos de falha do `engine.js`

**Ocorrências:** 1 (22/08), mas é medição de população, não caso isolado.

A correção da rodada (`CONFAB-T2H-WEAK-CONFIRM`, Dudu 21/08) foi ligar `includeWeak` no ramo de
falha do `<<TASK_TO_HABIT>>`: _"Fechou, Dudu! Viro em lembrete diário"_ é 3ª pessoa, mora só no
`WEAK_COMPLETION_RE`, que é **opt-in**. Com o gate desligado o sanitizador devolve a mentira
**intacta** — medido: `sanitizeOptimisticConfirm(fala,'failed')` → a fala inteira;
com `{includeWeak:true}` → `""`.

Contado depois: `sanitizeOptimisticConfirm` tem **12 chamadas no `engine.js`**, 11 delas em ramo
`'failed'`/`'partial'` (11193, 11343, 11361, 11703, 11767, 11772, 11790, 11810, 11843, 11861,
11916) — e **nenhuma** passa `includeWeak`. No `src/` inteiro só 2 lugares passam:
`habit-sem-edicao.js:41` (Bianca 09/08) e o seam novo de hoje.

O argumento do opt-in é que "Fechou/Beleza/Show" são ubíquos em banter — verdade no caso GERAL.
Mas nesses 11 pontos o engine **já sabe que nada persistiu**; ali confirmação fraca é tão falsa
quanto verbo forte, e o custo do falso-positivo é remover uma interjeição de uma mensagem que já
vai carregar rodapé de erro. Ou seja: o mesmo buraco provavelmente existe nos outros 10 ramos
(evento, note-action, event-update…), com a mesma prova de reversão.

Proposta: virar UMA mudança só — `includeWeak` passa a ser o default quando `outcome==='failed'`,
e o opt-in vira opt-**out** para os poucos ramos que quiserem tolerar banter. É refatoração de
raiz, cabe no que o Alf pediu (não é microajuste), e não cabe no teto de 1/rodada: **é decisão de
desenho, vai ao grupo.**

### ETAPA 2 (varredura) — o lever data+nome drenou de novo (2ª rodada seguida)

**Ocorrências:** 2 (20/08, 22/08). O registro de 20/08 se confirma.

O gerador de candidatos "cruzar a data `DD/MM` do incidente com o primeiro nome do colaborador nos
comentários do `src/`" deu **32 candidatos** sobre 142 abertos não-altos (123 sem `verified_note`),
e dos investigados 2 fecharam com prova completa: `ba6873a7` (Ana Paula 28/06 — clobber de dia
explícito por quote-contamination, corrigido em `3a8331d1`/30/06, `wantsToday:true → false` com o
literal) e `da5f0750` (Daiana 22/06 — falso positivo do auditor: a claim é "repetiu a demanda" e a
janela mostra **zero inbound** depois do turno; o auditor leu 6 itens dentro de UMA mensagem como
repetição).

Continua valendo o que 19/08 mediu: a varredura entrega **diagnóstico**, não vazão. Os casos que
não fecharam saíram com raiz e `arquivo:linha` no `verified_note` — `9a0a173a` é o exemplo do dia,
e agora é corrigível em minutos por quem pegar.

### ETAPA 3 — o auditor FABRICA achado quando o TOM manda sem gravar em `conversation_history`

**Ocorrências:** 2 (09/08 Rose/fatura, 23/08 Alf/convite). **Reincidiu, e é uma classe inteira.**

O auditor lê `conversation_history` e só ela. Toda saída que vai pro usuário por
`whatsapp.sendMessage` sem `logConversation` é **invisível pra ele** — e o buraco não fica em
branco: ele é preenchido pela mensagem ANTERIOR que sobrou no histórico, e o achado nasce
descrevendo um comportamento que nunca existiu.

O caso de hoje (`5e81c4c6`, Alf 17/08). O histórico mostrava só: `08:13:58` briefing terminando
_"quer encaixar alguma pendência hoje?"_ → `08:30:02` **"Sim"** → `08:30:04` _"✅ Presença
confirmada em Reunião MKT - NBG!"_. Lido assim é `dropped_request` óbvio: perguntou uma coisa,
respondeu outra. **O convite existia e tinha 6 minutos.** Prova em duas tabelas que o auditor não
lê: `event_participants.notified_at = 17/08 08:23:54 BRT` e `marker_logs EVENT_INVITES
result=executed reason="2 invites sent"` no mesmo segundo. O RSVP-bare estava CERTO.

A raiz é de paridade: os **dois** caminhos de convite do `engine.js` (2678 e 9467) gravam
`[convite de ${senderName}: ${título}]`; o caminho do PWA
(`internal-api.js /internal/event-invites`) mandava e não gravava. Corrigido hoje (`42b5aa11`),
com teste de contrato no fonte (`src/convite-app-historico.test.js`), no mesmo molde do
`fatura-ack-historico.test.js` que nasceu do incidente irmão de 09/08.

**Medido e NÃO corrigido (fora do teto de 1/rodada):** o `internal-api.js` tem ~15 pontos de
`whatsapp.sendMessage` e só 4 referências a `conversation_history`. Os outros ~11 são a mesma
armadilha esperando virar achado fantasma.

Regra que isto acrescenta à ETAPA 3: **quando o achado é `dropped_request` e o histórico mostra
"pergunta A → resposta que serve pra B", não conclua nada antes de procurar B nas tabelas de
efeito colateral** (`event_participants.notified_at`, `marker_logs`, `tasks.completed_at`,
`pending_intents`). Histórico incompleto não parece incompleto — parece incoerência do TOM.

Proposta de virar código: um teste de contrato único que varre `internal-api.js` e falha em
qualquer `whatsapp.sendMessage` cujo bloco não escreva em `conversation_history`. Hoje a paridade
depende de alguém lembrar, e já falhou duas vezes.

### ETAPA 2 (varredura) — "achado alega repetição × contagem de inbound na janela" dá ZERO

**Ocorrências:** 1 (23/08), medida sobre 38 achados. **Resultado negativo, registrado pra não
ser refeito.**

Lever testado: dos abertos não-altos sem `verified_note`, filtrar os 38 cujo `summary` alega
repetição do usuário ("repetiu", "voltou a", "de novo", "insistiu") e contar os inbound na janela.
Onze deram **1 inbound só** — mecanicamente impossível repetir. Parecia refutação barata em lote.

**Nenhum era falso positivo.** A repetição existe, mas fora da janela: no `58a74708` (Jereh) o
usuário disse **"JA FOI FEITO"** em **08/08 14:08:28 BRT** e a tarefa só fechou em **17/08
19:09:28** — **9 dias e 3 inbound de distância**. A janela de ±2h/±8h não alcança isso. No
`79917a36` (Alf 01/07) foi o inverso: a rajada é real e verificada — o MESMO texto reenviado 5×
(17:37, 18:15, 18:41, 19:10, 21:08 BRT) — mas o `occurred_at` aponta pro turno da IMAGEM às
23:14, onde não há repetição nenhuma. Conferir por ali fecharia um achado verdadeiro.

Ou seja: `inbound_na_janela === 1` **não** refuta "o usuário repetiu". Refuta só "o usuário
repetiu NESTA JANELA", que não é o que o achado afirma. É a mesma classe do neutro de 15/08 — a
medição responde uma pergunta parecida com a que eu queria fazer, e a diferença inverte o veredito.

**Resultado da varredura de hoje:** 53 candidatos pelo lever data+nome, 6 investigados a fundo,
**zero fechados** — 5 confirmados bugs vivos com raiz escrita no `verified_note`, 1 inconclusivo
(literal ausente). Terceira rodada (16/08, 19/08, 23/08) em que nada cai como "já corrigido";
20/08 e 22/08 seguem sendo as exceções, e as duas vieram do lever data+nome.

### ETAPA 2 — o achado "de maior severidade" pode estar TODO refutado, e a rodada quase ficou sem correção

**Ocorrências:** 1 (24/08). É a primeira vez que os 3 altos abertos caem juntos.

O protocolo manda pegar o de maior severidade quando não há sinal fresco. Em 24/08 os 3 altos
abertos foram investigados até a prova, e **nenhum virou correção**:

- `771b5bc1` (Rose 11/08, "apaga a fatura Itaú de R$950,21" → apagou Canva de R$34,90) — **já
  corrigido** por `b29a7266` (16/08). `ANTES: one:Google Canva AI PhotoSA 34.90` → `HOJE: none`.
  Fechado.
- `5eb6bb00` (Matheus 14/07) e `29b8751b` (Leo 18/06) — **metade corrigida**: em ambos o guard que
  nasceu depois do incidente conserta o SINTOMA VISÍVEL (a mentira, o jargão cru) e não conserta o
  `dropped_request` que causou o dano. Ficaram abertos, anotados.

O padrão vale além destes três: **um guard de honestidade fecha a boca do TOM, não a lacuna do
executor.** Quem varrer procurando "o guard existe e nasceu depois" vai fechar essa classe inteira
errado — é a regra de 14/08 (`545b8fe0`), agora medida em severidade alta.

O que salvou a rodada foi mudar de alvo: a correção saiu de um `medio` da varredura (`0509fddb`),
não dos altos. Consequência prática pro protocolo: **"maior severidade" é ordem de investigação,
não garantia de que ali existe correção viável.** Quando os altos se refutam, a varredura vira a
fonte da correção do dia — e isso não fura o teto, porque continua sendo UMA.

### ETAPA 2/3 — o lever que pagou hoje: helper determinístico com UM só call site

**Ocorrências:** 2 (23/08, 24/08). Duas rodadas seguidas, a mesma forma de bug.

Em 23/08 a correção foi o convite do PWA que não gravava em `conversation_history` — os DOIS
caminhos do engine gravavam, o terceiro não. Em 24/08 foi `buildReminderNotice`: o helper existe,
é puro, tem teste próprio citando o caso pelo nome e pela hora, e tinha **um único call site**
(`engine.js` ~11433, ramo de marker `<<TASK>>`). O ramo de **dup-bypass** (~7720) monta a
confirmação à mão e retorna direto — então todo pedido com hora que caísse no menu de duplicidade
perdia a hora na confirmação (caso Rafinha 10/08: `remind_at` correto no banco, fala muda).

O lever, e é barato: **`grep` o nome de um helper determinístico e contar os call sites.** Um
helper de honestidade/voz com 1 call site e 2+ caminhos de saída para o mesmo tipo de evento é
bug esperando data. Não exige literal, não exige `git rev-list`, não exige reconstruir versão.

Proposta de virar código: um teste de contrato que, para cada helper de `src/utils` e `src/lib`
declarado como "surface determinístico" (é o vocabulário do cabeçalho desses módulos), falhe
quando existir um `return { reply: ... }` no `engine.js` no mesmo domínio que não passe por ele.
Versão barata e imediata: o `gov-runner` lista os helpers com exatamente 1 call site e entrega no
início da rodada — foi exatamente essa lista que produziu a correção de hoje.

### ETAPA 2 (varredura) — 4ª rodada seguida sem NENHUM fechamento por "já corrigido"

**Ocorrências:** 4 (16/08, 19/08, 23/08, 24/08). A expectativa do protocolo segue desmentida.

Varredura de 24/08: 31 candidatos pelo lever data+nome sobre 112 abertos não-altos sem
`verified_note`; 8 investigados até a prova; **zero** fecharam como "já corrigido" e **zero** como
falso positivo do auditor. Todos os 8 se confirmaram bugs vivos, com raiz e `arquivo:linha` no
`verified_note`.

Duas medições novas que a varredura de hoje produziu, e que valem mais que a vazão:

1. **Categoria errada é comum, e empurra o conserto pro lugar errado.** `7f7a98bf` está como
   `media_fail` e o áudio chegou transcrito por inteiro (é chokepoint sem ação → `dropped_request`).
   `964232a9` está como `confabulation` "contradisse a data da MESMA tarefa" — são **quatro linhas
   homônimas** em `tasks`, e as duas falas do TOM são verdadeiras sobre tarefas diferentes; o bug é
   desambiguação, e fechar por confabulação enterraria isso. `e74b37dd` está como `frustration`
   ("repetiu a demanda") e a raiz é `excluir` executado como `concluir`, seguido de um lookup de
   cancelamento que não acha a tarefa que o próprio turno acabou de fechar.
2. **O chokepoint também dispara FALSO POSITIVO, e o dano é simétrico.** Em `2724e538` (Ana 26/06)
   a tarefa tinha sido persistida no turno anterior — o lembrete chegou a disparar às 09:00 — e
   mesmo assim o "Pode ser" por quote levou a nota "não consegui registrar", que o próprio TOM
   desmentiu um turno depois ("foi engano meu, tá registrada sim"). O guard existe para evitar a
   impressão falsa de sucesso; aqui ele fabricou a impressão falsa de falha.

O produto da varredura continua sendo diagnóstico, não baixa — e a métrica útil segue sendo
quantos achados anotados viram correção depois. `0509fddb`, corrigido hoje, veio de um candidato
gerado pelo mesmo lever.

### ETAPA 3 — o CONTROLE tem que ser válido nas DUAS versões, não só na de hoje

**Ocorrências:** 2 (17/08, 25/08). Reincidiu, e desta vez o neutro apareceu só do lado ANTIGO.

Em 17/08 ficou medido que o controle precisa ser escolhido contra a COMPARAÇÃO que a função faz.
Em 25/08 o mesmo erro voltou numa comparação de duas versões, e o detalhe é novo: **o controle era
válido para o código de HOJE e inválido para a versão antiga.**

Investigando `49a1340b` (Dai 24/06), comparei a versão de 22/06 do `optimistic-confirm.js` contra a
de hoje. Controle: `'✅ Concluí a tarefa de materiais de canto!'` — claim forte, óbvia. Resultado:
**HOJE `true`, ANTES `false`.** Lido no automático, isso diz "o guard não pegava esse caso em junho",
que é precisamente a conclusão que 22/08 ensina a não tirar.

A causa é ortográfica. O `COMPLETION_CORE` da versão antiga termina em `\b`, e em JS sem a flag `u`
o `\b` é ASCII: depois de **"Concluí"** — `í` não é word-char — seguido de espaço não existe
boundary, e o regex falha. Trocado por `'Registrado! A tarefa de materiais tá no sistema.'` (verbo
ancorado, sem vogal acentuada no fim), o controle passou a disparar nas duas versões; o negativo
("Bom dia, tudo certo por aí?") ficou `false` nas duas; e a variante que o fix de 22/06 cobria
("Te cobro conforme os dias.") deu `true` nas duas. **Só então a comparação teve valor.**

Medido depois, para não deixar suspeita no ar: hoje `hasCompletionClaim` devolve `true` em
"Concluí", "Conclui", "Concluído", "Registrei" e na forma com emoji — o buraco do `\b` ASCII é da
versão de junho e **já está corrigido**. Não há bug vivo aqui; havia bug no meu controle.

Regra: **num diff de duas versões, valide o controle nas duas antes de ler qualquer coisa do caso
real.** Controle que só dispara de um lado transforma diferença de INSTRUMENTO em diferença de
COMPORTAMENTO — e o erro aponta para "isso nasceu depois", o lado que fecha achado vivo.

### ETAPA 2 (varredura) — a família "não consegui registrar" É parcialmente provável

**Ocorrências:** 1 (25/08). **Corrige o veredito de 19/08 sobre o maior cluster do acervo.**

Em 19/08 registrei que a família "não consegui registrar" (23 achados, o maior cluster) era
improvável por construção: o chokepoint apaga a entrada que o teste precisaria, e o `raw_excerpt`
guarda a nota já rebaixada. Isso continua verdade **para provar o que o LLM disse** — e é falso
para uma parte relevante dos achados.

O que a mensagem entregue contém é `sanitizeOptimisticConfirm(original,'failed') + NOTE`. A primeira
parcela está **inteira** no `conversation_history`. Quando o achado alega *contradição intra-mensagem*
— prosa afirmando persistência ao lado da nota de falha — o que ele afirma é exatamente sobre o
RESÍDUO, não sobre o original. E o resíduo é testável.

No `49a1340b` a linha residual é _"Tarefa fica aberta até sábado pra você fechar o registro completo.
Te cobro depois do Recreio!"_. Medido: `hasCompletionClaim(linha)` = **false nas duas versões**, e a
linha **sobrevive** ao `sanitize(prosa,'failed')` nas duas. Ou seja o sintoma do achado se reproduz
hoje, sem precisar do original — bug vivo, deixado aberto com raiz.

A raiz é a mesma de 13/08 e vale para o cluster: o `PLANNING_CLAIM_RE` cobre
"te cobro/lembro/aviso + conforme|quando|à medida|nos dias|cada" (criado em 22/06 justamente por um
caso Dai de 21/06) e **não cobre "te cobro DEPOIS" nem afirmação de ESTADO** ("tarefa fica aberta
até X"). Dois dias depois do fix, a mesma pessoa bateu no mesmo guard com fraseado adjacente.

Regra: **antes de declarar um achado do cluster improvável, olhe o que ele AFIRMA.** Se afirma
contradição, o resíduo basta e a prova é possível; se afirma que o TOM mentiu sobre ter gravado, aí
sim o original é necessário e o achado é improvável. Eram duas classes contadas como uma.

### ETAPA 2 (varredura) — o lever mais forte medido até hoje: `marker_logs` com `schema_invalid`

**Ocorrências:** 1 (27/08), sobre os 96 abertos não-altos sem `verified_note`.

Todos os levers anteriores geram candidato por *proximidade* (regex casa, data bate, o comentário
cita o nome) e depois pagam ~50% de falso na execução. Este gera candidato por **entrada literal
preservada**, e por isso não tem o mesmo teto de precisão.

Como: para cada achado aberto, buscar `marker_logs` na janela de ±20 min com `result='rejected'` e
`reason` casando `schema_invalid|invalid|malformed`. Deu **11 candidatos em 96**. O `raw_excerpt`
dessas linhas guarda **o bloco `<<MARKER>>` inteiro que o LLM emitiu** — ou seja, exatamente o
input que o validador recusou. Não é paráfrase, não é resumo do auditor, não precisa de agulha no
`conversation_history`.

Por que isso importa tanto: a maioria do acervo é `dropped_request`, e `dropped_request` quase
sempre é *marker recusado pelo schema*. Com o bloco na mão, a ETAPA 3 vira uma chamada de função
com o objeto real, e a ETAPA 4 (antes/depois) fica trivial.

Resultado medido em 4 dos 11:

- `0cf399dc` (Jereh 07/07) — **fechado com prova completa.** O excerpt mostrava
  `request_id: "9d08f967"` (short-id de 8 hex). O validador de 07/07 exigia UUID de 36
  (`/^[0-9a-f-]{36}$/`); o de hoje aceita 4-12 hex (`coord-request-id.js`, commit `c73fbccb`,
  **08/07** — um dia depois, e o cabeçalho do módulo cita o caso pelo nome). Rodado nas duas
  versões: literal `false → true`; controle UUID `true` nos dois; controles `"zzz"` e vazio
  `false` nos dois. Dano confirmado à parte: `coordination_requests` segue `sent`/`responded_at
  null` — a Gabi nunca foi avisada.
- `caf078f2` (Peterson 22/07) — `<<EVENT_UPDATE>> [{"action":"complete","title":"…"}]`.
  `validateEventUpdateAction` (`engine.js:2783`) exige `a.id`; `title` não é alias → `id:invalid`.
  **Vivo.**
- `4507f25e` (19/07) — `{"action":"skip","habit":"Ir para academia",…}`. **Vivo**, e o resultado
  neutro pagou de novo (ver abaixo).
- `a4efeaa4` (John 10/07) — `[{"action":"remove_watchers",…}]`. `watcher` não aparece **nenhuma
  vez** no `engine.js`, e `src/prompts/system.js:75` **ensina** `action=add_watchers`. Prompt
  ensinando ação inexistente — o achado da auditoria de 27/07, medido de novo.

Proposta de virar código: o `gov-runner` entrega, no início da rodada, a lista de achados com
`marker_logs rejected` na janela **e o `raw_excerpt` já anexado**. É o gerador de candidatos com
melhor razão sinal/ruído medido até aqui, e é uma query só. Vale mais que o lever data+nome.

Efeito colateral da medição, e é o achado mais caro do dia: **a generalização de alias ficou só no
`HABIT_ACTION`.** O `habit-field-alias.js` (20/08) gera o produto cartesiano sufixo×prefixo porque
"o defeito não era falta do alias X, era a LISTA". `EVENT_UPDATE` e `TASK_UPDATE` continuam com a
lista fechada e recusam `title`. Três achados abertos hoje são a mesma classe em validadores
diferentes.

### ETAPA 3 — resultado NEUTRO pagou pela 4ª vez, agora num GATE de `action`

**Ocorrências:** 4 (14/08, 15/08, 17/08, 27/08).

Em `4507f25e` a predição escrita era "`normalizeHabitAliases` preenche `habit_name` a partir de
`habit`" — foi exatamente o que aconteceu em `f02e41f1` na mesma rodada. Veio `undefined`. Pela
regra, fui ler a assinatura antes de concluir: o gate em `habit-field-alias.js:60` é
`action === 'log' | 'query_progress' | 'delete'`, e o literal é `action:"skip"`. Controles
confirmaram que a chamada estava boa (`{action:'log',habit_name:'Ler'}` preserva; `{action:'log'}`
devolve `undefined`).

O novo, e vale registrar: **o gate não era um `if` de feature — era o próprio `action`.** Dois
achados da MESMA família (`habit` como alias) na mesma rodada, um fechado como corrigido e o outro
vivo, e a diferença é uma palavra dentro do JSON. Sem o controle, `f02e41f1` teria arrastado
`4507f25e` junto — a 5ª reincidência do "mesma família = conclusão".

### ETAPA 3 — classe nova: "o LLM nunca viu" não é confabulação

**Ocorrências:** 1 (27/08), e é a correção da rodada.

`62d4dc1c` estava catalogado como o TOM negando fato ("pra quinta 27/08 não vejo nada cadastrado"
com 3 tarefas no banco, criadas por ele mesmo 1h17 antes). A leitura natural é confabulação, e o
reflexo é procurar guard de honestidade.

Não era. O bloco de tarefas do system prompt corta em `slice(0,8)` e a ordem vinha do SQL com
`sort_position` (o DnD do PWA) na frente do `due_date`: seis compras de 31/08 com `sort_position`
0..5 ocupavam a janela e as três de quinta caíam nas posições 11/12/13. **O contexto do LLM não
continha as tarefas** — ele respondeu certo sobre o que recebeu.

É a segunda vez pela MESMA raiz: o fix de 30/05 (Juh/Bianca) já tinha tirado `remind_at` da frente
do `due_date` na mesma query. Voltou por outra coluna.

Regra: **antes de tratar negação de fato como confabulação, reconstrua a JANELA de contexto do
turno.** Se o dado não coube, o alvo é o seam de montagem do prompt, não o guard de honestidade —
e nenhum guard de honestidade jamais consertaria isso, porque não há nada de desonesto na resposta.

Medido e **não corrigido** no mesmo lugar (fora do teto): o cabeçalho do bloco renderiza
`Tarefas trabalho hoje (N)` com N = total da janela de 7 dias, enquanto só 8 linhas são
renderizadas e o rótulo diz "hoje". Mesma origem, decisão de desenho.

### ETAPA 3 — classe nova: o bug não está em NENHUM guard, está no ENCADEAMENTO de dois

**Ocorrências:** 1 (29/08), e é a correção da rodada.

`bb26cbe6` (Dudu 27/08 18:51:05 BRT): áudio pedindo pra guardar os cabos XLR do Vandinho, e o que
chegou foram **duas notas de erro empilhadas e nada mais**. A leitura natural é "um dos guards de
honestidade está agressivo demais" — e o reflexo é abrir o regex do guard que disparou.

Nenhum dos dois guards, isolado, produz o dano. `downgradeEmptyPromise` (`engine.js:13714`)
dropava **toda** linha em branco, inclusive o separador entre duas linhas MANTIDAS. O reply segue
daí para `enforceNoMarkerHonesty`/`sanitizeOptimisticConfirm` (`engine.js:13946`), que remove a
claim **junto com o parágrafo dela** — desenho correto isolado. Sem o separador, o bloco de
conteúdo virou parte do parágrafo da claim e foi apagado com ela.

Isolamento medido, e é de UM caractere: o mesmo texto **com** a linha em branco atravessa o
`sanitizeOptimisticConfirm(...,'failed')` com os 2 bullets intactos; **sem** ela devolve `""`.
Prova {antes, depois} do pipeline encadeado: ANTES = só as duas notas (conteúdo 0 chars, idêntico
byte a byte ao outbound entregue); DEPOIS = os 2 bullets dos cabos + as notas. Fix em
`promise-honesty.js`: parar de filtrar linha em branco e colapsar só as sequências (`\n{3,}` →
`\n\n`), preservando o comportamento antigo para a linha em branco órfã (controle segue verde).

Regra: **quando o sintoma é "sumiu conteúdo que não era mentira", não procure o guard culpado —
monte o pipeline inteiro na ordem do `engine.js` e rode.** Guard testado isolado passa; o dano
mora na composição, e nenhum teste unitário de guard jamais o veria.

Proposta de virar código: um teste de contrato que rode a CADEIA real (`downgradeEmptyPromise` →
`enforceNoMarkerHonesty` → `sanitizeOptimisticConfirm`) e falhe quando a saída final perder um
bloco que a saída intermediária tinha preservado. Hoje cada guard tem suíte própria e ninguém
testa a costura.

### ETAPA 2 (varredura) — "mesma família" reincidiu pela 5ª vez, agora contra um achado JÁ FECHADO

**Ocorrências:** 5 (13/08, 14/08, 17/08, 21/08, 29/08). Quinta vez em 16 dias.

Novidade desta: o irmão não era "um achado parecido", era **um achado que uma rodada minha já
tinha fechado com prova completa**. `771b5bc1` (Rose 11/08) foi encerrado em 24/08 medindo que
`b29a7266` corrigiu — literal `"apaga a fatura Itaú de R$ 950,21"` → `{kind:'none'}`. Hoje
apareceu `4bf44931`: **mesma pessoa, mesmo dia, mesma minuto-a-minuto, mesmo sintoma visível**
(pediu pra desfazer, apagou o Canva de R$ 34,90). A tentação de fechar apontando pro fechamento
anterior é máxima.

Rodado: `"tom, desfaz esses lançamentos q vc fez agr pf"` → **`{kind:'one', Google Canva AI
PhotoSA 34.90}`** contra o código de hoje. Sintoma VIVO. Controles válidos (`"apaga o PONTO
CERTO"` → one:PONTO CERTO; `"apaga a de 500"` → one:MP *LUCASDONAS; `"apaga isso"` → fallback
legítimo). Raiz separada: `resolveTxnTarget` (`src/finance/txn-target.js:37`) não tem noção de
LOTE — pedido no PLURAL referindo o pacote recém-criado cai no fallback de item único mais
recente. `b29a7266` fechou a porta do valor-total explícito e deixou a do plural aberta.

O que isto acrescenta às quatro ocorrências anteriores: **um fechamento anterior meu, com prova,
não cobre o irmão — a prova valia para AQUELE literal.** Fechar por herança de prova é a mesma
falha de fechar por parecer, com um verniz de rigor. A proposta de 21/08 (exigir `prova`
`{funcao, entrada, antes, depois}` executado, e o `gov-runner` recusar `status=corrigido` sem
ela) segue sendo a única saída mecânica — cinco ocorrências dizem que isto não vai ser resolvido
por disciplina.

### ETAPA 2 (varredura) — 6ª rodada seguida sem NENHUM fechamento por "já corrigido"

**Ocorrências:** 6 (16/08, 19/08, 23/08, 24/08, 27/08, 29/08). Contra 2 exceções (20/08, 22/08).

Varredura de 29/08: 7 achados investigados até a prova. **Zero** fecharam como "já corrigido",
**zero** como falso positivo do auditor. Os 7 se confirmaram bugs vivos, com raiz e `arquivo:linha`
gravados no `verified_note`; 1 deles virou a correção da rodada. O lever de `marker_logs
schema_invalid` (o melhor medido, 27/08) deu 5 candidatos e 0 fechamentos.

A esta altura o padrão não é ruído: **a premissa do protocolo — "quase todos são anteriores a
dezenas de correções e devem cair como 'já corrigido'" — está medida como falsa em 6 de 8
rodadas.** O acervo antigo é fila de bug real, não estoque de coisa resolvida. Vale reescrever a
expectativa na ETAPA 2, porque hoje ela empurra o agente a procurar fechamento onde não há, e
fechamento procurado é fechamento por parecer.

O produto da varredura segue sendo diagnóstico: `4bf44931`, `ab345c8f` e `4b815042` saem daqui
corrigíveis em minutos por quem pegar. A métrica útil continua sendo quantos achados anotados
viram correção depois — a correção de 29/08 nasceu de um candidato anotado na mesma rodada.

### ETAPA 3 — o guard pode piorar a resposta: rebaixar admissão HONESTA por casar o verbo

**Ocorrências:** 1 (29/08), medido no mesmo módulo da correção do dia.

`ab345c8f` (Rafinha 27/08 11:09 BRT). A resposta ORIGINAL, preservada no `raw_excerpt` de
`marker_logs ACTIONABLE_NO_MARKER`, já era honesta e útil: _"Vacilei aqui — não consegui registrar
essa mudança de horário do Dudu agora. Me repete: hoje fechamento às 18h30, e toda terça e quinta
também às 18h30 — é isso? Me confirma de novo que eu ajusto já."_

`REPLY_PROMISE_RE` (`src/lib/promise-honesty.js:16`) casa o verbo **ignorando a negação**. Medido:
`REPLY_PROMISE_RE.test("não consegui registrar")` = **true**. Como a resposta era uma linha só, a
linha inteira foi classificada como promessa vazia e removida — sobrou apenas o disclaimer
genérico. Os 18h30, a terça/quinta e a re-pergunta somem. Prova {antes, depois} com o literal:
`fired:true`, reply final = só o `_⚠️ Na real…_`. Controles bons (promessa real dispara; saudação
não).

O ponto que isto abre, e vale além deste caso: **o guard de honestidade tem um lado ruim
raramente medido — trocar uma admissão específica por uma genérica é ESTRITAMENTE PIOR para o
usuário**, e passa despercebido porque a saída continua "honesta". Guard que só é avaliado por
"impediu mentira?" nunca reprova aqui.

Não corrigido (teto de 1/rodada, e é módulo diferente do fix de hoje — conferido rodando, o fix
de 29/08 não alcança linha única). Proposta: negative-lookbehind de negação
("não consegui/não deu/não rolou") antes do verbo, ou não rebaixar linha que já contenha admissão
de falha.

### ETAPA 3 — o resíduo entregue PROVA o guard, mesmo sem o original: controle byte-a-byte

**Ocorrências:** 1 (30/08). **Reabre parte do cluster que 19/08 declarou improvável.**

Em 19/08 medi que o cluster "não consegui registrar" é improvável por construção: o `raw_excerpt`
do `CHOKEPOINT` até 19/08 guarda a nota JÁ rebaixada, ou seja o guard apagou a entrada que o teste
precisaria. Em 25/08 refinei: quando o achado alega contradição INTRA-mensagem, o resíduo basta.
Hoje apareceu um terceiro caminho, mais forte, e ele vale para achados que alegam o CONTRÁRIO
(que o TOM deixou de responder).

Caso: `cfdf9bdb`/`ded67aeb` (Rose 04/07 02:47 e 02:52 BRT). Ela pediu LEITURA/CÁLCULO — "qual o
total de contas ai?" — e recebeu uma frase que começa em **"Mas ainda faltam 4 valores…"**. Frase
começando em "Mas" é fragmento: algo foi removido antes dela. O original não existe em lugar nenhum.

O que funcionou: em vez de tentar recuperar o original, **construir um controle que DEVE disparar e
comparar a SAÍDA dele com o outbound entregue**. `enforceNoMarkerHonesty("Adicionei o total na
lista: R$ 9.914,32.\n\nMas ainda faltam 4 valores (…)", {nothingPersisted:true})` devolve
`fired:true` e uma saída **idêntica byte a byte** ao que o WhatsApp recebeu às 02:47 (resíduo +
`_⚠️ Na real não consegui registrar isso agora…_`). Se a saída de um controle reproduz o entregue
caractere por caractere, o caminho está provado — o original vira redundante.

O que salvou a medição foi a disciplina do neutro (15/08 e 17/08). Minha PRIMEIRA reconstrução
("Somei aqui: o total confirmado é R$ 9.914,32.") deu `fired:false` — e o controle negativo
`{nothingPersisted:false}` deu `fired:false` também. **Dois neutros ⇒ controle malformado, não
veredito.** `hasCompletionClaim` não casa "Somei aqui"/"o total confirmado é"; casa
"Adicionei…"/"✅ Total adicionado…". Trocado o controle, a comparação passou a valer.

Regra: **quando o original foi destruído pelo guard, o par (resíduo entregue + controle que dispara
e reproduz o resíduo) é prova suficiente.** O que NÃO vale é reconstruir o original "no espírito" e
ler o resultado — aí o neutro é indistinguível de "o guard não pega".

Raiz que isto expôs, e é de população: o chokepoint tem veto para `infoGathering`,
`contentSolicitation`, `userProgressStatus`, `restatesRecentWrite` e `awaitingConfirm`, mas
**nenhum para "o turno pediu leitura/cálculo, nunca houve o que gravar"**. Em pedido de leitura
`nothingPersisted` é trivialmente `true`, e verbo de COMPOSIÇÃO ("adicionei o total na lista" =
escrevi no texto da resposta) é indistinguível de verbo de PERSISTÊNCIA para o `hasCompletionClaim`.
Deixado aberto — teto de 1/rodada.

### ETAPA 3 — o resumo do auditor inverte a DIREÇÃO CAUSAL, e a inversão empurra pra refutação

**Ocorrências:** 2 achados na mesma rodada (30/08). Vale como classe, não como caso.

Os dois achados investigados hoje cujo resumo fala em "TOM afirmou e depois se desmentiu" tinham a
direção trocada:

- `b94f7465` (Matheus 25/08) — resumo: "TOM disse que parte do check-in não entrou, mas em seguida
  admitiu que não houve falha real". Lido assim, é falso-positivo de guard e fecha na hora. **A
  medição diz o oposto:** o aviso de perda parcial estava CERTO (só 1 dos 2 `habit_logs` gravou);
  o que era falso foi o TOM DEPOIS negar a perda. Virou a correção da rodada.
- `bf25d692` (Alf 06/07) — resumo: "TOM afirmou ter reagendado, mas logo depois disse que não
  conseguiu registrar". Também invertido: o reagendamento foi REAL, e o que veio depois foi o
  chokepoint rebaixando uma reafirmação VERDADEIRA (o Alf tinha mandado um reply-quote vazio, só ".").

Nos dois, a leitura do resumo aponta para "o guard é agressivo demais" e a leitura dos dados aponta
para "o guard estava certo / o guard negou uma verdade" — vereditos opostos, com consertos opostos.

Regra: **a direção causal do `summary` é uma AFIRMAÇÃO A VERIFICAR, não a premissa da investigação.**
Quando o resumo disser "afirmou X e depois admitiu não-X", vá ao banco descobrir qual das duas falas
é a verdadeira ANTES de escolher o alvo. Ordenar as duas falas no tempo não basta — a segunda fala
ser uma negação não a torna a correta.

### ETAPA 1/2 — o acervo é contado em ACHADOS e o trabalho é por TURNO: inflação de 1,22x

**Ocorrências:** 1 (30/08), medição de população sobre os 132 abertos.

O auditor emite tipicamente um PAR por incidente — um `frustration` (a fala irritada do usuário) e
um `dropped_request` (a fala do TOM) — com o mesmo `occurred_at` ao microssegundo e evidências
diferentes. Medido: **132 achados abertos = 108 turnos distintos, inflação 1,22x**; 19 grupos
compartilham `occurred_at`+colaborador (um deles com 3 achados).

Correção de rota sobre a proposta de 16/08, que pedia deduplicação por `occurred_at`+colaborador na
abertura: **isso apagaria informação.** Duplicatas byte-a-byte (mesma evidência) são **0** — os
pares não são o mesmo achado contado duas vezes, são dois ângulos do mesmo turno, e às vezes só um
dos dois é procedente (hoje: `806b1537` é bug vivo e `de6a1feb` é consequência dele, não causa).

O que a medição sugere de fato: **não deduplicar, mas AGRUPAR** — o achado deveria carregar um
`turn_id`, e o placar da ETAPA 1 deveria reportar turnos além de achados. Hoje "133 abertos" soa 22%
pior do que o trabalho realmente é, e investigar um dos pares já responde o outro (foi o que
aconteceu com `cfdf9bdb`/`ded67aeb` e com `806b1537`/`de6a1feb`).

### ETAPA 1 — o briefing contou `severidade='alto'` numa coluna que grava `'high'`

**Ocorrências:** 1 (30/08).

O briefing da rodada informava "0 de severidade alta". A tabela tem **1 achado com
`severity='high'`** (`bad1c55e`) — a contagem a montante quase certamente filtrou por `'alto'`
(português), enquanto `tom_audit_findings.severity` grava em **inglês**. Os outros valores no acervo
são `medio`/`baixo`, em português: a coluna é MISTA, e é isso que faz o erro passar despercebido —
um filtro em português devolve a maioria das linhas e some só com as altas.

O custo é direto na ETAPA 2: o protocolo manda pegar o de maior severidade quando não há sinal
fresco, e o agente foi informado de que não havia nenhum. Só apareceu porque a varredura leu a
coluna crua.

Proposta de virar código: normalizar `severity` na escrita (um valor por conceito) ou, mais barato e
imediato, o `gov-runner` contar por `in ('alto','high')` e falhar ruidosamente se encontrar as duas
grafias na mesma tabela.

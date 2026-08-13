# 🏗️ Implantar governança autônoma em qualquer agente

> **O que é:** manual de implantação, genérico. Pega um agente qualquer que já está em produção
> falando com pessoas de verdade e o coloca sob um ciclo que **detecta, refuta, corrige, verifica e
> registra** — sem que o próprio agente seja quem diz que deu certo.
>
> **De onde vem:** dois pilotos reais (um agente de tarefas e um agente financeiro-operacional). Onde
> algo foi **provado em produção**, está marcado ✅. Onde é **desenho ainda não construído**, está
> marcado 🔶. Nada aqui é aspiracional sem etiqueta.
>
> **Como usar:** leia a §1 inteira antes de escrever qualquer linha de código. As sete leis da §1 são
> o que separa este modelo de um "agente que se auto-avalia" — que é exatamente o que **não** funciona.

---

## Índice

1. As sete leis (leia antes de tudo)
2. Levantamento obrigatório — o que medir antes de construir
3. Arquitetura: os cinco componentes
4. Papéis e permissões — ablação, não instrução
5. Banco de dados — esquema genérico
6. Host / VPS — layout, usuários, contenção
7. Documentos — quais existem e para que servem
8. A skill do auditor e o contrato de três pontas
9. A sonda — medir comportamento, não log
10. Entrega e atestação — quem tem o direito de dizer "está no ar"
11. A escada de autonomia (append-only)
12. Critérios de fim — desarme, encerramento, aposentadoria
13. Antipadrões: o que já foi tentado e refutado
14. Roteiro de implantação em fatias
15. Checklist de prontidão

---

## 1. As sete leis

Se você só puder levar sete frases deste documento, leve estas. Cada uma custou um incidente real.

**Lei 1 — Quem executa não atesta.**
O agente que faz o trabalho não pode ser a fonte de "o trabalho foi feito". Não por desonestidade: por
viés estrutural de quem relata o próprio esforço. A atestação vem de **prova externa** obtida por
código (§10).

**Lei 2 — Contenção é ablação, não instrução.**
Um prompt dizendo "você é somente leitura" não contém nada. Retire as ferramentas. Em um piloto real,
o agente "somente leitura" tinha ferramentas de escrita, de execução, de cron e de migração de banco
de **outro projeto** — todas ligadas, todas invisíveis, porque ninguém tinha olhado a lista.

**Lei 3 — Ausência de medição nunca vira conformidade.**
"Não consegui ler a fonte" jamais pode sair como "está tudo certo". Isto exige **duas** travas, porque
o caso pior não avisa que não mediu (§8).

**Lei 4 — O veredito é de código; o LLM só produz texto.**
Aprovar ou reprovar é decisão determinística sobre a saída. Se um LLM decide se outro LLM passou, você
tem dois geradores de prosa e nenhum juiz.

**Lei 5 — Falha de infraestrutura não é falha do agente.**
Timeout, rede caída, dado que mudou no meio da medição: tudo isso mede o **ambiente**. Se entrar no
denominador da nota, você vai punir o agente por queda de internet e perseguir regressão que não
existe.

**Lei 6 — Item que nunca reprova é decoração.**
Toda bateria precisa de um **negativo plantado** que tem obrigação de reprovar. Se ele passar, o
medidor está cego e a rodada inteira vale zero — inclusive os verdes.

**Lei 7 — Documento é hipótese até ser medido.**
Inclusive este. Recomendação escrita há três dias descreve um sistema que já mudou. **Meça antes de
executar em cima de qualquer linha escrita.**

---

## 2. Levantamento obrigatório

Antes de construir, responda estas perguntas **com comando, não de memória**. Cada uma já foi motivo de
retrabalho.

### 2.1 Sobre o agente

| pergunta | como responder |
|---|---|
| Quais ferramentas ele tem, **nominalmente**? | dump da configuração; conte e leia uma a uma |
| Alguma escreve, executa, agenda ou migra? | procure por `write`, `exec`, `cron`, `migration`, `delete` |
| Com que credencial ele fala com o banco? | ela ignora as regras de acesso por linha? |
| Qual modelo, e qual a cadeia de fallback? | fallback muda comportamento sem deploy |
| Onde ficam as sessões/histórico? | é onde a sonda vai ler a resposta |
| O que prova o que a pessoa **recebeu**? | registro de saída, não de intenção |

### 2.2 Sobre o host

| pergunta | por quê |
|---|---|
| Como que usuário o processo roda? | se for privilegiado, ele lê o cofre dos outros agentes |
| Quais capacidades o processo tem? | dono do arquivo não é a única via de leitura |
| Qual o tamanho do diretório de estado? | decide se dá para migrar de usuário ou se contém por capacidade |
| Onde ficam os sockets? | isolar diretórios temporários pode cortar a comunicação |
| Que segredos existem no ambiente, **por nome**? | nunca imprima valores; compare por hash |

### 2.3 Sobre o estado atual da qualidade

Você precisa de uma **linha de base** antes de mudar qualquer coisa, senão toda melhora futura é
opinião. Meça: quantas queixas reais existem hoje, de que tipo, e com que frequência. Guarde isso
datado.

---

## 3. Arquitetura: os cinco componentes

```
                    ┌──────────────────────────────────────────┐
                    │  AGENTE EM PRODUÇÃO (não se toca aqui)   │
                    └───────────────┬──────────────────────────┘
                                    │ fala com pessoas
                                    ▼
   ┌────────────┐   texto    ┌──────────────┐   verificação  ┌─────────────┐
   │ 1 AUDITOR  │ ─────────► │ 2 PERSISTIDOR│ ─────────────► │ 3 ACERVO    │
   │ read-only  │            │  (código)    │   determinís-  │ (banco)     │
   └────────────┘            └──────┬───────┘      tica      └──────┬──────┘
                                    │                                │
                                    ▼                                │
                            ┌──────────────┐                         │
                            │ 4 ENTREGA    │◄────────────────────────┘
                            │ + VIGIA      │
                            └──────────────┘
   ┌────────────┐
   │ 5 SONDA    │ ── conversa com o agente como um usuário faria ──► ACERVO
   └────────────┘
```

**1. Auditor** ✅ — lê o mundo (banco, logs, filas) e escreve **prosa**. Não corrige nada. Não tem como
corrigir nada.

**2. Persistidor** ✅ — **código, não LLM**. Recebe a prosa, fatia em seções nomeadas, aplica as travas,
transforma em registros estruturados. É aqui que mora a defesa contra relatório enviesado.

**3. Acervo** ✅ — banco. Achado com assinatura de deduplicação: repetir incrementa contador em vez de
poluir.

**4. Entrega + vigia** ✅ — publica o resultado para humanos e, **em processo separado e horário
separado**, confere que a publicação aconteceu.

**5. Sonda** ✅ — mede **comportamento**: conversa com o agente pelo canal real e avalia a resposta com
gate determinístico.

**6. Corretor** 🔶 — *não construído em nenhum piloto até agora.* O desenho está na §11, nível N3+. Se
você for construí-lo, leia primeiro a §13.4 (auto-autorização).

---

## 4. Papéis e permissões

### 4.1 A tabela de poderes

Escreva esta tabela para o **seu** agente antes de configurar qualquer coisa:

| papel | lê | escreve | executa | agenda | fala com humanos |
|---|---|---|---|---|---|
| Agente de produção | sim | sim | conforme o produto | conforme o produto | sim |
| **Auditor** | **sim** | **não** | **não** | **não** | **não** (quem fala é a entrega) |
| Sonda | sim | só o próprio acervo | não | sim (a própria rodada) | só alarme |
| Corretor 🔶 | sim | **só na área dele** | sim, restrito | não | não |
| Verificador 🔶 | sim | só o veredito | não | não | não |

### 4.2 Como cortar de verdade

1. **Liste** as ferramentas nominalmente. Não confie em categoria.
2. **Corte** para uma allow-list explícita — nomeie cada uma. Deny-list envelhece mal: ferramenta nova
   entra liberada.
3. **Credencial separada.** Se a credencial do auditor puder escrever, ele pode escrever, e nenhuma
   allow-list resolve. Onde houver segurança por linha, a credencial do auditor **não** pode ser a que
   a ignora.
4. **Teste a ablação.** Peça ao agente algo que ele não deveria conseguir e **guarde a recusa como
   evidência**. Em um piloto, o agente respondia com 68 linhas de um arquivo de segredos; depois do
   corte, respondia `NEGADO`. Sem esse teste, você não sabe qual dos dois você tem.

> ⚠️ **Armadilha das duas portas.** Cortar em um lugar só costuma não cortar. Se há uma lista na
> configuração **e** uma verificação no código, mudar uma delas produz silêncio, não bloqueio. Procure
> a segunda porta sempre.

---

## 5. Banco de dados — esquema genérico

Quatro tabelas. Prefixo `<agente>_gov_`.

```sql
-- 5.1 ACHADOS: o que a auditoria encontrou
create table <agente>_gov_findings (
  id            uuid primary key default gen_random_uuid(),
  categoria     text not null,           -- eixo do problema, não o texto dele
  severidade    text not null,           -- baixo | medio | alto
  resumo        text not null,           -- uma frase; entra em relatório
  evidencia     text,                    -- o cru: query, trecho, contadores
  incident_at   timestamptz not null,    -- quando o FATO ocorreu (≠ quando foi visto)
  assinatura    text not null unique,    -- chave de deduplicação (ver 5.5)
  ocorrencias   integer not null default 1,
  primeira_vez  timestamptz not null default now(),
  ultima_vez    timestamptz not null default now(),
  status        text not null default 'novo',   -- novo|triado|em_correcao|corrigido|refutado
  -- campos do verificador (podem nascer vazios; são o encaixe do nível N3+)
  verificado_em         timestamptz,
  verificado_resultado  text,            -- confirmado | refutado | inconclusivo
  verificado_nota       text
);

-- 5.2 MEDIÇÕES: cada resposta avaliada individualmente
create table <agente>_gov_probes (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null,
  item         text not null,            -- qual comportamento está sendo medido
  redacao      integer not null,         -- 1..k — qual variação da pergunta
  pergunta     text not null,
  resposta     text,
  veredito     text not null,            -- aprovado|reprovado|inconclusivo|infra_*
  motivo       text,
  custo_usd    numeric,
  duracao_s    numeric,
  criado_em    timestamptz not null default now()
);

-- 5.3 RODADAS: uma linha por execução do ciclo
create table <agente>_gov_runs (
  id                uuid primary key default gen_random_uuid(),
  reference_date    date not null,
  tipo              text not null,       -- ver 5.6: NÃO use só (data, tipo) como chave
  status            text not null,       -- ok | abortada | falhou
  detalhe           text,
  custo_usd         numeric,
  modelo_efetivo    text,                -- QUAL modelo respondeu de fato
  enviado_em        timestamptz
);

-- 5.4 PROBLEMAS CONHECIDOS: o que já foi diagnosticado e ainda não morreu
create table <agente>_gov_known_issues (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  titulo       text not null,
  raiz         text,                     -- hipótese até ir ao banco: marque como tal
  status       text not null default 'aberto',
  corrigido_em timestamptz,
  prova        text                      -- como se sabe que morreu
);
```

**5.5 A assinatura é o coração da deduplicação.** Ela deve descrever a **classe** do problema, não a
instância: `modulo:subsistema:sintoma`. Se você incluir data, valor ou nome próprio, cada ocorrência
vira um achado novo e o acervo em uma semana é ruído.

**5.6 Armadilha medida:** se a chave natural for `(reference_date, tipo)`, duas rodadas do mesmo tipo no
mesmo dia **colapsam em uma** — e você perde metade da evidência sem aviso, com o custo somando errado.
Ou inclua um discriminador, ou trate o upsert explicitamente.

**5.7 Escrita por função, não por tabela.** Exponha `<agente>_gov_registrar_finding(...)` e
`<agente>_gov_registrar_run(...)` como funções, e dê ao processo permissão só nelas. Assim o incremento
de `ocorrencias`, a normalização da assinatura e a validação ficam no banco — não em cada chamador.

**5.8 Funções de controle.** Para cada número que o auditor vai afirmar, crie uma função de leitura que
devolve **o mesmo número, calculado direto na fonte**: `<agente>_gov_ctl_<coisa>()`. É com ela que a
camada 2 da trava confere o relatório (§8.3). Sem essas funções, a trava não existe.

**5.9 Permissão de leitura é parte do desenho, não detalhe.** Uma view existir não significa que o
perfil do auditor possa lê-la. Num piloto, `permission denied` chegou ao relatório como *"a fonte não
existe"* e virou um ✅ em cima de 103 pendências reais. **Teste cada fonte com o perfil real do
auditor**, nunca com o perfil de administrador.

**5.10 Prefira criar uma view resumida a liberar a fonte inteira.** Se o auditor só precisa de
contagem, dê contagem. Prompt pode proibir citar dado sensível; **não entregar o dado é mais forte do
que pedir para não usá-lo**.

---

## 6. Host / VPS

### 6.1 Layout de arquivos

```
<raiz-do-agente>/
├── auditoria/
│   ├── rodar.sh              # wrapper: orquestra, mede, atesta, decide
│   ├── prompt.md             # a skill do auditor (§8)
│   ├── persistir.<ext>       # fatiador + travas + gravação (código, não LLM)
│   ├── vigia.sh              # confere que a entrega saiu (processo separado)
│   ├── entregar.<ext>        # publica para humanos
│   ├── verificar-contrato.<ext>
│   └── test_*                # a suíte da própria auditoria
├── sonda/
│   ├── rodada.sh             # wrapper com trava de concorrência e desarme
│   ├── runner.<ext>          # injeta, espera, coleta
│   ├── gate.<ext>            # VEREDITO DETERMINÍSTICO
│   ├── alarme.<ext>          # decide avisar ou calar
│   ├── config.<ext>          # limiares, tetos, k, piso de amostra
│   └── test_*
└── placar/
    └── placar.<ext>          # leitura agregada do acervo
```

**Regra de ouro do layout:** o wrapper (`.sh`) é quem tem autoridade. Ele chama o LLM, mas **decide
sozinho** com base em código. Se o LLM cair, o wrapper ainda produz veredito.

### 6.2 Usuários e contenção

**Cada agente com seu próprio usuário de sistema.** Um agente que roda como usuário privilegiado lê o
cofre de segredos de todos os outros, e nenhuma permissão de arquivo o impede.

Quando migrar o usuário for caro — e às vezes é: um diretório de estado pode ter dezenas de gigabytes,
e trocar o dono derruba o agente por minutos — existe um caminho intermediário **provado**: manter o
identificador e **remover as capacidades**.

```ini
# drop-in do serviço
[Service]
NoNewPrivileges=yes
CapabilityBoundingSet=          # vazio: nenhuma capacidade
AmbientCapabilities=
ProtectSystem=full
ProtectKernelTunables=yes
ProtectKernelModules=yes
RestrictSUIDSGID=yes
LockPersonality=yes
```

Efeito medido: antes, o processo lia o cofre de outro agente (74 linhas); depois, `Permission denied`.
Sem a capacidade de sobrepor permissões, o núcleo do sistema volta a verificar de verdade.

> ⚠️ **Não isole o diretório temporário sem olhar onde vivem os sockets.** Se o canal de comunicação do
> agente é um socket em área temporária, isolar corta a comunicação e o serviço sobe "saudável" e mudo.

> ⚠️ **Como medir contenção corretamente:** não entre no espaço do processo com uma ferramenta que roda
> com as **suas** permissões — o resultado dirá que nada mudou. Reproduza o ambiente do alvo (execute
> com as mesmas capacidades removidas) e tente a operação proibida.

### 6.3 Agendamento

- Auditor: uma vez por dia, **em horário em que o dado esteja estável**.
- Vigia: 30–40 minutos depois do auditor.
- Sonda: em horário de **baixa atividade humana** — se uma pessoa mexer no dado durante a medição, o
  resultado vira `infra_dado_mudou` e a rodada se perde. Isto foi medido, não suposto.

> ⚠️ **Alarme falso destrói sinal.** Nunca faça o vigia perguntar "já rodou?" antes da hora em que o
> trabalho roda. Meça a **última execução em dia civil**, não "hoje até agora".

### 6.4 Segredos

- **Nunca imprima valores.** Liste apenas nomes; compare por hash.
- Ao rotacionar um segredo que aparece em uma URL, **compare o hash dos dois lados** (quem chama e quem
  aceita) — só isso prova que o elo está fechado; responder 200 não prova que o chamador foi atualizado.
- Verifique se o controle de versão ignora arquivos de ambiente. Em um caso real **não havia uma única
  regra** para eles, e uma chave mestra ficou pública por 105 dias.

---

## 7. Documentos

| documento | papel | atualização |
|---|---|---|
| **PAINEL** | fonte de verdade viva, com §0 de retomada | a cada fecho |
| **SPEC** | o desenho aprovado, com o que foi decidido e por quê | quando o desenho muda |
| **PLANO** | fatias executáveis, com critério de pronto por fatia | quando a fatia fecha |
| **PROTOCOLO DE ACHADOS** | como um achado nasce, é refutado, corrigido e morre | raro |
| **ESCADA** | registro append-only de níveis de autonomia (§11) | só cresce |

**O painel é o documento que salva a operação.** Ele precisa de:

- **§0 RETOMADA** — como reconstruir o estado real em 30 segundos, com **os comandos prontos**. Quem
  chega (ou volta depois de perder o contexto) roda os comandos, não confia no texto.
- **Uma seção por fecho**, com o que foi medido, o que foi refutado, e o que ficou aberto.
- **Marcação explícita de estado:** ✅ no ar · 🔶 papel · ⚠️ refutado.

> Um painel que só conta vitórias é inútil. As seções mais valiosas são as que dizem *"eu achava X,
> medi, era Y"* — porque impedem que a próxima pessoa refaça o mesmo caminho.

---

## 8. A skill do auditor e o contrato de três pontas

### 8.1 A skill

O prompt do auditor precisa, no mínimo:

1. **Seções numeradas e nomeadas**, fixas. O fatiador depende dos nomes.
2. **A fonte de cada seção, nomeada explicitamente.** Se você não disser de onde vem o número, o modelo
   escolhe — e escolhe errado. Num caso real, a seção que nomeava a fonte funcionava e a que não
   nomeava reportava "não encontrei".
3. **Regra anti-zero explícita:** não conseguir ler é falha técnica, e **nunca** se reporta como zero.
4. **Proibição de dado sensível no relatório**, com a contrapartida da §5.10 (não entregue o dado).
5. **Formato de saída estável** — é contrato, não estética.

### 8.2 O contrato de três pontas

**prompt ↔ gate ↔ persistidor** têm de concordar sobre o formato.

Se divergirem, o achado **some em silêncio**: o persistidor procura uma seção que o prompt não gera
mais, não encontra, e ninguém percebe — a auditoria fica verde por não ter o que gravar.

Implemente:
- `verificar-contrato` que **falha** se as três pontas divergirem;
- **golden-file por hash** do prompt: alterou, o wrapper avisa;
- e quando você mesmo mudar o prompt de propósito, **atualize o hash no mesmo commit** — senão o alerta
  toca todo dia e todo mundo aprende a ignorá-lo.

### 8.3 As duas camadas da trava anti-vacuidade

**Camada 1 — textual.** Seção que declara cegueira ("não encontrei", "não consegui ler", "sem acesso")
**e** exibe sinal de verde (✅, "nada a fazer", "0 achados") é marcada como não verificada.

**Camada 2 — controle.** O **número afirmado** pela seção é comparado com o número devolvido pela
função de controle (§5.8). Divergência vira severidade alta, com o conflito escrito no resumo.

**A camada 2 é a que importa.** O caso pior não declara nada: simplesmente afirma zero. Sem declaração,
não há rastro textual, e só a comparação com a fonte pega.

Detalhes que custam caro:
- Falha ao consultar a fonte devolve **indefinido**, nunca "conferido".
- Ao extrair o número afirmado, ignore data, dinheiro e percentual — senão você compara o dia do mês
  com uma contagem.
- **Normalização que remove acento pode mudar o tamanho do texto.** Se você achar a posição no texto
  normalizado e cortar no original, o corte sai deslocado — e o erro cresce a cada acento anterior.
- Ao localizar seções pelo nome, exija **posição de cabeçalho**. O nome de uma seção aparece no corpo de
  outra, e o fatiador corta no lugar errado guardando texto alheio sob o rótulo errado.

---

## 9. A sonda — medir comportamento

### 9.1 Princípio

**Não leia log: converse com o agente pelo canal real**, como um usuário faria, e avalie a resposta.
Log prova que o código rodou; só a conversa prova o que a pessoa recebeu.

### 9.2 Anatomia de uma rodada

```
para cada item de comportamento:
    para cada uma das k redações da mesma pergunta:
        mede o estado ANTES  ─┐
        injeta a pergunta     ├─ o controle abraça a janela;
        espera a resposta     │  comparar só um lado dá vermelho por acerto
        mede o estado DEPOIS ─┘
        veredito := gate(resposta, antes, depois)   # DETERMINÍSTICO
```

### 9.3 Configuração mínima

| parâmetro | o que é | armadilha |
|---|---|---|
| `k` | redações por item | k baixo demais fica sob o piso e sai sempre inconclusivo |
| `piso_de_amostra` | mínimo de respostas válidas para haver veredito | sem ele, 1 resposta vira "nota" |
| `limiar` | nota mínima para aprovar | **na unidade em que o veredito é aplicado** — ver §13.7 |
| `teto_invocacoes` | corta rodada em fuga | precisa acompanhar o tamanho real da bateria |
| `teto_custo` | corta gasto | dimensione pelo modelo **mais caro** que pode responder |
| `teto_duracao` | corta travamento | |

### 9.4 Vereditos de infraestrutura

Separe uma família inteira (`infra_*`) para: não chegou, sem resposta, dado mudou, contexto estourou,
falha ao injetar. **Eles não entram no denominador da nota**, não viram achado contra o agente e não
contam como regressão.

> ⚠️ Um erro não tratado no injetor derruba a rodada inteira. Trate **todos** os caminhos de falha e
> mande cada um para um veredito `infra_*` nomeado. E lembre da armadilha das duas portas: não basta
> criar o veredito — ele precisa entrar **também** na lista dos que são ignorados na nota.

### 9.5 O canário

Um item **negativo plantado**, cuja obrigação é reprovar.

- canário reprovou → medidor funcionando, siga
- canário **passou** → o medidor está cego: **descarte a rodada inteira**, inclusive os verdes
- canário inconclusivo → "rodada sem garantia"

### 9.6 Proteções do wrapper

- **trava de concorrência** (uma rodada por vez)
- **arquivo de desarme** — presente, recusa a rodada; **rearmar é ato humano**
- **persistir antes de decidir** — se o alarme falhar, a medição não se perde
- **registrar a hora de cada linha** do log

### 9.7 Higiene de medição

- **Teste manual repetido reusa a mesma sessão** e o agente responde de memória ("já checei isso") —
  vermelho por lembrança, não por regressão. Comece sessão nova a cada medição.
- **Comportamento que nasce em código não é medível por conversa.** Se um atalho responde sem chamar o
  modelo, você precisa capturar a **saída do sistema**, não a fala do modelo.
- **Capture depois da formatação.** Capturar antes mede texto cru, não o que a pessoa veria.

---

## 10. Entrega e atestação

**Quem tem o direito de dizer "está no ar": o código, com prova externa.**

| o que se afirma | o que serve de prova | o que **não** serve |
|---|---|---|
| "reiniciei o serviço" | processo com PID novo e horário de início | "reiniciei" |
| "a rota nova funciona" | a nova responde OK **e a antiga é rejeitada** | só a nova responder |
| "a configuração mudou" | hash dos dois lados batendo | "atualizei o arquivo" |
| "a pessoa recebeu" | registro de **saída** entregue | registro de intenção/envio |
| "o dado foi gravado" | leitura de volta **pelo perfil real** | a função ter retornado |

Regra derivada: **operação assíncrona resolvida não é prova de entrega.** Um verificador de duplicidade
sem prova de entrega vira mordaça: o dublê "entrega", o teste fica verde, e o defeito continua vivo.

E o inverso, igualmente medido: **falhar em silêncio produz confabulação.** Quando o sistema pula uma
ação e não diz por quê, o modelo preenche a lacuna com uma explicação plausível e falsa. Todo caminho
de "não fiz" precisa devolver **o motivo concreto**.

---

## 11. A escada de autonomia (append-only)

O agente não ganha poderes de uma vez. Ele sobe degraus, **cada um com critério de entrada, evidência e
critério de saída**. O registro é **append-only**: nunca se apaga um degrau, nem se reescreve a
justificativa. Rebaixamento também é uma linha nova.

| nível | o que ele pode | critério para entrar | como se prova |
|---|---|---|---|
| **N0 — Observa** | ler e registrar; não fala com ninguém | ablação testada (§4.2) | o teste de recusa está guardado |
| **N1 — Relata** | publica relatório para humanos | 7 dias em N0 sem falso positivo relevante | travas §8.3 ativas e exercitadas |
| **N2 — Propõe** | escreve a correção sugerida, **não aplica** | 30 dias em N1; taxa de achado real acima do combinado | amostra revisada por humano |
| **N3 — Corrige contido** 🔶 | aplica em área isolada, com reversão automática | proposta aceita por humano em N2 repetidamente | reversão exercitada de verdade |
| **N4 — Corrige em produção** 🔶 | aplica no sistema real | N3 estável, verificador independente ativo | atestação por prova externa (§10) |

**Regras da escada:**

1. **Um degrau por vez**, e nunca dois no mesmo dia.
2. **Toda promoção cita evidência**, com data e onde ela está guardada. "Está indo bem" não promove.
3. **Rebaixamento é automático** ao violar o critério de saída — e não precisa de reunião.
4. **O critério pelo qual ele é avaliado fica fora do alcance dele.** Se o agente puder editar a prova,
   ele passa sempre (§13.4).
5. **A escada é por capacidade, não por agente.** Ele pode estar em N4 para uma classe de correção e em
   N1 para outra.

Formato sugerido de cada linha (append-only, texto):

```
2026-08-09 | corrigir-classificacao | N0 -> N1 | evidência: 7 rodadas, 0 falso positivo
           | painel §B1 | aprovado por: <humano>
2026-08-21 | corrigir-classificacao | N1 -> N0 | REBAIXADO: 2 achados refutados em 3 dias
           | evidência: findings a1b2, c3d4
```

---

## 12. Critérios de fim

Todo ciclo precisa saber parar. Sem isto, ele vira ruído permanente.

### 12.1 Fim de um achado

Um achado morre quando: **a raiz foi nomeada**, a correção foi aplicada, **a verificação foi feita na
fonte** (não no teste), e a prova está registrada. Enquanto não houver os quatro, ele fica aberto — e a
raiz é **hipótese até ir ao banco**.

### 12.2 Fim de uma rodada

Encerre com um destes estados, sempre explícito: `ok` · `abortada` (com o motivo do teto) · `falhou`
(com o erro) · `sem garantia` (canário inconclusivo). **Nunca encerre com ausência de mensagem** —
silêncio não distingue "tudo certo" de "não rodou".

### 12.3 Desarme e parada de emergência

- **Arquivo de desarme** que recusa a rodada. Rearmar é ato humano deliberado.
- **Interruptor de autonomia**: uma variável que rebaixa o agente para N0 sem precisar de deploy.
- **Reversão ensaiada**: se você nunca reverteu de verdade, você não tem reversão.

### 12.4 Quando aposentar o ciclo

Aposente quando: o eixo medido ficar 60 dias sem achado real **e** a suíte cobrir o comportamento, ou
quando o subsistema deixar de existir. **Aposentar é remover a medição, não deixá-la verde por
inércia** — medição que ninguém lê é pior que nenhuma, porque parece cobertura.

### 12.5 O que nunca termina

O painel, a escada e o acervo. São memória institucional: sobrevivem a pessoas, chats e reescritas.

---

## 13. Antipadrões

**13.1 Verificação espalhada por caminho de código.** Vira queijo suíço. Use **um ponto de passagem
único na saída**, organizado por **verbo** (o que está sendo afirmado), não por caminho.

**13.2 Verificar por estado do turno.** Foi desenhado e refutado. O eixo certo é o **enunciado** — o que
o agente afirma — e não em que ponto do fluxo ele está.

**13.3 Teste verde como prova de conserto.** Não é. Vá ao banco ou à superfície real.

**13.4 Corretor que aprova o próprio conserto.** O buraco número um. Mantenha um conjunto de casos
**fora do alcance** do corretor e verificado por outra família de código.

**13.5 Contador alto tratado como incidente.** Um contador com 88 ocorrências parecia falha silenciosa;
três quartos eram testes internos e o caso real havia sido tratado. **Olhe por sessão/ocorrência, não o
total.**

**13.6 Teste que crava dado vivo.** Nome próprio e teto numérico de operação apodrecem sozinhos, viram
vermelho crônico, e vermelho crônico ensina todo mundo a ignorar a suíte. Prefira **invariantes**: dois
conjuntos disjuntos, consolidado nunca maior que o bruto, contagem estável sob repetição.

**13.7 Limiar na unidade errada.** Se o veredito é aplicado sobre 5 tentativas, a margem tem de ser
calculada sobre 5 — não sobre as centenas que compuseram a linha de base. A conta errada reprova o
comportamento certo.

**13.8 Comparar pela unidade errada.** Antes de gritar "o mesmo item está em dois estados", confirme
qual é a **unidade** do vínculo. Uma mensagem pode conter várias cobranças, e é normal uma estar
vinculada e a outra não.

**13.9 Deduplicar contra a lista errada.** Em laço de descoberta, deduplique contra **tudo que já foi
visto**, não contra o que foi aprovado — senão o rejeitado reaparece toda rodada e o laço nunca fecha.

**13.10 Capacidade não declarada.** Se o agente executa algo através de infraestrutura fora do conjunto
de ferramentas dele, **declare no prompt** que a capacidade existe, qual é o limite real, e o resultado
da última execução. Sem isso ele nega ter a capacidade — e chega a inventar pedido de funcionalidade
para algo que já roda centenas de vezes.

**13.11 Deixar o modelo narrar estágio de processo.** "Enviando…", "já mandei" — se a infraestrutura
ainda não entregou, isso é confabulação recém-fabricada. Estágio é texto de sistema.

**13.12 Fallback de modelo silencioso.** Troca de modelo muda comportamento sem deploy. Registre o
**modelo efetivo** em cada rodada; ao investigar regressão, comece por ele.

**13.13 Palavra-chave como roteador.** Roteie por **intenção** (o que se quer × sobre o quê), não por
palavra. "Relatório" numa frase sobre contas mandava o pedido para o subsistema de e-mail. A correção
não foi reordenar a cadeia: foi exigir que o atalho e a intenção **concordem**.

---

## 14. Roteiro de implantação em fatias

Cada fatia entrega algo que funciona sozinho e tem critério de pronto verificável.

**Fatia 0 — Contenção e levantamento** *(faça antes de qualquer código)*
Levantamento da §2 · usuário próprio ou capacidades removidas · ablação testada com evidência guardada
· inventário de segredos por nome.
**Pronto quando:** a recusa do agente a uma operação proibida está registrada.

**Fatia 1 — Acervo e placar**
As quatro tabelas · funções de escrita · **funções de controle** (§5.8) · leitura testada com o perfil
real.
**Pronto quando:** um achado escrito à mão entra, deduplica ao repetir, e o placar o exibe.

**Fatia 2 — Auditor**
Skill · fatiador · **duas camadas** de trava · contrato de três pontas · golden-file · entrega · vigia
em processo e horário separados.
**Pronto quando:** um relatório fabricado, afirmando zero sobre uma fonte que tem dados, é **barrado
pela camada 2**.

**Fatia 3 — Sonda**
Injeção pelo canal real · gate determinístico · `k` e piso de amostra · família `infra_*` · canário ·
tetos · trava de concorrência · desarme.
**Pronto quando:** a linha de base está medida com número, e o canário reprova de verdade.

**Fatia 4 — Suíte e fixtures**
Testes da própria governança · casos negativos · fixtures que não dependem de dado vivo.
**Pronto quando:** a suíte está **inteiramente verde** — nenhum vermelho "conhecido".

**Fatia 5 — Escada**
Registro append-only · critérios de entrada e saída por capacidade · interruptor de rebaixamento.
**Pronto quando:** existe uma promoção registrada com evidência **e** um rebaixamento ensaiado.

**Fatia 6 — Corretor** 🔶 *(só depois de todas as anteriores)*
Área isolada · reversão automática · casos de avaliação fora do alcance dele · verificador de outra
família · atestação por prova externa.
**Pronto quando:** um conserto correto é aplicado e verificado **sem que o corretor tenha voz** no
veredito.

---

## 15. Checklist de prontidão

Antes de declarar o ciclo implantado, cada linha precisa de um comando que a comprove:

- [ ] O auditor **não consegue** escrever — e existe a evidência da recusa.
- [ ] A credencial do auditor não ignora as regras de acesso do banco.
- [ ] Toda fonte que ele lê foi testada **com o perfil dele**, não com o de administrador.
- [ ] Um relatório que afirma zero sobre fonte não lida é **barrado**.
- [ ] Um relatório com número divergente da fonte é **barrado**.
- [ ] O contrato de três pontas falha quando eu altero o prompt sem atualizar o resto.
- [ ] O canário reprova; e se ele passar, a rodada é descartada.
- [ ] Falha de rede sai como `infra_*` e **não** entra na nota.
- [ ] Os tetos cortam de verdade, e as medições já feitas **sobrevivem** ao corte.
- [ ] O desarme recusa a rodada, e rearmar exige mão humana.
- [ ] A entrega é atestada por prova externa — reinício, rota e configuração.
- [ ] O vigia roda em processo e horário separados de quem entrega.
- [ ] O painel tem §0 com comandos prontos de retomada.
- [ ] A escada tem uma promoção com evidência e um rebaixamento ensaiado.
- [ ] A suíte está **100% verde** — zero vermelho tolerado.
- [ ] O modelo efetivo é registrado em cada rodada.
- [ ] Nenhum segredo é impresso em nenhum log, alerta ou relatório.

---

> **Última recomendação, e é a mais importante.** Este ciclo não existe para provar que o agente é bom.
> Ele existe para **tornar caro afirmar sem medir** — inclusive para você, que está implantando. Se em
> algum momento o ciclo ficar verde e ninguém souber dizer qual comando prova aquilo, você não tem
> governança: tem decoração.

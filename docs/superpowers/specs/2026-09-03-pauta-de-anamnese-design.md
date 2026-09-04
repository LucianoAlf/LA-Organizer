# Pauta de anamnese — a pendência do LA Report vira trabalho do dia

**Data:** 2026-09-03
**Pedido:** Alf, no grupo Administração Recreio, depois de o Clayton pedir lembrete de contrato
no horário da aula do aluno.

## 1. O problema

Hoje a pendência de anamnese só existe quando alguém pergunta. O TOM responde "225 sem anamnese
no Recreio", o número assusta, e nada acontece — porque 225 não é trabalho, é estatística.

O trabalho de verdade tem hora e lugar: **a anamnese é preenchida no tablet, na escola, quando o
responsável está lá.** O link remoto é o plano B de quem não apareceu. Então a pergunta útil não
é "quem está sem anamnese", é **"quem vai estar aqui hoje e está sem anamnese"**.

Esta spec transforma a lista em pauta diária: o TOM varre a fonte de madrugada, monta a pauta de
quem tem aula hoje, e a equipe trabalha por ela. A baixa vem da FONTE — se preencheu no sistema,
some da pauta sozinho. Ninguém precisa dizer "pronto".

## 2. Os números (medidos em 03/09, não estimados)

| unidade | base | sem anamnese | por dia (média) | pico |
|---|---|---|---|---|
| Recreio | 337 | 225 | 43 | 51 (quarta) |
| Barra | 258 | 189 | 32 | 57 (sábado) |
| Campo Grande | 400 | 345 | 63 | 80 (terça) |

- **100% dos 759 têm horário de aula conhecido** — ninguém fica de fora do gancho por falta de dado.
- Primeira aula do dia: **08:00**. Última: **20:00**. 58 aulas antes das 10h.
- Alunos com aula em mais de um dia: 30 (Recreio), 5 (Barra), 27 (CG) — aparecem nos dois dias,
  de propósito: são duas chances de pegar a pessoa.

Esses números são o argumento central do desenho. **43 a 80 tarefas por dia por unidade** mata a
ideia de "uma tarefa por aluno acumulando": em uma semana o painel teria 300 atrasadas e ninguém
olharia mais.

## 3. As três decisões que moldam tudo

**A pauta do dia é descartável; o backlog é a RPC.** O pacote nasce de manhã e é arquivado à
noite. Não existe dívida acumulando no painel, porque a fonte sempre sabe quem falta. Isso é o
que impede o contador de virar ruído.

**A escada conta APARIÇÕES, não cliques.** Contar "a equipe tentou e falhou" faria a escalada
depender de todo mundo marcar checkbox certinho todo dia — quebra na primeira semana corrida.
Contando aparições, o número vem do banco.

**Marcar o checkbox NÃO dá baixa na anamnese.** Quem dá baixa é o tablet. O checkbox é
coordenação do dia: a Vitória e a Daiana não correrem atrás do mesmo aluno. Se marcarem e o aluno
não preencheu, ele volta amanhã — e está certo que volte.

## 4. Arquitetura

Dois momentos, ambos no `dispatcher.js`, ambos por unidade (Recreio, Barra, Campo Grande — as
três de uma vez).

### 4.1 Passada da manhã (06:00 BRT) — monta

1. Consulta `get_situacao_alunos_v1(unidade, apenas_pendentes=false)`.
2. Filtra sem anamnese com **a mesma função dos cards** (`situacao-aluno.filtrarPorRecorte(data,
   'anamnese')`). De propósito: regra própria faria o card dizer 225 e a pauta 231, e aí ninguém
   confia em nenhum dos dois.
3. Filtra quem tem aula HOJE: o dia da semana sai de `aulas_resumo` (`"Canto — Segunda-feira
   19:00"`), o horário também.
4. Ordena **por horário da aula** — a lista se lê na ordem em que o dia acontece.
5. Cria no pool do grupo o container (`is_group = true`) e uma filha por aluno.
6. Grava uma linha em `anamnese_pauta` por aluno (`resultado = null`, preenchido à noite).

**Às 06:00** porque é depois do Dream (03:00) e do health check (05:00), e duas horas antes da
primeira aula: o painel já está pronto quando a primeira pessoa abre.

### 4.2 Mensagem no grupo (07:30 BRT)

Separada da criação de propósito: zap às 6h da manhã é invasivo. 07:30 é o mesmo slot do
`ops_digest`, que já é o momento de "começou o dia".

### 4.3 Passada da noite — fecha

1. Consulta a RPC de novo.
2. Para cada filha da pauta de hoje: se a fonte diz preenchida, fecha como concluída; senão,
   fecha como não-feita.
3. Grava `resultado` (`preencheu` | `nao_preencheu`) em `anamnese_pauta`.
4. Arquiva o container.
5. Fecha tarefas de link escaladas cuja anamnese apareceu preenchida.

**Não posta mensagem.** (Decisão do Alf: o placar da noite fica fora da fatia 1.)

## 5. A forma

### 5.1 No painel

Container: `📋 Anamnese — quem tem aula hoje · qua 10/09`, com uma filha por aluno:

```
08:00  Anamnese — Arthur Bezerra          (Bateria)
09:00  Anamnese — Maria Isabel            (Canto)
14:00  Anamnese — Alice Cagnin            (Canto)
```

O painel e o WhatsApp leem a MESMA fonte (`tasks` do pool do grupo), então "nascer na tela" não
é trabalho extra — é consequência de nascer no pool.

### 5.2 No WhatsApp (07:30)

```
📋 Anamnese — hoje (qua 10/09)
43 alunos com aula hoje ainda sem anamnese.
Os primeiros: 08:00 Arthur Bezerra · 09:00 Maria Isabel · 09:00 Davi Reis
A lista completa está no painel do grupo.
```

Os 43 nomes NÃO vão na mensagem: ninguém lê 43 nomes num zap, e quem tem aula às 20h não precisa
aparecer às 7h30. Os primeiros horários são os que importam quando o dia começa.

## 6. A escada

### 6.1 Onde mora

Tabela nova `anamnese_pauta`:

| coluna | tipo | nota |
|---|---|---|
| `unidade_id` | uuid | |
| `pessoa_chave` | text | a chave canônica da RPC — 337/337 distintas, conferido |
| `dia` | date | |
| `resultado` | text | `preencheu` \| `nao_preencheu` \| `sem_verificacao` \| null |
| `created_at` | timestamptz | |

Chave única `(unidade_id, pessoa_chave, dia)` — é o que impede linha dupla se o ritual rodar duas
vezes.

**Não conto pelas tarefas arquivadas** porque o título carrega o NOME, e nome não é chave: são
23 Marias só no Recreio. E guardar a `pessoa_chave` na descrição da tarefa é gambiarra que quebra
no dia em que alguém editar o texto.

### 6.2 Os degraus

Contagem = quantas linhas `nao_preencheu` o aluno tem.

- **1ª** — `14:00 Anamnese — Alice Cagnin (Canto)`
- **2ª** — `14:00 Anamnese — Alice Cagnin (Canto) ⚠️ 2ª semana — não preencheu na anterior`
- **3ª** — sai da pauta do dia e vira tarefa no pool: `Mandar link da anamnese — Alice Cagnin
  (3 semanas sem preencher)`

**A pauta é descartável; a tarefa escalada é dívida.** A pauta morre à noite e renasce da fonte;
a tarefa do link fica no painel, aparece em atrasadas, cobra. No terceiro encontro o problema
deixou de ser "lembrar na aula" — a pessoa não está vindo, ou está vindo e não dá conta.

A tarefa escalada **fecha sozinha** quando a fonte disser que a anamnese foi preenchida.

### 6.3 A primeira semana é mansa

Ninguém tem histórico no começo, então todo mundo é "1ª vez" e a escada só morde na segunda
semana. Isso é bom: dá uma semana de rodagem antes de gerar cobrança.

## 7. Quando dá errado

**RPC não responde de manhã:** não cria pacote e DIZ no grupo que não conseguiu montar a pauta.
Nunca meio pacote — 12 de 43 é pior que zero, porque o time confia e 31 passam batido. O
dispatcher tenta de novo a cada 5 min; a chave do dia impede pacote duplicado quando der certo.

**RPC não responde de noite:** não grava resultado. **Dia que não deu pra medir NÃO conta na
escada** — grava `sem_verificacao`. Se a nossa infra caiu, o aluno não pode ganhar um "não
preencheu" por isso, senão a 3ª vez chega por culpa nossa e a equipe cobra quem já tinha
preenchido. Na manhã seguinte o pacote velho é arquivado e sai do caminho.

**Aluno sai da base ativa:** a tarefa de link fecha com a nota "não está mais na base ativa".
Fechada com motivo, nunca apagada em silêncio.

**Teto de sanidade:** mais de 120 filhas numa unidade → NÃO cria e avisa. O pico medido é 80;
120 significa que a base ou a minha conta mudou, e é melhor gritar do que despejar 300 linhas.

**Idempotência:** chave `(unidade, dia)` em `anamnese_pauta` e um marcador de execução por dia,
no mesmo padrão do `GROUP_MEMORY`. O cron de 5 min bate o mesmo slot várias vezes; sem isso
nasceriam três pacotes.

## 8. Fora de escopo (fatia 1)

- **Contrato, foto, Instagram, telefone.** Só anamnese. Contrato já tem dono: o Clayton cria na
  mão com horário de assinatura combinado, e duas fontes criando a mesma tarefa colidem.
- **Placar da noite** no grupo.
- **Sucesso do Aluno** — cada unidade recebe a sua; o consolidado das três fica pra depois.
- **Lembrete por aluno no horário exato da aula** (43–80 mensagens/dia é enxurrada).

## 9. Como se prova que funciona

- **Puro e testável:** o filtro de "tem aula hoje", a ordenação por horário, a contagem da escada
  e a decisão de degrau saem em funções puras, sem banco. O ritual só orquestra.
- **E2E em grupo sombra** (`wa_group_jid` NULL — o bridge-out só varre grupos com jid, então a
  trava contra envio real é estrutural): monta a pauta, marca uma filha, roda a passada da noite
  com a fonte dizendo preenchida, confere que fechou e que `anamnese_pauta` gravou o resultado.
- **A escada** se prova com três dias simulados no mesmo aluno: 1ª normal, 2ª marcada, 3ª vira
  tarefa de link.
- **A falha** se prova com a RPC stubada em erro: nenhum pacote criado, aviso no grupo,
  `sem_verificacao` gravado, e a escada NÃO avança.

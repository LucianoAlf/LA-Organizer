# Briefing — Alfredo entra no time do TOM

**Data:** 02/08/2026 · **Para:** Alfredo · **De:** Alf (dono) + Claude (catraca)
**Assunto:** papéis, regras do jogo e o plano da refatoração da Agenda

---

## 1. Por que você está sendo chamado

O TOM é um agente de WhatsApp que roda em produção para ~30 pessoas da LA Music há meses. Ele funciona — e quebra demais. Já foram **391 known-issues corrigidos** e a sensação de instabilidade continua. Em 27/07 o Alf tomou duas decisões:

1. **Feature freeze.** Nada de funcionalidade nova. Só conserto e refatoração.
2. **Chega de microajuste.** A frase dele: *"'ah, isso aqui é barato, mexe na raiz' e continua quebrando, então assim não vai resolver."* O caminho é refatoração grande, fatiada, uma funcionalidade por vez.

Você entra como **terceiro olho**. A dupla que vem tocando isso (Alf + Claude) está com o contexto todo na cabeça há meses — e é exatamente por isso que precisa de alguém de fora para dizer o que está errado.

Uma observação honesta do Alf sobre o momento: o TOM foi feito como cópia caseira do OpenClaw/Hermes, e cada problema que a comunidade resolve nesses agentes aqui tem que ser resolvido à mão. São dois, três meses nisso. Existe cansaço real e existe a hipótese de migrar. Sua leitura sobre **isso vale a pena consertar ou vale a pena migrar** é bem-vinda — mas com fundamento, não com impressão.

---

## 2. Papéis — quem faz o quê

| Quem | Papel | O que faz | O que NÃO faz |
|---|---|---|---|
| **Alf** | Dono do produto | Define prioridade, conhece a operação e as pessoas. **Última palavra.** | Não programa |
| **Claude** | Catraca / executor | Investiga raiz, escreve código com TDD, deploya, verifica sozinho no banco e nos logs, registra known-issues | Não aceita relato sem verificar |
| **Alfredo** | **Auditor cruzado / contraponto** | Lê tudo, audita, questiona, traz contrapontos e riscos que a dupla não viu | **Não escreve código. Não deploya. Não altera dado.** |

**Regra explícita do Alf:** *"O Alfredo não faz nada: ele olha, ele audita, faz uma auditoria cruzada e traz os contrapontos dele. A gente não é obrigado a aceitar. Quem dá a última palavra somos nós dois."*

Isso não é desconfiança — é desenho. Contraponto que também executa deixa de ser contraponto. **Discorde com força; a decisão é nossa.**

---

## 3. Seus acessos

Você tem **repositório, banco e VPS**. Fique à vontade para olhar tudo — engine, prompts, skills, dados de produção, logs.

- **Repo:** `github.com/LucianoAlf/LA-Organizer` (branch `main` = fonte de verdade)
- **VPS:** `/opt/LA-Organizer`, processo pm2 `tom`. **Log real:** `/opt/LA-Organizer/logs/` (o `/root/.pm2/logs` está morto e mostra falso-zero)
- **Banco:** Supabase `cesnbnrynvxvgdhfmaua`
- **Auditoria de 27/07 (leitura obrigatória, não refazer):** `docs/auditoria/README.md`

**Leitura antes de opinar:** `docs/auditoria/` inteiro, `soul/SOUL.md`, `soul/AGENTS.md`, `src/engine.js`, `src/prompts/system.js`, e a tabela `tom_known_issues` (o histórico de tudo que já quebrou e foi corrigido — consulte ANTES de apontar bug novo; muita coisa que parece bug novo é regressão já mapeada ou falso-positivo já refutado).

---

## 4. O que já sabemos (dados de produção, não impressão)

Da auditoria de 27/07:

- **`TASK_UPDATE` é a ação mais usada: 411 usos/mês, 14,1% de falha.** O modo dominante é `all_failed` (36×) — o sistema **não consegue identificar de qual tarefa a pessoa está falando**.
- **60% das tarefas pendentes têm título duplicado** (337 de 561). Essa é a causa material do item acima.
- **`engine.js` tem 14.671 linhas**, `processMessage` sozinho tem 4.587, e **zero teste interno**.
- **O financeiro é a área mais confiável: 1,3% de falha.** A diferença é arquitetural — ele tem **executor determinístico**: a confirmação executa um rascunho guardado, em vez de devolver a decisão ao LLM. **É o modelo a copiar.**
- 18 das 64 skills nunca são carregadas. 3 ações ensinadas no prompt não existiam no código (corrigido).
- Engajamento caiu de 1.169 para 172 mensagens/semana. Parte é recesso escolar; o Alf diz que não é só isso.

**Padrão-mãe identificado:** quando a capacidade não existe, o LLM improvisa — inventa que fez, ou nega que consegue. E detectores determinísticos por palavra-chave, criados para conter alucinação, passaram a **sequestrar turnos antes do LLM interpretar**. O Alf resume assim: *"a gente foi colocando um monte de algema nele; ele não tem liberdade, não interpreta."*

---

## 5. Exemplo do que "resolver na raiz" significa aqui (feito hoje, 02/08)

Vale como calibragem do padrão que queremos — e como amostra do que auditar.

**Sintoma:** o Arthur pediu que as rotinas dele parassem de ser tarefa e virassem lembrete. Ele levava ~10 mensagens/dia sobre 2 rotinas que já cumpria: briefing, 5 cobranças de atraso, lembrete T-1, fechamento do dia e balanço de aderência.

**Diagnóstico errado (meu, corrigido depois):** eu afirmei que "lembrete recorrente" não existia como entidade. **Existia** — chama-se hábito (`habits` + `habit_reminders`), dispara no horário e não cobra nada. Pior: o Arthur **já tinha um hábito rodando em paralelo** às tarefas que o cobravam. Eu declarei capacidade inexistente sem varrer o schema — a mesma classe de erro que combatemos no TOM.

**Raiz real:** duas entidades certas existiam e **não havia ponte entre elas**. Sem ponte, o LLM improvisava.

**Correção:** marker `<<TASK_TO_HABIT>>`. O LLM **só interpreta** a intenção e nomeia a rotina; o engine faz o resto de forma determinística — resolve o molde, traduz a RRULE para o calendário do hábito, define horário, encerra a série. Falha honesta (não achou / ambíguo / recorrência sem equivalente) **sem efeito colateral nenhum**.

**Provas:** 44 testes novos, suíte 2054/3 (baseline intacto), E2E 13/13 contra o banco real. Aplicado em produção: o Arthur saiu de **51 tarefas cobráveis para 0**, com 2 lembretes ativos cobrindo a mesma rotina e 53 tarefas concluídas de histórico preservadas.

**Arquivos:** `src/utils/rrule-to-habit.js`, `src/services/task-to-habit.js`, bloco 2.61 de `src/engine.js`.

👉 **Primeiro pedido concreto:** audite essa mudança. Se ela estiver errada, quero saber agora, com um caso que quebre.

---

## 6. O plano — começamos pela AGENDA

**Por que agenda primeiro:** é o que mais se usa e o que mais quebra. Lembrete, tarefa, delegação e compromisso são o núcleo do produto. Grupos vem depois.

**Escopo da fatia Agenda:** tarefas, compromissos, recorrência, lembretes, delegação e cobrança.

**Princípio que guia tudo:** **o LLM interpreta; o engine executa.** Interpretação de linguagem é do modelo — é nisso que ele é bom, e é onde as algemas o estragaram. Fato (qual registro, qual data, o que persistiu) é do código, determinístico e testável. Foi o que deu 1,3% de falha ao financeiro.

**Etapas propostas** (ordem sujeita ao seu contraponto):

| # | Etapa | Entrega | Por quê |
|---|---|---|---|
| **E0** | Medir antes de mexer | Instrumentação por modo de falha da agenda | Não repetir "achismo de raiz". Recomendação velha é hipótese, não fato |
| **E1** | **Identidade do alvo** | Resolvedor único de tarefa/compromisso, fora do engine, com testes | É a raiz do 14% de `TASK_UPDATE`. Ataca a causa dos 60% de títulos duplicados |
| **E2** | **Executor determinístico** | Ações de agenda com rascunho + execução verificada, espelhando o financeiro | Mata a família "confirmei e não aconteceu" |
| **E3** | Ciclo de vida da recorrência | Molde × instância × série com regra única | Dor histórica #1 |
| **E4** | Cobrança e lembrete | Superfícies unificadas e com controle do usuário | Parcialmente feito hoje (item 5) |
| **E5** | Desmonte do `engine.js` | Extrair o que virou serviço testável | Consequência, não objetivo. Refatorar sem E1–E4 é mudar o lixo de lugar |

**Como cada etapa fecha:** teste que falha antes e passa depois · zero regressão na suíte · verificação no banco real (não no relato) · known-issue registrado.

---

## 7. O que NÃO se toca

- **Voz, tom e tamanho das respostas do TOM são sagrados.** Vetado pelo Alf. Otimizar infraestrutura, nunca a personalidade. Se você achar que a voz é parte do problema, **diga — mas como contraponto, não como mudança.**
- Dado de produção não se altera sem OK explícito do Alf.
- Nada de feature nova durante o freeze. Se aparecer necessidade real (como a do item 5), ela sobe para o Alf decidir; não entra por dentro.

---

## 8. O que eu quero de você, concretamente

Não quero validação. Quero as perguntas que estamos deixando de fazer.

1. **A ordem E0→E5 está errada?** Se sim, qual e por quê.
2. **O "executor determinístico" é mesmo a lição certa do financeiro** — ou o financeiro acerta mais por ter domínio mais estreito (poucas entidades, verbos previsíveis) e a lição não se transfere?
3. **As algemas.** Levantamos detectores determinísticos que rodam antes do LLM. Quais deles estão causando mais dano do que evitando? Qual você tiraria primeiro?
4. **A hipótese de migração.** Olhando o código de verdade: refatorar isso é mais barato que reconstruir sobre uma base de agente mantida pela comunidade? Queremos número e argumento, não torcida.
5. **Onde nós dois estamos nos enganando?** Estamos há meses aqui dentro. Esse é o item mais valioso da lista.

**Formato do retorno:** um `.md` com achados separados em **(a) o que quebra hoje, com evidência** — arquivo, linha, log ou linha do banco; **(b) risco arquitetural** — o que vai quebrar de novo se seguirmos assim; **(c) contrapontos ao plano acima**. Ordenado por impacto. Sem evidência, marque como hipótese explicitamente.

Regra que vale para todos nós, especialmente aqui: **relato não é prova.** Já perdemos dias tratando como regressão coisa que era fixture de teste, invocação errada de CLI ou falso-positivo do auditor. Se afirmar que algo quebra, mostre o log, a linha ou a query.

---

## 9. Combinado operacional

- Você audita e escreve `.md`. Nós decidimos e executamos.
- Discordância sua registrada e recusada por nós **fica registrada assim mesmo** — se der errado depois, o registro serve.
- Cadência: uma rodada de auditoria por etapa. Você olha antes de começarmos e depois de fechar.

Bem-vindo. Pode ser duro.

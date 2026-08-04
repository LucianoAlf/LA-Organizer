# Diagnóstico — "a resposta do usuário não vira ação"

**Data:** 04/08/2026 · **Autor:** Claude (catraca) · **Para:** Alf e Alfredo
**Status:** diagnóstico fechado. **Nenhuma correção foi feita** — de propósito.

Este documento é só o Passo 0: descobrir **onde** a falha acontece, antes de qualquer
proposta de solução. Separei diagnóstico de solução para não escolher a causa que me
convém: quem já sabe o que quer construir tende a achar exatamente o problema que sua
solução resolve.

---

## 1. O que motivou o levantamento (e o que ele derrubou)

A auditoria de 27/07 apontou que `TASK_UPDATE` — a ação mais usada do sistema — **falha
14%**. Isso vinha orientando a prioridade.

**O número está inflado.** Das 56 rejeições de `TASK_UPDATE` em 30 dias (de 417 usos):

| classe | n | é falha? |
|---|---|---|
| pediu confirmação de fechamento em lote | 17 | **não** — comportamento correto |
| avisou que a data já passou | 7 | **não** |
| duplicata: pediu escolha em vez de chutar | 11 | não (mas é sintoma real) |
| schema inválido | 6 | **sim** |
| sem `raw` gravado — cego | 10 | impossível saber |
| outra | 5 | ? |

**Falha real: entre 1,4% e 5%, não 13,4%.** Metade do que o painel chama de rejeição é o
TOM acertando — e sendo contabilizado como erro.

Se tivéssemos "consertado o `TASK_UPDATE`", teríamos otimizado contra ruído.

## 2. Onde a dor realmente está

Falhas registradas por incidente, 30 dias (`tom_audit_findings`):

| categoria | casos | pessoas atingidas |
|---|---|---|
| **pedido largado** | **76** | **22 de ~30** |
| frustração | 23 | 10 |
| confabulação | 14 | 10 |
| overreach proativo | 7 | 5 |
| recusa indevida | 4 | 3 |

**Nada disso aparece como marker rejeitado** — o TOM não tenta. É falha silenciosa: não
dispara alarme, não entra em estatística de erro, e só existe porque alguém leu a conversa.

Lendo os 76 caso a caso, eles são quatro problemas diferentes:

| padrão | ~n |
|---|---|
| **resposta do usuário não vira ação** | **~29** |
| multi-intenção / execução parcial | ~19 |
| financeiro (interpretação, não execução) | ~11 |
| recado a terceiro não encaminhado | ~6 |

## 3. Método

Para 8 casos do padrão #1, reconstruí a janela de ±3 minutos em torno do incidente:
`conversation_history` (as falas reais) cruzado com `marker_logs` (o que o motor tentou
fazer no mesmo minuto). Se o LLM emitiu marker, ele aparece. Se não emitiu, o silêncio é o
dado.

Três hipóteses, mutuamente exclusivas, definidas **antes** de olhar:

- **H1** — o LLM não emite marker nenhum;
- **H2** — emite, mas o executor recusa;
- **H3** — a resposta nunca é associada à cobrança que a originou.

---

## 4. Veredito

### H3 — **REFUTADA**

O vínculo existe e chega ao modelo. O texto do inbound carrega o scaffold literal:

```
[O usuário está RESPONDENDO a esta mensagem anterior: "🟠 *Calendários das escolas* tá
parada há 3 dias. O que rolou? Reagenda, cancela, ou já fechou?"] Estou fazendo Tom, hoje termino
```

A informação está lá, completa e explícita. **Não é problema de contexto.**

### H2 — **minoritária**

Caso 8 (Rafinha): o usuário confirma a delegação e o TOM responde *"Não consegui registrar
a delegação — dá um erro aqui do meu lado"*, com `TASK_UPDATE/rejected:all_failed:1`. Aqui o
marker saiu e o executor recusou. É falha real, mas é a exceção na amostra.

### H1 — **CONFIRMADA, e é o caminho dominante**

Nos casos do padrão #1, os markers do minuto mostram tudo menos a ação pedida:

| caso | o que o usuário disse | markers no minuto |
|---|---|---|
| 1 (Rafinha) | "Ata show vlw" / "Isso" | `COORDINATION_RESPONSE` · `REACT` 👍 — **nenhuma baixa** |
| 3 (Luciano) | "Estou fazendo Tom, hoje termino" | `CHOKEPOINT/redirected:confab:unknown` — **nenhum TASK_UPDATE** |
| 5 (Ana) | "Sim" / "pode criar" | `ACTIONABLE_NO_MARKER` · `CHOKEPOINT:confab:promise_nomarker` |
| 6 (Matheus) | "Todas feitas" | `TASK_UPDATE/rejected:all_failed:3` (= só pediu confirmação) |

O caso 3 merece leitura atenta: o `CHOKEPOINT` **funcionou** — pegou o TOM prestes a
confabular que havia registrado, e converteu em *"não consegui registrar isso agora, me
manda de novo"*. O guard salvou a honestidade. **Mas a ação nunca aconteceu**, e o custo
recaiu sobre o usuário, que teve que repetir.

---

## 5. O achado que muda o desenho: **não é determinístico**

A frase do caso 3 — *"Estou fazendo Tom, hoje termino"* — foi dita **duas vezes**, pela
mesma pessoa, respondendo à **mesma cobrança**:

| quando | resposta do TOM | resultado |
|---|---|---|
| dia do incidente, 13:02 | "⚠️ Na real não consegui registrar isso agora — me manda de novo" | **nada persistiu** |
| 03/08, 16:25 | "Boa! Reagendo pra hoje pra tirar o 'atrasada' da frente." | **funcionou** |

Mesma entrada, mesmo contexto, resultados opostos.

Isso descarta as explicações do tipo "faltou instrução no prompt" ou "a skill não carregou"
— se fosse isso, falharia sempre. **O reconhecimento depende de o LLM decidir emitir um
marker, e essa decisão é probabilística.** Nenhum ajuste de texto no prompt torna
determinístico o que é, por construção, uma amostragem.

É a mesma diferença que já está medida no sistema: **o financeiro falha 1,3% porque tem
executor determinístico.** Todo o resto depende de o modelo lembrar de emitir o marker.

## 6. Dois problemas que os dados revelaram e que eu não estava procurando

### 6.1 Gatilho por palavra-chave sequestra a conversa

**Caso 7.** O Alf explica, por áudio, a demanda de iluminação do SonoraMente — o que
comprar, para que serve o núcleo. Resposta do TOM:

> "Esse lançamento já tá fora das ~2h que eu consigo editar pelo chat — mas no app você
> resolve em segundos..."

Marker: `CHOKEPOINT/redirected:redirect:finance:edit`.

Um **redirect determinístico do financeiro** disparou numa conversa que não tinha nada de
financeiro. Não é o LLM alucinando: é uma regra nossa, por palavra-chave, atropelando o
contexto. Este caso é diferente de todos os outros do documento — aqui o problema é o
código, não o modelo.

### 6.2 Confirmação pendente engole a mensagem seguinte

**Caso 4**, sequência completa:

```
20:08 USER: ta concluído tom
20:08 TOM : Confirma o fechamento destas 4 tarefas: *Barra*, *CG*, *Repasses*, *Recreio*?
20:08 USER: mas ta td misturado trabalho e pessoal ai né, organiza melhor pf
20:09 TOM : Confirma o fechamento destas 4 tarefas: *Barra*, *CG*, *Repasses*, *Recreio*?   ← repetiu
20:11 USER: sim
20:11 TOM : ✅ Concluí: *Barra*, *CG*, *Repasses de Cartões*, *Recreio*.
```

O usuário fez um pedido novo no meio ("organiza melhor") e o TOM **repetiu a pergunta
anterior palavra por palavra**. Enquanto há confirmação pendente, a mensagem seguinte é
lida apenas como resposta àquela pergunta — qualquer outra intenção é descartada.

Isto liga o padrão #1 ao padrão #2 (multi-intenção): pode ser **um** problema, não dois.

### 6.3 O laço de re-confirmação, quantificado

Em 30 dias o TOM pediu *"Confirma o fechamento destas N tarefas"* **24 vezes**. Em **7
delas (29%)** o usuário **já tinha dito, na fala imediatamente anterior**, que estava feito
— "Todas feitas", "ta concluído tom", "pronto".

Uma em cada quatro vezes, o TOM pergunta o que acabou de ser respondido.

---

## 7. O que este diagnóstico **não** estabelece

Sendo explícito sobre os limites, porque a decisão vai ser tomada em cima disto:

- **Amostra de 8 casos** lidos em profundidade, de ~29 do padrão. Suficiente para separar
  H1/H2/H3, não para afirmar proporção exata entre eles.
- **10 rejeições sem `raw`** continuam cegas. Não sei o que aconteceu nelas.
- **Não sei por que o LLM emite às vezes e às vezes não.** Sei que varia com entrada igual
  — não sei o que empurra a decisão para um lado ou para o outro.
- **Não testei a hipótese de carga de contexto** (conversa longa, muitas skills). É
  plausível e não foi medida.
- O caso 6.1 (redirect financeiro) tem **um exemplo**. Pode ser isolado ou sistemático; não
  medi a frequência.

## 8. Direção que os dados sugerem — como hipótese de trabalho, não como plano

O que a evidência aponta: **tirar do LLM a decisão de emitir marker quando a resposta é a
uma cobrança identificável.** A cobrança tem ID, a resposta é vinculada a ela por
`whatsapp_message_id`, e o conjunto de ações possíveis é fechado (fez / reagenda / cancela).
Isso é código, não interpretação — e é exatamente o desenho que faz o financeiro falhar dez
vezes menos que o resto.

Duas coisas que caminham em paralelo, independentes e mais baratas:

- o **redirect por palavra-chave** (6.1), que é bug de código puro;
- o **laço de re-confirmação** (6.3): 29% das perguntas de confirmação são desnecessárias.

Não estou propondo implementação aqui. O próximo passo é vocês dois olharem isto e
decidirem o recorte — inclusive se discordam da leitura.

---

## Anexo — como reproduzir

```sql
-- 1. rejeições do TASK_UPDATE classificadas por natureza real
-- 2. falhas por categoria em tom_audit_findings (30d)
-- 3. janela de ±3min: conversation_history × marker_logs por incidente
-- 4. pedidos de "Confirma o fechamento" precedidos de confirmação do usuário
```

Consultas completas em `scripts/sql/` (a serem versionadas se o diagnóstico virar trabalho).
Base: `conversation_history`, `marker_logs`, `tom_audit_findings`, janela de 30 dias
terminando em 04/08/2026.

**Nota de estado:** os 124 findings do período estão **todos** com status `novo`. O detector
encontra e ninguém tria. Enquanto esse ciclo não fechar, cada auditoria vai reencontrar os
mesmos casos.

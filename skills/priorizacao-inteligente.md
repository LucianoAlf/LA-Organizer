---
name: priorizacao-inteligente
description: Classifica demandas acionáveis em resolver agora, tarefa, ligação, reunião, delegar ou projeto. Ativa quando a demanda chega mal definida, misturada ou com prioridade implícita.
---

# Priorização Inteligente

Esta skill faz o TOM **pensar antes de responder** — decidir o **formato certo de ação** pra cada demanda. Os frameworks (5min, Eisenhower) operam por baixo do capô; na superfície o TOM fala como copiloto prático ("isso resolve agora", "isso é ligação", "isso já é projeto"). **Nunca** cite "matriz de Eisenhower", "quadrante 2", "framework" pro usuário.

## Quando ativar
Demanda acionável mal definida; dúvida de prioridade; várias coisas misturadas; algo que pode resolver agora ou virar agenda; "anota isso", "preciso resolver X", "lembra de falar com Y", "temos que ver Z". Atua como camada de decisão antes de `checklist-tarefas`, `cadastro-projeto-5w2h` ou `broadcast`. Se a decisão já é óbvia, não complique.

## As 7 saídas
1. resolver agora · 2. criar tarefa · 3. agendar ligação · 4. marcar reunião · 5. delegar/follow-up · 6. estruturar como projeto/5W2H · 7. tirar do foco por enquanto.

## Regra principal — se resolve em até 5 min, resolve agora
Se leva ≤5min, não exige preparação/deslocamento/análise profunda e destrava o dia → empurre pra ação imediata, não pra empilhar agenda ("isso é de 2 minutos, resolve já e tira da frente").

**Exceções** (não empurre pra "agora" mesmo sendo rápido): contexto impróprio (dirigindo, reunião, madrugada, fechamento), decisão emocional delicada, risco/conflito/mensagem sensível, ou é só a ponta de algo maior. Aí: "é rápido, mas não parece a melhor hora — deixo agendado."

## Motor de decisão (interno, em ordem)
1. **Tempo:** resolve em ≤5min? Sim → tende a "resolver agora". Não → segue.
2. **Natureza:** ação rápida individual / tarefa de execução / ligação curta / reunião / follow-up-delegação / projeto.
3. **Urgência × importância** (Eisenhower, sem citar): urgente+importante → primeiro; importante+não-urgente → agenda/proteger; urgente+pouco-importante → delegar/ligação/follow-up; nem-nem → sai do topo/adia.
4. **Precisa estrutura?** Várias etapas, dependências, prazo longo, pessoas envolvidas, escopo ambíguo → sobe pra projeto/5W2H, não tarefa simples.

## Critérios por tipo de saída
- **Resolver agora:** ≤5min, baixo atrito, destrava (responder ok, ligação relâmpago, confirmar horário). Não vire tarefa por reflexo.
- **Criar tarefa:** ação real, não cabe agora, individual, começo/fim claros.
- **Agendar ligação:** destrava rápido por telefone, alinhamento curto com 1 pessoa, não justifica reunião.
- **Marcar reunião:** conversa mais profunda, 2+ pessoas, decisão conjunta/feedback, não cabe em ligação.
- **Delegar/follow-up:** depende de outra pessoa; o próximo passo é cobrar/acompanhar.
- **Projeto/5W2H:** múltiplas frentes, precisa objetivo/responsável/prazo/método.
- **Tirar do foco:** sem urgência/importância real; custo mental > valor.

## Formato numerado para sequências
Demanda com **2+ etapas em sequência** → lista numerada, verbo de ação no início, curto. Ação única → frase curta sem lista.

Exemplo (multi-passos): *"preciso resolver a NF do Renan pelo show"* →
1. Liga pro Renan — pega CNPJ, valor e descrição do serviço
2. Repassa pra Ana do Financeiro — ela emite a nota
3. Confirma com o Renan quando sair

Regras: máx 3-4 passos (mais → é projeto); cada linha começa com verbo (Liga/Repassa/Confirma/Manda/Pede/Agenda); uma linha por passo; numerado quando a ordem importa. Se um passo depende de info ausente, numera só o que está claro e faz UMA pergunta objetiva no fim — não inventa passo nebuloso.

## Relação com outras skills
Decide **se vira** tarefa → entrega pra `checklist-tarefas`. Pede estrutura/responsáveis/prazo → `cadastro-projeto-5w2h`. Comunicar várias pessoas → `broadcast`. Nos rituais, usa essa lógica pra sugerir o que vem primeiro.

## Regra de criação prematura
Confirmação NÃO é regra global. Intenção clara + demanda óbvia ("anota X", "me lembra de Y", "cria tarefa pra Z") → cria direto. Pergunte antes só em: ambiguidade real, ação sensível (outra pessoa/conflito), próximo passo nebuloso, ou usuário pensando em voz alta.

**Anti-duplicação:** NUNCA emita `TASK_CREATE` no mesmo turno em que pergunta "confirma?"/"quer que eu crie?". Pergunta = aguarde resposta; confirmação no turno seguinte = aí emite. Misturar gera duplicação quando o user responde "sim".

---

## Checklist vs Checkpoint (conceitos diferentes — não tratar como sinônimo)

| | Checklist | Checkpoint |
|---|---|---|
| **Responde a** | "o que fazer?" | "o que está definido?" |
| **Forma** | verbo (Definir tema) | particípio (Tema definido) |
| **Persistência** | conversa (transitório) | DB (`project_checkpoints`) |
| **No app** | não aparece | aba do projeto |
| **Toggle** | não | sim (pending ↔ done) |

**Checklist na conversa** (orientação): user quer pensar/quebrar em passos, projeto não definido. Resposta = lista numerada com **verbos**, SEM marker.

**Checkpoint batch** (persiste marcos): só quando TODAS forem verdade — (1) projeto cadastrado identificável, (2) ≥4 marcos verificáveis (não passos), (3) user pediu pra salvar/registrar/estruturar. Resposta = anuncia, lista marcos em **substantivo+particípio**, cola o marker:

```
✅ Vou registrar como checkpoints do Workshop de Improvisação:
• Tema e formato definidos com Moreira
• Local e data confirmados
• Custos aprovados
• Público-alvo e vagas definidos

<<CHECKPOINT_BATCH>>
{"project_name":"Workshop de Improvisação","items":[{"name":"Tema e formato definidos com Moreira"},{"name":"Local e data confirmados"},{"name":"Custos aprovados"},{"name":"Público-alvo e vagas definidos"}]}
<<END>>
```

**Schema items:** `name` (obrigatório, máx 200 chars, substantivo+particípio), `due_date` (opcional ISO `YYYY-MM-DD`), `description` (opcional).
**Schema envelope:** `project_name` (string) OU `project_id` (uuid — prefira se sabe do contexto); `items` array com 2+ (engine rejeita batch de 1).

**Conversão checklist→checkpoint:** quando o user produz checklist (verbos) e pede pra salvar — reformule verbo→particípio (Definir tema → Tema definido), anuncie a conversão, liste, cole `<<CHECKPOINT_BATCH>>`.

**Veto CHECKPOINT_BATCH:** nunca com items em verbo de ação (reformule pra particípio); nunca sem projeto identificado; nunca pra listinha de 2-3 itens; nunca prometa "vou salvar" sem emitir o marker no mesmo turno; se ambíguo qual projeto, PERGUNTE antes.

---

## Saída técnica — campo `action_type` no `<<TASK_CREATE>>`

Sempre que a skill culminar na criação de tarefa (via `checklist-tarefas`), o marker inclui `action_type` mapeado da decisão interna:

| Decisão interna | `action_type` |
|---|---|
| Resolver agora (≤5 min) | `now` |
| Criar tarefa (execução individual) | `task` |
| Agendar ligação | `call` |
| Marcar reunião | `meeting` |
| Delegar / follow-up | `delegate` |
| Estruturar como projeto / 5W2H | `project` |
| Tirar do foco | _(não cria task)_ |

```
<<TASK_CREATE>>
{"title":"Ligar pro Renan — resolver emissão de NF","due_date":"2026-04-29","remind_at":"2026-04-29T14:00:00-03:00","scope":"work","priority":"medium","action_type":"call"}
<<END>>
```

**Regras finais:** emitir o valor mais específico (`call` antes de `task`, `project` antes de `task`); em dúvida → `task` (default conservador); `now` é raro (resolve-agora vira ação imediata, não task — só registre se o user pedir); NUNCA invente valor fora dos 6 (engine rejeita); NUNCA escreva `action_type=call` no texto do WhatsApp — o campo é só pro engine/app.

## Veto
- Não burocratizar coisa simples; não transformar tudo em tarefa nem toda conversa em reunião.
- Não usar linguagem de framework com o usuário.
- Não classificar só por urgência aparente — pese importância real.
- Não sugerir "resolve agora" em contexto inadequado; não empilhar agenda como fuga da decisão.
- Não emitir `TASK_CREATE` no mesmo turno que pergunta de confirmação.
- **Anti-promessa-vazia:** se falar "vou salvar/registrar/guardar pro projeto X", o `<<CHECKPOINT_BATCH>>` DEVE aparecer NA MESMA mensagem. Confirmação factual ("✅ N itens registrados") só DEPOIS do marker, nunca antes.

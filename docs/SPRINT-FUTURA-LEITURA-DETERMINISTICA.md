# Sprint Futura — Leitura Determinística (Fatia 3: provider com tools)

> **Status:** RADAR — decisão consciente de SEGURAR (Alf, 27/08/2026). Não implementar sem nova discussão.
> **Origem:** auditoria-da-auditoria de 27/08. Fatias 1 e 2 estão NO AR; esta é a que ficou.
> **Memória:** `project_ctx_leitura_deterministica`, `project_ctx_teto_cego_maxdaily`.

---

## 🎯 A tese (vale mesmo se a fatia 3 nunca acontecer)

A **escrita** do TOM sempre teve executor determinístico: marker → service → banco. É por isso que o
financeiro falha 1,3% e é "o modelo a copiar" (CLAUDE.md).

A **leitura** nunca ganhou um. Era despejada no prompt de véspera e cortada por **três gates em série**:

| # | Onde | Corta |
|---|---|---|
| 1 | busca em `fetchCollaboratorContext` | `due_date <= hoje+N` — o dia N+1 nunca chega ao render |
| 2 | **`max_daily_tasks`** (default **3**) | `workTasks.slice(0, 3)` |
| 3 | `renderTaskList` | o antigo `slice(0, 8)` |

O sintoma é sempre o mesmo: **o TOM nega existência de algo que está no banco.** E é a classe que
guard de honestidade **não pega** — ele não mente, nunca viu o dado.

---

## ✅ O que JÁ está no ar (não refazer)

**Fatia 1** — `8dc4303b` (parser), `1640cde8` (bloco + wiring), RPC `tom_tarefas_por_periodo`:
- **Gatilho é DATA, não assunto.** `src/lib/date-phrase.js` extrai período. Extração de *entidade*
  (finita, enumerável, testável), não classificação de *intenção*.
- **Assimetria de risco que justifica gatilho generoso:** o resultado só **enriquece contexto** —
  não grava, não envia, não muta. Falso-positivo custa ~500 chars; falso-negativo custa o bug.
  *Regex que AGE e regex que ENRIQUECE são classes de risco diferentes.*
- **O ponto do bloco não é mostrar mais tarefa — é ter uma lista cujo VAZIO prova ausência.**
  Vazio ⇒ pode negar (e só daquele período). Cheio ⇒ não pode negar.
- **Erro da RPC OMITE o bloco** em vez de renderizar "nenhuma tarefa": vazio fabricado por falha de
  rede seria pior que o bug original — viraria licença pra negar com confiança.

**Gates 1 e 3** — `daf48d30`, `a6a7b9e9`: janela por horizonte (atrasadas + 14 dias entram sempre),
teto por **caracteres** e não por contagem, corte **declarado** no prompt, e a busca alinhada ao
MESMO `HORIZONTE_DIAS` do render (senão a janela promete cobertura que o dado não entrega).

**Fatia 2** — `8dc86544` + migration: a premissa original ("migrar digest e relatório pra RPC") era
**falsa** — `ops-digest` não lê `tasks` e o relatório de grupo lê outro eixo. O que existia era
**divergência de INVARIANTE**: `data_classification='real'` (aplicado por 12 arquivos) faltava na
RPC nova e no `group-report-builder`. Corrigido.

---

## 🚧 Fatia 3 — o que ficou (e por que segurou)

**O que seria:** o LLM chamar a RPC quando quisesse — resolve a pergunta **sem data**
("o que tá pendente do Léo?", "quais faturas faltam?"), que a pré-busca por período não alcança.

**Por que NÃO é uma fatia pequena:**
- O TOM roda Claude via **CLI com `--tools ""`** — tool-calling está desligado, e há um **sanitizer
  arrancando `tool_use`** que o modelo insiste em emitir (`src/ai/claude.js`).
- **Não existe marker de LEITURA.** Todos os markers (`<<TASK>>`, `<<EVENT>>`, …) são de escrita.
- Ligar tools significa mexer na camada de provider — a mesma que segura **latência** e o
  **paralelismo do CLI** (`TOM_CLAUDE_PARALLEL=1`).

**Decisão do Alf (27/08): SEGURA.** Mexe na camada que segura latência e paralelismo, e o ganho é
menor que o risco enquanto o gate 2 continuar sendo o que mais cega.

---

## 🎯 Alvo melhor ANTES da fatia 3: o `max_daily_tasks`

`max_daily_tasks` nasceu como regra de **apresentação** do briefing ("1-3 prioridades por dia",
Sprint 22.X). Mas o mesmo array de 3 itens é a única coisa que o TOM **sabe** quando perguntam.
Regra de foco virou regra de conhecimento.

**Medido em produção (27/08):** 37 de 40 perfis em `max_daily_tasks = 3`; **12 de 20 colaboradores
com tarefas de trabalho veem menos do que têm** (maior fila: 132 abertas → o TOM vê 3).

**Recomendação registrada (aguarda decisão):** separar **conhecimento** de **apresentação** — o
briefing continua com as 1-3 prioridades (comportamento intacto, veto do Alf) e o resto do horizonte
entra num bloco de **referência** rotulado, que o TOM consulta antes de negar.
**Subir o `max_daily_tasks` seria trocar bug por bug** — encheria o briefing.

---

## ❌ Vetos

- **Não** subir `max_daily_tasks` como "solução". O briefing focado é comportamento desejado.
- **Não** aplicar filtro de visibilidade nos **resolvedores** do chat (`group-chat-tasks`,
  `group-chat-engine`). Lá, esconder faz o completer não achar tarefa que a pessoa nomeou — o mal
  maior no resolvedor é "não achei". **Relatório esconde arquivada; resolvedor ainda encontra.**
- **Não** deixar a RPC devolver "nenhuma tarefa" quando ela FALHA. Omitir o bloco é obrigatório.
- **Não** trocar o gatilho de data por gatilho de assunto/intenção.

---

## 🧪 Como testar (o que pegou os bugs que teste sintético não pegaria)

1. **Adversarial contra fala real** — rodar o parser contra ~1000 mensagens de `conversation_history`.
   Foi assim que apareceram: data lida DENTRO da citação do TOM; a variante
   `"(conteúdo completo do banco):"`; `[mensagem 1/2]` (andaime do engine) virando `01/02`.
2. **Sombra real contra o TOM** — perfil QA (`TOM_QA_PHONES`), `whatsapp.sendMessage` stubado, seed
   de tarefas, cleanup no `finally`. Casos mínimos: data escondida pelo briefing; data vazia; papo
   sem data; **"me lembra <data>…" tem que continuar CRIANDO** (o bloco não pode degradar pedido de
   escrita em consulta); "ok" respondendo citação com data.
3. **Comparação velho×novo em produção** antes de afirmar no-op.

> ⚠️ **Armadilha que se repetiu TRÊS vezes em 27/08:** a medição não tocava no que mudou.
> `buildSystemPrompt` devolve `{systemPrompt, ctx}` (ler `JSON.stringify` casa contra o ctx cru);
> um script tinha **cópia** da regex e media a versão velha; `shapeOpenTasks` devolve objetos **sem
> `id`**, então comparar por `id` deu "idêntico" vácuo.
> **Regra: antes de concluir "não mudou nada", provar que a chave de comparação existe no objeto.**

---

## ✅ Próximo passo (quando atacar)

1. Decidir o `max_daily_tasks` (conhecimento × apresentação) — **maior ganho, menor risco**.
2. Só depois reavaliar a fatia 3, medindo antes quanto da dor real é pergunta **sem data**.

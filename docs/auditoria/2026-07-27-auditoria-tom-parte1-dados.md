# Auditoria TOM — Parte 1: o que se usa × o que quebra (dados)

**Data:** 2026-07-27 · **Autor:** catraca (revisor) · **Contexto:** feature freeze decretado pelo Alf em 27/07 — nada novo, só conserto e refatoração, atacando primeiro o que mais quebra.
**Método:** só dado do banco de produção (`marker_logs`, `conversation_history`, `tom_known_issues`) e contagem de linhas do repo. Nada de estimativa.

---

## 0. O achado que muda a prioridade: o engajamento JÁ está caindo

Mensagens **enviadas pelo time** ao TOM, por semana:

| Semana | Mensagens | Pessoas ativas |
|---|---|---|
| 01/06 | 411 | 24 |
| **08/06** | **1.169** | **27** ← pico |
| 15/06 | 471 | 27 |
| 22/06 | 457 | 26 |
| 29/06 | 336 | 26 |
| 06/07 | 432 | 27 |
| 13/07 | 350 | 24 |
| **20/07** | **172** | **18** |

**Junho → julho, por pessoa (todos caíram, ninguém subiu):** Rose −49% · Alf −48% · Quintela −52% · Ana −31% · e mais seis pessoas entre −65% e −98%.

**Leitura honesta — há duas hipóteses e elas não se excluem:**
1. **Atrito**: o TOM quebra, a pessoa desiste de usar. É o medo que o Alf verbalizou ("o pessoal vai cair o engajamento").
2. **Sazonalidade**: julho é férias escolares; parte da queda pode ser do calendário da escola.

**O que pesa contra a explicação puramente sazonal:** a queda atinge com força quem **não** tira férias em julho — Rose (financeiro, −49%) e o próprio Alf (−48%). E a curva já cai desde 15/06, antes das férias.

**Quem sabe desempatar é o Alf** (conhece o calendário do negócio). Mas mesmo no cenário sazonal, a tendência de 8 semanas é de queda contínua, e vale tratar como sinal.

---

## 1. O que o time mais usa × onde mais falha (30 dias)

Fonte: `marker_logs`. "Marker" = a ação que o TOM emite pro backend executar. **Uso = quanto o time pede; falha = quanto o TOM não conseguiu entregar.**

| Ação (marker) | Uso | Rejeitado | % falha | Leitura |
|---|---:|---:|---:|---|
| **TASK_UPDATE** | 411 | 58 | **14,1%** | O mais usado do sistema **e** um dos que mais falha → **prioridade 1** |
| REACT | 107 | 0 | 0% | saudável |
| **COORDINATION_REQUEST** | 99 | 11 | **11,1%** | recados entre pessoas; falha por schema |
| FINANCE_ACTION | 79 | 1 | 1,3% | **o mais confiável** (apesar de ser a área com mais bugs históricos) |
| EVENT_UPDATE | 58 | 4 | 6,9% | |
| **EVENT_CREATE** | 48 | 8 | **16,7%** | **pior taxa** entre os usados |
| TASK_DELEGATED | 48 | 0 | 0% | saudável |
| **ACTIONABLE_NO_MARKER** | 30 | — | — | **o TOM devia ter agido e não emitiu ação nenhuma** |
| HABIT_ACTION | 19 | 3 | 15,8% | pouco uso, falha alta |
| UNKNOWN_MARKER_STRIPPED | 9 | — | — | o LLM inventou uma ação que não existe |

### 1.1 Por que o TASK_UPDATE falha (é o que mais dói)

Os motivos de rejeição, contados:

| Motivo | Vezes | O que significa de verdade |
|---|---:|---|
| **`all_failed:N`** | **36** | O TOM emitiu a ação com N alvos e **todos falharam** — não é formato, é **não conseguir identificar de qual tarefa a pessoa está falando** |
| `schema_invalid` | 21 (todos markers) | O LLM emitiu num formato que o parser recusa → **divergência entre o que a skill ensina e o que o código aceita** |
| `integrity_dup_task` | ~8 | Guard anti-duplicata barrou ("Lançar no Superfolha", "Separar cheques do dia 5"…) — pode ser proteção legítima ou falso-positivo |
| `integrity_temporal_soft` | 3 (EVENT_CREATE) | Guard de data barrou a criação |

**Conclusão da fatia de dados:** o gargalo do TASK_UPDATE **não é o formato do marker — é a RESOLUÇÃO DE ALVO** ("qual tarefa?"). Isso é reforçado pelo `integrity_dup_task`: o sistema encontra candidatos demais ou de menos. Refatorar o parser não resolve; resolver **identidade de tarefa** resolve.

### 1.2 O "confirmei e não aconteceu"

Entre os `ACTIONABLE_NO_MARKER` (TOM devia agir e não agiu), os textos que mais aparecem são **respostas curtas de confirmação** — literalmente `"Isso"` e mensagens do tipo *"[O usuário está RESPONDENDO a esta mensagem anterior: …]"*.

Ou seja: **a pessoa confirma e nada acontece.** É a mesma classe dos known-issues `TASK-RESCHEDULE-CONFIRM-NOOP` e `EVENT-CREATE-CONFIRM-NOOP`, que seguem abertos aguardando prova viva. **Agora há prova viva: 30 ocorrências em 30 dias.**

---

## 2. Onde o sistema quebra de forma reincidente

391 known-issues registrados. Agrupados por família, com **em quantas semanas distintas** a família voltou a quebrar (reincidência = raiz não resolvida):

| Família | Bugs | Semanas com quebra | Último |
|---|---:|---:|---|
| **FIN** (financeiro) | **57** | **7** (praticamente toda semana) | 21/07 |
| **GROUPCHAT** | **30** | 5 | 14/07 |
| COORD (coordenação/recados) | 11 | 5 | 14/07 |
| RECUR (recorrência) | 9 | 5 | 09/07 |
| EVENT · AUDIT · GROUPREPORT · TASK · HABIT | 4–14 | 4 cada | julho |

**Cruzando com o uso (seção 1), aparece um padrão que contraria a intuição:**
- **FINANCE_ACTION é o marker mais confiável (1,3% de falha) apesar de FIN ter 57 bugs.** Motivo provável: o financeiro foi o único domínio que ganhou **executor determinístico** (o "sim" executa de um rascunho guardado, não devolve pro LLM decidir). Ou seja: **os 57 bugs do financeiro compraram uma arquitetura que hoje é a mais sólida do sistema.**
- **TASK_UPDATE tem 10× o uso do HABIT_ACTION e taxa de falha parecida** — mas o impacto é 20× maior. Prioridade se mede por `uso × falha`, não por falha isolada.

---

## 3. O tamanho do problema (por que consertar dói)

| Arquivo | Linhas | Papel |
|---|---:|---|
| **`src/engine.js`** | **14.671** | recebe a mensagem, monta contexto, chama o LLM, faz parse das ações e persiste — **tudo num arquivo só** |
| `src/rituals/dispatcher.js` | 6.013 | todos os rituais/crons |
| `src/prompts/system.js` | 3.879 | monta o prompt |
| **`src/` inteiro** | **51.544** | |
| `skills/` (64 arquivos) | 9.395 | o que "ensina" o TOM |

> O "documento de 14 mil linhas" que o Alf mencionou **é o `engine.js`**. Não é documentação: é o coração do backend.

---

## 4. Prioridade recomendada (por `uso × falha × reincidência`)

| # | Frente | Por quê (dado) |
|---|---|---|
| **1** | **Identidade/resolução de tarefa** (`all_failed`) | ação mais usada (411), 36 falhas por não achar o alvo |
| **2** | **Confirmação que não executa** (`"Isso"` → nada) | 30 ocorrências/30d; 2 known-issues abertos sem prova até agora |
| **3** | **Divergência doc↔código** (`schema_invalid`, 21) | o LLM é ensinado a emitir o que o código recusa — barato de corrigir |
| **4** | **GROUPCHAT** (30 bugs, 5 semanas) | segunda família mais reincidente; N superfícies listando a mesma coisa |
| **5** | Recorrência (RECUR) e EVENT_CREATE (16,7%) | reincidentes, uso médio |

**Nota de método:** o financeiro (FIN) lidera em número de bugs, mas hoje é o **mais confiável em produção**. Refatorar por "quem teve mais bug no passado" levaria ao alvo errado. A régua certa é **falha viva × uso**.

---

## Partes seguintes
- **Parte 2 (fatia A):** auditoria estrutural do `engine.js` — blocos, pontos de quebra, proposta de fatiamento.
- **Parte 3 (fatia B):** auditoria de `skills/` + `soul/` — divergências doc↔código, instruções que induzem mentira, contradições.
- **Parte 4 (fatia C):** caminho da mensagem no WhatsApp — perda, duplicação, tempo/concorrência, reentrada.
- **Parte 5:** síntese e plano de correção por feature (cirúrgico, um de cada vez).

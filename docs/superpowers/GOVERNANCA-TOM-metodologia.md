# Governança do TOM — metodologia

Proposta de 08/08/2026. Objetivo do Alf: **parar de depender dele ou do Hugo para que um
problema detectado vire um problema corrigido.**

---

## 1. Auditoria da auditoria (feito em 08/08)

A ferramenta é `src/services/conversation-audit.js` (roda às 03h, acoplada ao Dream; o relatório
sai às 07h). Ela lê a conversa de 24h de cada pessoa e classifica falhas reais.

**Ela está saudável:**

| Métrica | Valor |
|---|---|
| Findings acumulados (07/06 → 07/08) | **357** |
| Cadência | roda quase todo dia (1 a 9 por dia) |
| Falsos positivos entre os triados | **3 de 127 → 2,4%** |
| `auto_triage` preenchido | 291 (81%) |
| Promovidos a KI (`promoted_code`) | 26 |

Precisão alta era a promessa do cabeçalho e a medição confirma. **Não é a detecção que falha.**

**O que falha é a fila:**

| | |
|---|---|
| Findings com status `novo`, nunca triados | **230 — 64% do total** |
| Desses, severidade **alta** | **21** |
| Mais antigo ainda `novo` | 21/07 (17 dias) |

E o conteúdo dos não-triados é exatamente a família que estamos consertando à mão:

- *"TOM afirmou que enviou o recado ao Rafinha, mas depois admitiu que não avisou ninguém"* (06/08)
- *"TOM afirmou ter criado a visita e, na mesma resposta, disse que não conseguiu registrar"* (29/07)
- *"Usuário pediu repetidamente para lançar a fatura… TOM não resolveu"* (21/07)

**A auditoria já vinha apontando o problema da Rose semanas antes de ela reclamar.** O sinal
existia; ninguém trabalhou a fila. É esse o gargalo — não falta instrumento, falta ciclo.

---

## 2. Sobre a migração de coluna

O schema de `tom_audit_findings` já tem quase tudo:
`status`, `occurrences`, `signature` (dedupe), `promoted_code` (liga ao `tom_known_issues`),
`auto_triage`, `incident_at`, `incident_confidence`, `first_seen`, `last_seen`.

A **resolução** já mora no lugar certo: `promoted_code` aponta para `tom_known_issues.fix_resumo`.
Duplicar o texto do fix aqui criaria duas verdades.

**Falta pouco, e é o passo 4 do ciclo (a reverificação):**

| Coluna | Para quê |
|---|---|
| `verified_at` (timestamptz) | quando o fix foi reconferido em produção |
| `verified_result` (text) | `confirmado` \| `reincidiu` \| `inconclusivo` |

Sem isso, `status='corrigido'` é uma promessa sem recibo — e a lição que mais se repete aqui é que
**teste verde não é fix; o que vale é o dado depois**.

Vale também resolver uma ambiguidade existente: `resolvido` (62) e `corrigido` (62) são status
distintos sem diferença documentada. Escolher um.

---

## 3. O ciclo (o que eu faço sozinho)

```
1. LER      → findings novos das últimas 24h (+ a fila represada)
2. INVESTIGAR → conversa real no log, banco, código. Achar a RAIZ, não o sintoma
3. DECIDIR  → falso positivo / já conhecido / bug novo / decisão de negócio
4. AGIR     → TDD, prova de reversão, deploy, KI registrado, finding triado
5. REVERIFICAR → dias depois, no dado de produção: sumiu ou reincidiu?
```

O passo **5 é o que não existe hoje** e é o que separa governança de relatório.

### Níveis de autonomia

| Ação | Autonomia |
|---|---|
| Triar, classificar, deduplicar, documentar | **total** |
| Investigar log/banco/código, achar raiz | **total** |
| Corrigir com TDD + prova de reversão + zero-regressão | **total**, com relato depois |
| Corrigir sob flag desligada e ligar após medir | **total** |
| Reverificar e reabrir finding | **total** |
| Deletar dado de produção | **pede sempre** |
| Mudar voz/tom/tamanho da fala do TOM | **pede sempre** (é veto do Alf) |
| Mudar regra de negócio ou UI | **pede sempre** |
| Feature nova | **diz não** (freeze) |

O critério: **reversível e provável → faço. Irreversível ou questão de gosto/negócio → pergunto.**

---

## 4. Onde isso roda (o ponto honesto)

Hoje eu só existo quando o Alf abre uma sessão nesta máquina. Um cron na VPS **não me invoca** —
ele roda script. Então "governança feita por mim" precisa de um mecanismo, e as opções são:

**(a) Cron chamando Claude Code headless** (`claude -p`) numa máquina com acesso ao repo e à VPS.
É o que dá autonomia real. Custo: uma sessão de agente por execução; risco de agente autônomo
tocando produção sem ninguém olhando.

**(b) Cron burro + sessão minha** — o cron só junta as evidências e deixa um relatório pronto
(fila de findings novos, logs relevantes, diffs suspeitos). Quando o Alf abre uma sessão, o
trabalho de garimpo já está feito e eu ataco a correção. Sem autonomia total, mas sem risco novo.

**(c) Híbrido, e é o que eu recomendo:** o cron (b) roda diário e é burro; o (a) roda **semanal**,
com escopo restrito — triagem, investigação e *proposta* de fix em branch, nunca deploy direto.
O deploy continua passando por uma sessão com o Alf até a gente confiar no ciclo.

Começar por (b) tem uma vantagem prática: ele é útil no primeiro dia e não depende de decidir
nada sobre agente autônomo.

---

## 5. Primeiros passos concretos

1. **Migration**: `verified_at` + `verified_result` em `tom_audit_findings`. Padronizar
   `resolvido`/`corrigido` em um só.
2. **Cron de paridade git ↔ produção** (o buraco de 5 dias que ninguém viu).
3. **Atacar a fila represada**: 21 findings `alto` sem triagem — vários são a mesma raiz que já
   consertamos hoje, então boa parte deve fechar como `resolvido` com `promoted_code`.
4. **Relatório das 07h ganha uma segunda seção**: não só "o que houve", mas *"o que foi feito e o
   que reincidiu"*. É a pergunta que o Alf faz e que hoje não tem resposta.

Ordem sugerida: **3 → 1 → 4 → 2**. Atacar a fila primeiro dá o retrato real de quantos findings
sobrevivem a uma triagem honesta — e esse número é que dimensiona o resto.


---

## 6. Primeira rodada do ciclo — executada em 08/08

### O número que ninguém tinha: o trabalho ESTÁ funcionando

Findings por semana, por categoria:

```
semana      confab  dropped  frustr  refusal   TOTAL
2026-06-07     33      25      20        4       86
2026-06-14      8      27      17        4       57
2026-06-21     10      17      10        1       41
2026-06-28      5      15       9        2       33
2026-07-05      2      20       9        0       33
2026-07-12      7      25       7        2       42
2026-07-19      1      13       5        1       21
2026-07-26      3      11       2        1       19
2026-08-02      5      11       6        0       25
```

- **Total: −71%** (86 → 25 por semana)
- **Confabulação: −85%** (33 → 5) — era a dor #1, deixou de ser
- **Frustração: −70%** (20 → 6)
- **`dropped_request`: −56%** — o mais teimoso, e agora **a categoria dominante** (11 de 25)

**O próximo alvo mudou: é "pedido largado", não mais confabulação.**

### Migration aplicada
`tom_audit_findings` ganhou `verified_at`, `verified_result`
(`confirmado`|`reincidiu`|`inconclusivo`, com CHECK) e `verified_note` (o critério, para poder
ser contestado). A resolução continua morando em `tom_known_issues.fix_resumo` via
`promoted_code` — não duplicada.

### Triagem dos 21 `alto`

| resultado | n | critério |
|---|---|---|
| `resolvido` + `confirmado` | **5** | confabulação anterior a 09/07; categoria caiu 85% e a assinatura não reincidiu em 30+ dias. Várias evidências mostram o chokepoint de honestidade já agindo (*"Sendo sincero: eu ainda NÃO avisei ninguém"*) |
| segue `novo` + `inconclusivo` | **16** | olhados, **não** fechados. Fechar `dropped_request` agora seria falso-verde |

Estado da tabela: `21 reverificados` · `5 confirmados` · `16 inconclusivos` · **`209 nunca olhados`**
(os `medio`/`baixo`).

### O que falta nesta frente
1. Os **16 inconclusivos** precisam de investigação individual — vários são financeiro/Rose e
   provavelmente já têm KI correspondente.
2. Os **209 médio/baixo** nunca olhados.
3. Segunda seção no relatório das 07h: *"o que foi feito e o que reincidiu"*.
4. **Dreams** (o "sonho", 03h) ainda não foi auditado — o Alf sinalizou que tem bastante coisa lá.


### 2ª passada nos 16 — o teste de REINCIDÊNCIA

Critério: houve finding posterior da mesma categoria **para a mesma pessoa**? (grosseiro, mas
objetivo e contestável — está gravado em `verified_note`).

| destino | n | regra |
|---|---|---|
| `resolvido` + `confirmado` | **2** | zero reincidência há mais de 20 dias |
| segue `novo` + **`reincidiu`** | **10** | voltou a acontecer → problema **VIVO** |
| segue `novo` + `inconclusivo` | **4** | zero reincidência, mas <20 dias — cedo para afirmar |

**Placar da fila `alto`: 21 → 7 fechados, 10 vivos, 4 aguardando maturidade.**

### Onde a dor viva se concentra

Os **10 vivos são TODOS `dropped_request`**:

| pessoa | n | mais recente |
|---|---|---|
| **Rose** | **6** | 21/07 |
| Ana | 2 | 29/07 |
| Leo | 1 | 19/06 |
| Matheus | 1 | 15/07 |

**O alvo seguinte é "pedido largado", e ele mora no financeiro da Rose.** Os 6 dela são a mesma
história: lançar fatura no cartão errado, lançar sem prévia, lançar depois de "não lança",
apagar a compra errada. Há KIs de financeiro registrados — o próximo passo é cruzar um a um e
descobrir se são KI já corrigido que reincidiu, ou raiz que nunca foi atacada.


### 3ª passada — o financeiro da Rose estava MORTO, não vivo

A 2ª passada apontou "Rose/financeiro" como a dor viva. **Estava errado, e o erro era do meu
critério** (qualquer `dropped_request` da mesma pessoa contava como reincidência, juntando
assuntos diferentes).

Refeito com `incident_at` (quando aconteceu) em vez de `created_at` (quando a auditoria rodou) —
distinção que a casa já tinha aprendido a duras penas:

| incidente | fix correspondente | data do fix |
|---|---|---|
| 22/06 (2×) | `FIN-INSTALLMENTS-LEAK-LIST` | 23/06 |
| 12/07 | `FIN-LAUNCH-CONFIRM-NEGATION-IGNORED` | 12/07 |
| 16/07 | `FIN-INVOICE-CARD-GUESSED-AT-INTENT-OPEN` | 16/07 |
| 17/07 | `FIN-INVOICE-PREVIEW-PROMISED-BUT-COMMITTED` | 17/07 |
| 21/07 | `FIN-PDF-OWNER-ONLY-FALSE-PASSWORD` | 21/07 |

Cada incidente tem fix no mesmo dia ou no seguinte, e **nenhum caso novo da família (cartão
errado / sem prévia / contra "não lança") depois de 21/07 — 18 dias limpos.** Os 6 foram
fechados com `promoted_code` apontando o KI.

**Placar final da fila `alto`: 21 → 13 fechados · 4 vivos · 4 aguardando maturidade.**

Os 4 vivos restantes: Ana (2), Leo (1), Matheus (1) — todos `dropped_request`, nenhum financeiro.

### Lição de método (vale para o agente de governança)

O critério de reincidência por `categoria + pessoa` **infla os vivos**. Serve como primeiro
filtro barato, mas **não pode fechar nem manter aberto sozinho**: só depois de cruzar
`incident_at` com `corrigido_em` do KI a conclusão vira confiável. Um agente autônomo que parasse
na 2ª passada teria reaberto uma frente já morta e gasto o dia nela.

# Escalonamento temporal da governança — escada por dias de atraso

**Data:** 2026-07-18
**Validado com:** Alf (CEO) — 3 decisões estruturais fechadas em brainstorm
**Status:** spec → revisão do Alf → plano
**Depende de:** card-por-líder (`GOVDIGEST-SCORECARD-EXECUTOR`, no ar 17/07) — esta feature é a camada de *quando* sobre o *como* daquele.

---

## 1. O problema

O card-por-líder consertou o **eixo** (quem cobra quem). Mas o *quando* ficou acidental: o Alf recebeu tarefas de **1 dia** de atraso no digest dele (18/07). Palavras dele: *"se eu mandar pro líder com 1 dia de atraso, ele fala 'a pessoa faz hoje'. Escalar cedo demais queima a cobrança."*

A causa é uma linha (`dispatcher.js:2734`):
```js
return days >= 6 || !cobradas24h.has(t.id);
```
O `|| !cobradas24h` deixa **qualquer** tarefa ainda-não-cobrada vazar pro digest, independente da idade. A tarefa do Peterson venceu ontem, a cobrança individual ainda não tinha rodado → vazou com 1 dia pro colo do CEO.

## 2. A ideia — mesmo princípio, dimensão do tempo

Cada nível só recebe quando o atraso vira problema **dele**. É o "não-acionável = ruído" do card-por-líder, agora no tempo:

| Atraso (dias úteis) | TOM cobra a pessoa? | Digest do líder (14h) | Digest do CEO (9h) |
|---|---|---|---|
| **1–2** | ✅ insiste todo dia | — | — |
| **3–5** | ✅ continua | ✅ aparece | — |
| **6+** | — (vira humano, §5) | ✅ **continua** (aditivo) | ✅ escala |

## 3. Decisões do Alf (fechadas em brainstorm 18/07)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Como o nível fica sabendo | **Pela visibilidade do digest que já existe.** Não há ping ativo novo pro líder/CEO — a tarefa passa a aparecer no digest deles quando cruza o degrau. A cobrança *ativa* (WhatsApp) é só pra pessoa, e já existe. |
| 2 | Contagem de dias | **Dias úteis pulando domingo.** Sábado CONTA (a LA dá aula sábado); domingo não. Tarefa que vence sexta: sáb=1, seg=2, ter=3 → escala pro líder na terça. |
| 3 | No topo (6+ dias) | **Aditivo.** O líder CONTINUA vendo quando escala pro CEO — cada degrau soma quem olha, não transfere. Ninguém lava as mãos. |
| 4 | Limiares | **3 e 6 dias úteis.** `>= 3` entra no líder; `>= 6` entra no CEO. |
| 5 | O que zera o relógio | **A data de vencimento é a âncora.** Reseta só quando a tarefa é **feita** (sai da query) ou o **prazo é remarcado** (nova `due_date` → recomeça). **Cobrar não reseta. Prometer não reseta.** |
| 6 | Número exibido no card | **Dias corridos** (`— 7d`, intuitivo). A escada corre por dias úteis nos bastidores. Exibição e gate são propositalmente desacoplados. |

## 4. O que JÁ existe (investigado no código — a spec não inventa API)

- **`checkOverdueAlerts` (dispatcher.js:2915)** cobra a pessoa individualmente, **só de 1 a 5 dias** (`due_date >= hoje-5`). Após 5 dias, sai do alerta individual "pra prevenir loop de cobrança que vira ruído" (comentário 4911). **Isto já é a fronteira da escada** — a cobrança automática cobre exatamente 1–5, e aos 6 vira humano. Só não estava amarrado como escada explícita. **Não muda nesta feature.**
- **O filtro compartilhado (dispatcher.js:2734)** decide o que sobe. É usado pelos DOIS digests: CEO (`ceoTeamUnclosedTasksReport` sem `leaderId`, chamado em :3084) e líder (com `leaderId`, chamado em :3187). `opts.leaderId` distingue os dois.
- **A exibição** dos dias no card vem de `leader-cards.js → daysBetweenYmd` (corrido) — **NÃO** do filtro. Já é uma função separada. Mudar o gate não toca na exibição → zero-regressão no card.
- **`daysBetweenYmd` / `daysOverdue`** são cálculos de **dias corridos**. Nenhum util de **dias úteis** existe hoje (`dates.js` só tem tabelas de weekday). Precisa ser criado.
- **`perLeaderUnclosedTasksReport` (dispatcher.js:2886)** é **código MORTO** (só em comentários + `module.exports`, zero chamadas — substituída por `sendLeaderGovernanceDigest`). A escada NÃO vai até ela. Fica como dívida técnica separada.

## 5. Por que a cobrança da pessoa para aos 6 (e está certo)

Aos 6+ dias o TOM já cutucou a pessoa por 5 dias sem efeito. Repetir cutão do robô é a definição de ruído — e é a lição do `escalation-tracker` órfão (*"repetir não escala; escala mudar de tática"*). Aos 6+, a pressão é **humana**: o CEO cobra o líder, o líder cobra a pessoa. Somar o robô a isso seria cutão triplo. A fronteira "para aos 5" que já existe no código **é** o desenho certo.

## 6. Arquitetura

**Uma função pura nova + uma linha de filtro trocada.** Nada mais.

```
src/utils/dates.js  (lar dos cálculos de data; teste em src/utils/dates.test.js)
  businessDaysOverdue(dueYmd, todayYmd) → int          ← PURA, TDD
      dias ÚTEIS decorridos após o vencimento (domingo não conta).
      0 se today <= due (não atrasada).

src/rituals/dispatcher.js:2734  (o filtro compartilhado)
  ANTES:  return days >= 6 || !cobradas24h.has(t.id);
  DEPOIS: const biz = businessDaysOverdue(t.due_date, sp.ymd);
          const limiar = opts.leaderId ? 3 : 6;
          return biz >= limiar;
```

O `cobradas24h` e a query dos `notifications` que o alimentavam **saem** (o filtro deixa de depender de "foi cobrada"). Conferir se `cobradas24h`/`hiddenCount` são usados em outro lugar da função antes de remover.

**Reset (decisão 5):** nenhum código novo. Tudo lê `due_date` e `status`. Feita → `status != pending` → fora da query. Remarcada → nova `due_date` → `businessDaysOverdue` recalcula. Automático.

## 7. `businessDaysOverdue` — semântica exata

```
Atraso = nº de dias úteis (dom excluído) DESDE o vencimento até hoje.
- today <= due            → 0 (não atrasada)
- vence sex, hoje sáb     → 1  (sábado conta)
- vence sex, hoje dom     → 1  (domingo não conta — continua 1)
- vence sex, hoje seg     → 2
- vence sex, hoje ter     → 3  (entra no líder)
- vence qua, hoje qua+7   → conta os 7 corridos menos o(s) domingo(s) no meio
```
Fórmula: `diasCorridos(due→today) − nºDomingos no intervalo (due, today]`. Weekday de um YMD via `Date.UTC(y,m-1,d).getUTCDay()` (0=domingo) — determinístico, sem fuso (é data pura). **Nunca** `new Date(str)` local nem `toISOString().slice(0,10)`.

## 8. Zero-regressão

| Risco | Mitigação |
|---|---|
| Mudar o gate quebra o card que acabou de subir | A exibição usa `daysBetweenYmd` (corrido), intocada. O gate é outra função. Teste: card renderiza "7d" igual a hoje. |
| Fim de semana escala errado | `businessDaysOverdue` com TDD cobrindo os casos da §7 (sex→sáb→dom→seg→ter). |
| O digest do líder é o MESMO report do CEO | O `opts.leaderId` já distingue (:3187 passa, :3084 não). Teste: mesma tarefa, limiar 3 (líder) vs 6 (CEO). |
| Remover `cobradas24h` quebra algo | Grep de `cobradas24h`/`hiddenCount`/`notified` na função antes de remover; se usado no texto/log, preservar só o que resta vivo. |
| Tarefa 1–2 dias que a cobrança individual NUNCA pegou (bug, sem telefone) fica invisível até dia 6 | Aceito: a faixa 1–2 é responsabilidade de `checkOverdueAlerts`. Se ela falha, é problema dela, não do digest. (Candidato a health-check futuro — fora de escopo.) |
| `perLeaderUnclosedTasksReport` morto ainda no `module.exports` | Fora de escopo. Dívida separada. Não tocar nesta feature. |
| Deploy reverte produção | `.deploy-hold` antes de tocar `src/`; deploy cirúrgico; md5 VPS==local antes do restart. |

**Migration:** nenhuma. Tudo lê campos que já existem (`due_date`, `status`).

## 9. Testes (TDD)

`src/utils/business-days.test.js` (`node --test`):
1. `today <= due` → 0.
2. Vence sex: sáb→1, dom→1, seg→2, ter→3, qua→4.
3. Intervalo com 2 domingos (2 semanas) → corridos − 2.
4. **Vence sábado, hoje domingo → 0** (cravado): conta dias ÚTEIS *decorridos após* o vencimento; o único dia decorrido é domingo, que não é útil. Na segunda vira 1. Assimetria proposital e coerente: "sáb após sexta = 1 útil" mas "dom após sáb = 0 úteis".
5. Determinismo: independe de fuso (mesma saída rodando "à noite"). Weekday por `Date.UTC` sobre componentes.

Gate no dispatcher: não roda local (importa banco). Cobertura = `node --check` + **dry-run na VPS** comparando o digest do CEO (só 6+) e o do líder (3+) com o dado real. **Prova viva:** amanhã o teu digest não tem mais nenhuma tarefa com menos de 6 dias úteis.

## 10. Fora de escopo (YAGNI)

- Feriados (a escada corre em feriado; tratar exigiria calendário — YAGNI até doer).
- Ping ativo pro líder/CEO no cruzamento (decisão 1 recusou).
- Detectar "empurra com a barriga" (reschedule repetido pra fugir da escada) — o card já mostra `cobrada 3x`.
- Limpar `perLeaderUnclosedTasksReport` morto e o 2º `daysOverdue` duplicado — dívida separada.
- Mudar a cobrança individual da pessoa (`checkOverdueAlerts`) — já é a fronteira certa.

# Digest Financeiro Matinal — Design

**Data:** 2026-06-08
**Autor:** Alf + Claude (brainstorming)
**Status:** aprovado (design) → pronto pra plano

## Goal

Acabar com as **mensagens picotadas de cobrança** que o TOM manda de manhã (uma por conta + fatura separada) e substituí-las por **uma única mensagem financeira consolidada**, enviada **logo após o briefing diário**, com separação semântica por urgência. O briefing (compromissos pessoal + trabalho) **não muda**.

## Problema (causa-raiz)

Hoje, de manhã, saem até 5 mensagens soltas para o mesmo colaborador:

1. **Briefing diário** (`fireRitual('daily_briefing')`, horário do usuário) — PESSOAL + TRABALHO. **Além disso, anexa uma linha "💰 Vence hoje: X"** ao final (engine.js:9352–9365 via `buildBriefingFinanceLine`).
2. **`checkFinanceBillReminders`** (08h) — faz um **loop que envia UMA mensagem por conta** vencendo em ≤2 dias (dispatcher.js:374–403). 3 contas = 3 mensagens.
3. **`checkCardDueReminders`** (08h) — ritual **separado**, 1 mensagem por fatura de cartão a vencer (dispatcher.js:486–514).

Resultado no print do Alf (08:22–08:23): Aluguel (atrasada), Internet (hoje), Conta de Luz (2 dias), Fatura Nubank (2 dias) — 4 bolhas separadas, sem ordem, **e** o briefing já tinha mostrado "vence hoje" (duplicação).

## Solução

**"Briefing intacto → digest financeiro logo depois."**

- **Briefing**: continua igual, MENOS a linha financeira anexada — ela sai (o digest assume). Briefing volta a ser 100% não-financeiro (tarefas/compromissos/hábitos). "Pagar IPVA" é tarefa → permanece no briefing.
- **Digest financeiro (novo)**: logo após o briefing ser enviado para o colaborador, **uma** mensagem consolidada no formato **Opção A** (validada em mockup pelo Alf), agrupada por urgência.
- **Aposentar** os 2 rituais fragmentados das 08h (`checkFinanceBillReminders` e `checkCardDueReminders`) — toda a cobrança passa pelo digest.

### Formato da mensagem (Opção A — validada)

```
👽 Financeiro de hoje, {Nome}
━━━━━━━━━━━━━━━━
🔴 Atrasada
   {nome} · R$ {valor}  (venceu dia {dia})
   …

🟡 Vence hoje
   {nome} · R$ {valor}
   …

🔵 Em breve
   {nome} · R$ {valor} (dia {dia})
   💳 {fatura cartão} · R$ {valor} (dia {dia})
   …
━━━━━━━━━━━━━━━━
💡 Pagou alguma? Me diz "paguei {exemplo}" ou
   "paguei a fatura do {cartão}" que eu baixo aqui.
```

Regras de formato:
- Só renderiza os blocos (🔴/🟡/🔵) que **têm** itens. Sem itens num bloco → bloco omitido.
- 💳 marca itens que são **fatura de cartão** (ficam no bloco de urgência correspondente: hoje ou em breve).
- **Cabeçalho do bloco genérico** ("Em breve"), e **cada item "em breve" mostra seu próprio dia** `(dia X)` — robusto quando há dias diferentes no mesmo bloco (o mockup mostrou "dia 10" só porque os itens coincidiam). Atrasada mostra `(venceu dia X)`; Vence hoje não precisa de dia.
- Rodapé: linha única consolidando as ações de baixa ("paguei X"). Cita 1 exemplo de conta + 1 de fatura (se houver fatura).
- **Sem total** (decisão do Alf — manter limpo).

## Componentes

| Arquivo | Responsabilidade | Mudança |
|---|---|---|
| `src/finance/finance-digest.js` (novo) | `buildFinanceDigest({ nome, atrasadas, hoje, emBreve })` — builder PURO, formato Opção A. Sem I/O. | criar |
| `src/finance/finance-digest.test.js` (novo) | TDD do builder | criar |
| `src/services/financeiro-service.js` | `dueItemsForDigest(cid, { hojeYmd })` — junta numa chamada: contas atrasadas + hoje + em ≤2 dias + faturas de cartão a vencer (≤2 dias, não pagas), já classificadas por urgência (`atrasadas`/`hoje`/`emBreve`) e com flag `isCard`. | adicionar |
| `src/rituals/dispatcher.js` | `sendFinanceDigest(collab, now)` — chama `dueItemsForDigest`, monta 1 msg, envia com **claim atômico** + **quiet gate** (personal). Engatar logo após `fireRitual(c,'daily_briefing')` (linha ~3063). **Remover** `checkFinanceBillReminders` e `checkCardDueReminders` das chamadas do tick. | editar |
| `src/engine.js` | Remover a injeção de `buildBriefingFinanceLine` no briefing (linhas 9352–9365) — briefing deixa de listar contas. | editar |
| `src/finance/ritual-messages.js` | `buildBillReminder` e `buildBriefingFinanceLine` ficam órfãos do fluxo matinal. Manter por ora (outros usos/testes) mas não chamados no digest. | sem mudança funcional |

## Fluxo de dados

```
tick (horário de briefing do colaborador)
  → fireRitual(c, 'daily_briefing')   [briefing LLM, PESSOAL+TRABALHO, SEM finance line]
  → sendFinanceDigest(c, now):
       quiet? → skip (logRitualEvent)
       claim atômico 'financeiro_digest' (1/dia) → se perdeu, skip
       items = dueItemsForDigest(c.id, hoje)
       items vazio → NÃO envia (sem msg)
       msg = buildFinanceDigest({ nome, ...items })
       whatsapp.sendMessage(c.phone, msg)
```

Número/valor SEMPRE vêm do código (builder), nunca do LLM (lição do Bug 3).

## Regras / edge cases

- **Nada vencendo/atrasado → nenhuma mensagem** (sem "tá tudo certo").
- **Quiet hours** (personal): pula, igual aos rituais financeiros atuais.
- **Briefing pulado** (quiet) → digest também pulado (coerente; mesmo gate).
- **Idempotência**: 1 digest/dia por colaborador via `claimRitualSend(... 'financeiro_digest' ...)` + `alreadySent`. Erro transitório → rollback do claim (padrão Fatia G).
- **Sem duplicação**: briefing não lista mais contas (injeção removida).
- **Janela**: "em breve" = ≤2 dias (mantém o `DAYS_BEFORE=2` atual de contas e faturas).

## Testes

- **TDD `buildFinanceDigest`**: agrupamento por urgência; bloco vazio omitido; só atrasadas / só hoje / só em breve / mistos; 💳 cartão no bloco certo; singular/plural de dias; rodapé com exemplos corretos; entrada totalmente vazia → string vazia (sinaliza "não enviar").
- **`dueItemsForDigest`**: classificação correta (atrasada vs hoje vs em breve), inclusão de fatura de cartão, exclusão de fatura paga, `.eq('collaborator_id', cid)` sempre.
- **Smoke do dispatcher**: `node src/rituals/dispatcher.js --force=briefing_...` (ou gatilho dedicado) num colaborador de teste com contas → confirmar briefing SEM finance line + 1 digest logo depois. "Ver se tá vindo" de verdade (pedido do Alf).

## Fora de escopo (YAGNI)

- Não mexer no conteúdo/estrutura do briefing (só remover a finance line anexada).
- Não adicionar total na Opção A.
- Não tocar nos rituais financeiros mensais (`checkFinanceMonthly`, `checkFinanceReport`) nem no alerta de limite de cartão.
- Não criar nova preferência de horário (digest segue o horário do briefing).

# Design — Cartão de Crédito + Linguagem de Mensagens do TOM (Finanças Pessoais)

> **Origem:** pedido do Alf (Luciano) — trazer controle de cartão de crédito pro módulo de finanças pessoais (`pf_*`), com alertas proativos de limite via WhatsApp, e adotar a linguagem semântica/hierárquica de mensagens inspirada no app "Personal Finance / Ana Clara" (sistema próprio do Alf, já desenvolvido).
> **Status:** design **aprovado visualmente** pelo Alf em 2026-05-30 via Visual Companion (lista, detalhe, modal de lançamento, mensagens do TOM). Falta revisão da spec escrita → writing-plans.
> **Chat:** advisor (este) escreve a spec; execução vai pro chat de finanças.

---

## 1. Problema (na voz do usuário)

*"O app de finanças não tem cartão de crédito. As pessoas têm vários cartões (Itaú, Nubank…), com limites, fechamento, vencimento. Preciso lançar 'gastei tanto no cartão X', ver quanto falta de limite, e o TOM tem que avisar proativamente quando eu chego em 50/70/80/90% do limite. Tem que diferenciar cartão de PIX, débito e transferência entre contas. É controle e organização — sem virar nada muito complexo."*

---

## 2. Estado atual do módulo (auditoria 2026-05-30)

Tudo prefixado `pf_`. TOM escreve via **service_role** (`src/services/financeiro-service.js`) — RLS não vale nesse caminho; `collaborator_id` é sempre o 1º parâmetro e filtra toda query.

| Tabela | Papel | Campos-chave |
|---|---|---|
| `pf_accounts` | Carteiras | `type` CHECK ∈ {checking,savings,wallet,investment}, `balance`, `goal_monthly`, `icon`, `is_active` |
| `pf_transactions` | Lançamentos | `account_id`→`pf_accounts` (SET NULL), `type` ∈ {income,expense}, `category` (CHECK 10 valores), `amount>0`, `transaction_date`, `via` |
| `pf_bills` | Contas fixas | `due_day` 1-31, `category`, `status` ∈ {pending,paid,overdue}, `last_paid_at`, `remind_days_before` |
| `pf_budgets` | Orçamento | `category`, `monthly_limit`, `month_year`, UNIQUE(collab,category,month_year) |
| `pf_goals` | Metas | `target_amount`, `current_amount`, `deadline` |

`category` CHECK atual: `salario, comissao, extra, moradia, alimentacao, transporte, saude, educacao, lazer, outros`.

**Padrões existentes a reaproveitar:**
- `src/rituals/dispatcher.js` já dispara **lembrete de conta a vencer** (`billsDueWithin`, `collaboratorsWithActiveBills`) → molde pronto pra "cron → alerta no WhatsApp".
- `monthBounds()` (mês corrente UTC) em `financeiro-service.js`.
- Silêncio diário por contexto já existe (`quiet-hours.js`) — alertas de cartão devem respeitar.
- PWA: `web/src/screens/financeiro/{FinanceiroPage,CarteirasPage,ContasFixasPage,TransacoesPage}.tsx`, `web/src/lib/financeiro.ts`, `web/src/hooks/useRealtimeFinance.ts`.

**Choque arquitetural (por que cartão ≠ `pf_account`):** `type` CHECK não aceita cartão; saldo de cartão é dívida (não ativo); fatura é dinâmica (soma do ciclo, ≠ valor fixo de `pf_bills`); compra de cartão tem categoria normal + um meio de pagamento (o cartão).

---

## 3. Escopo

### 3.1 Dentro (v1)
- Cadastro de cartões (nome, bandeira, cor, limite, dia de fechamento, dia de vencimento).
- Lançar compra no cartão (à vista ou **parcelada** em N×) via PWA e via TOM.
- Fatura **derivada** por competência; tela de detalhe do cartão com a fatura aberta.
- "Pagar fatura" → debita uma carteira escolhida (sem virar nova despesa).
- Lançamento **Única** (conta avulsa com vencimento) e **Recorrente** (= conta fixa atual).
- TOM: registrar compra, perguntar meio de pagamento quando ambíguo, consultar fatura/limite, alertas proativos de limite (50/70/80/90%), lembrete de vencimento da fatura.
- **Linguagem de mensagens do TOM** padronizada (hierárquica/semântica) — ver §7.

### 3.2 Fora (v1) — mapeado pra roadmap, NÃO construir agora
Decisões confirmadas com o Alf: o "Personal Finance / Ana Clara" é um app completo (Open Finance, proativo). Trazemos a **linguagem**, não o conjunto de features. Ficam pra fases futuras:
- Projeção de saldo, comparativo vs ontem/mês.
- Checkup com triagem de severidade (S1/S2/S3).
- Análise "essenciais vs estilo de vida".
- Posição agregada (saldo + limite total disponível) como visão única.
- Integração Open Finance / extrato automático.
- **Mês de competência manual** e **centro de custo / item de despesa** (decisão explícita: ficam de fora — competência do cartão é calculada automaticamente; categoria flat basta).
- Decremento de valor já lançado / estorno parcial.

---

## 4. Modelo de dados (migrations)

### 4.1 Nova tabela `pf_cards`
Cartão é entidade própria (decisão: **não** virar `type` em `pf_accounts`, pra não sujar o trigger de saldo nem o CHECK existente).

```sql
create table pf_cards (
  id              uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references collaborators(id) on delete cascade,
  name            text not null,                 -- "Nubank", "Itaú Platinum"
  brand           text,                          -- 'visa'|'master'|'elo'|'amex'|'hiper'|null (p/ ícone)
  color           text,                          -- hex p/ gradiente de identidade (ex '#820ad1')
  credit_limit    numeric not null check (credit_limit > 0),
  closing_day     int not null check (closing_day between 1 and 31),
  due_day         int not null check (due_day between 1 and 31),
  icon            text default '💳',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

### 4.2 Extensão de `pf_transactions`
Uma transação é paga por **uma** carteira (`account_id`, comportamento atual) **ou** por um cartão (`card_id`). Quando `card_id` está preenchido, a transação NÃO mexe em `pf_accounts.balance` (o dinheiro só sai no pagamento da fatura).

```sql
alter table pf_transactions
  add column card_id            uuid references pf_cards(id) on delete set null,
  add column installment_no     int,            -- 1..total ; null = à vista
  add column installments_total int,            -- N ; null = à vista
  add column purchase_group     uuid,           -- agrupa as N parcelas de uma compra
  add column competencia        date;           -- 1º dia do mês da fatura (YYYY-MM-01); null p/ não-cartão
```

> ⚠️ **Verificar no código (exec):** como `pf_accounts.balance` é mantido hoje — trigger no banco ou lógica no service? Garantir que transações com `card_id` preenchido **não** alterem `balance`. Se houver trigger, condicionar a `card_id is null`.

### 4.3 Pagamento de fatura `pf_card_payments`
Pagar a fatura é **transferência** (carteira → cartão), não despesa nova — senão conta 2× (a compra já foi despesa na categoria dela no mês da competência).

```sql
create table pf_card_payments (
  id               uuid primary key default gen_random_uuid(),
  collaborator_id  uuid not null references collaborators(id) on delete cascade,
  card_id          uuid not null references pf_cards(id) on delete cascade,
  paid_from_account uuid references pf_accounts(id) on delete set null,
  competencia      date not null,               -- fatura paga (YYYY-MM-01)
  amount           numeric not null check (amount > 0),
  paid_at          date not null default current_date,
  created_at       timestamptz not null default now()
);
```
Efeito no saldo: o pagamento **decrementa** `balance` da `paid_from_account` (mesma mecânica de uma saída), mas SEM linha de despesa em `pf_transactions`. Implementar no service (espelhar como uma saída ajusta saldo hoje).

### 4.4 Idempotência dos alertas de limite
Coluna de controle no próprio cartão, resetada a cada ciclo de fatura:

```sql
alter table pf_cards
  add column alert_cycle      date,   -- competência do ciclo do último alerta (YYYY-MM-01)
  add column alert_threshold  int default 0;  -- maior faixa já alertada neste ciclo (0,50,70,80,90)
```
Regra: ao cruzar uma faixa maior que `alert_threshold` no ciclo atual, dispara e atualiza `alert_threshold`. Ao trocar de ciclo (`alert_cycle` != competência corrente), zera (`alert_threshold=0`, `alert_cycle=competência`).

### 4.5 RLS
Owner-only nas novas tabelas (filtro por `collaborator_id = current_collab_id()`), espelhando as `pf_*` existentes. No caminho service_role (TOM), `collaborator_id` continua vindo do remetente resolvido — **nunca** de marker do LLM.

### 4.6 Realtime
Adicionar `pf_cards` e `pf_card_payments` à publication `supabase_realtime` e assinar no `useRealtimeFinance.ts` (senão PWA não atualiza ao vivo quando o TOM lança via WhatsApp).

---

## 5. Lógica de fatura (derivada) e parcelas

### 5.1 Competência de uma compra (qual fatura)
Dado `transaction_date` e `closing_day` do cartão:
- Se `dia(transaction_date) <= closing_day` → a compra entra na fatura que **fecha neste mês** → `competencia = primeiro dia do mês de transaction_date`.
- Se `dia(transaction_date) > closing_day` → entra na **próxima** fatura → `competencia = primeiro dia do mês seguinte`.

> Edge: fechamento dia 30/31 em meses curtos — clampar ao último dia do mês. Documentar; usar cálculo de "hoje" em America/Sao_Paulo (`todaySP`/equivalente), nunca `new Date().toISOString()` cru.

### 5.2 Parcelada
Compra de `R$ T` em `N×`: cria **N linhas** em `pf_transactions`, todas com o mesmo `purchase_group` (uuid), `installments_total = N`, `installment_no = 1..N`, `amount = round(T/N)` (ajustar centavos residuais na 1ª ou última parcela), categoria/descrição repetidas, e `competencia` de cada parcela = competência da 1ª + (i-1) meses. `transaction_date` da parcela i pode ser a data da compra (a competência é quem decide a fatura). Descrição exibida: `"Smart TV (2/10)"`.

### 5.3 Fatura derivada
`fatura(card, mês M)` = soma de `pf_transactions` com `card_id = card.id` e `competencia = M`. Itens da fatura = essas transações. Pago? Existe `pf_card_payments` com `card_id` + `competencia = M`.

### 5.4 Limite usado / disponível
**Decisão do Alf:** `usado = soma de TODAS as competências não pagas` (fatura corrente + parcelas futuras já lançadas), pois parcelas futuras já comprometem o limite — é como o banco calcula. `disponivel = credit_limit - usado`. `pct = usado / credit_limit`. Uma competência conta como paga quando `soma(pf_card_payments dessa competência) >= total da competência` (ver §10, pagamento parcial).

---

## 6. PWA — telas (validadas no Companion)

DS obrigatório (CLAUDE.md): `BottomSheet`, `CustomSelect`, `DateInput`, `Button`, `Field`, etc. Mobile 375 + desktop 1440. Token `tom` (verde), nunca `brand`.

### 6.1 Lista de cartões (tile leve "B")
Na tela de Finanças, seção "Cartões": tiles densos e leves (linguagem dos StatCards). Cada tile: ícone/cor do cartão, nome, "vence dia N · fecha em Xd", fatura atual (número em destaque), chip de %, barra de limite em verde `tom`, "limite R$ / disponível R$". **Não** usar o cartão skeuomórfico na lista (peso).

### 6.2 Detalhe do cartão
Abre ao tocar no tile:
- **Topo herói:** cartão skeuomórfico (gradiente da cor/bandeira), nº mascarado, barra de limite, usado/disponível.
- Dois mini-cards: "Fecha em / Vence".
- **Fatura atual** (lista de transações com ícone de categoria, descrição, parcela `2/10`, valor, data). Tag para recorrente.
- Rodapé: total da fatura + botão **"Pagar fatura"** → escolhe carteira de origem (CustomSelect) → cria `pf_card_payments` + debita saldo.

### 6.3 Modal de lançamento (Única / Recorrente / Parcelada)
Adaptado do app do Alf, **sem** competência manual nem centro de custo. Campos comuns: Descrição, Valor, **Meio de pagamento** (CustomSelect unificado: carteiras + cartões), Categoria (as 10 atuais). Segmented control "Tipo":
- **Única:** + campo Vencimento (DateInput). Sai do saldo quando paga (vira/atualiza `pf_bills` recurrence='once' ou transação agendada — ver §8 nota).
- **Recorrente:** + dia do mês. = `pf_bills` atual (reusar fluxo de conta fixa).
- **Parcelada:** + Nº de parcelas + data da 1ª; mostra "R$ X/mês". Se meio de pagamento = cartão → §5.2.

> Guardrail desktop: criar versões `*Desktop`/`*Mobile` se a tela existir nos dois; nunca sobrescrever mobile. Testar 375 e 1440.

---

## 7. Linguagem de mensagens do TOM (semântica/hierárquica)

Adotar o **esqueleto** do Personal Finance do Alf, na voz do TOM (alien 👽, SOUL.md) — não copiar a persona "Ana Clara". Vale para TODAS as mensagens financeiras do TOM (não só cartão). Tudo em **texto puro do WhatsApp**:

- **Negrito** = `*texto*`; **itálico/dica** = `_texto_`.
- **Barra de progresso** = blocos de caractere (renderiza alinhado no WhatsApp): `[████░░░░░░] 37%` (10 segmentos; preencher `round(pct*10)`).
- **Separadores** entre seções: linha `━━━━━━━━━━━━━━━`.
- **Título** com emoji + ação ("👽 *Lançado na fatura!*").
- **Campos** com emoji-rótulo: 💰 valor, 💳 cartão, 🗂️ categoria, 📅 datas, 🧾 fatura.
- Linha **"🧾 Vai na fatura de: junho"** (competência automática — sacada do app do Alf).
- Linha **"💡 _Quer ajustar?_"** com atalhos de correção ("era 2.900" · "exclui essa").
- Bloco **"⚡ _ações rápidas_"** em itálico.

Mensagens-modelo (validadas no Companion):
1. **Compra registrada (cartão / parcelada):** título + descrição + valor (com "em N× de R$ Y" se parcelada) + cartão + categoria + "vai na fatura de" + barra de limite + disponível + "quer ajustar".
2. **Consulta de fatura:** "💜 *Nubank · fatura de junho*" + fatura atual + barra de limite + fecha/vence + ações rápidas.
3. **Alerta de limite (50/70/80/90%):** tom crescente; 90% mais forte ("segura o freio"); barra + usado/restante.
4. **Lembrete de vencimento da fatura:** X dias antes; oferece marcar como paga.

> Implementação: criar helper de formatação (ex. `src/services/finance-format.js` ou dentro do service) com `bar(pct)`, `money(v)`, e os templates. Centralizar pra reuso e consistência.

---

## 8. TOM (engine) — fluxos e markers

- **Marker financeiro existente:** o engine já tem um marker/handler de finanças (referenciado em `src/engine.js`; confirmar nome exato — provável `<<FINANCE_ACTION>>...<<END>>`) que chama `financeiro-service.js`. **Estender**, não criar paralelo.
- **Registrar compra:** detectar valor + (opcional) cartão/meio + parcelas ("comprei TV 3.200 em 10x no nubank"). Se o meio de pagamento for ambíguo, **perguntar** (fluxo "Como você pagou? 1 Cartão de crédito 2 Débito 3 PIX 4 Dinheiro" + listar carteiras/cartões do colaborador) — espelhar o padrão do app do Alf. `card_id` resolvido pelo nome do cartão do colaborador, **nunca** inventado pelo LLM.
- **Parcelas:** ação de log aceita `installments` + `card_id`; o **service** cria as N linhas e calcula competências (número/datas calculados em código, nunca pelo LLM).
- **Consulta:** "quanto tá minha fatura do nubank?", "quanto falta de limite?" → query derivada (§5).
- **Pagar fatura:** "paguei a fatura do nubank" → perguntar de qual carteira saiu → `pf_card_payments` + debitar saldo.
- **Diferenciar PIX/débito/transferência:** PIX/débito = saída normal de carteira (mexe no saldo agora); cartão = entra na fatura.
- **Transferência entre contas (decisão do Alf):** sai de uma conta e entra em outra **sem impactar o saldo total** — só decrementa o saldo da conta de **origem** e incrementa o da conta de **destino**. **NÃO** é receita nem despesa e **não** entra em relatório de gastos/categorias. Modelar como `pf_transfers (from_account, to_account, amount, transfer_date)` que ajusta os dois saldos atomicamente (ou par de ajustes de saldo origem−/destino+). TOM detecta "transferi 500 do Itaú pro Nubank" → cria a transferência; nunca classifica como despesa. **Verificar no código se já há algum suporte** antes de criar a tabela.

---

## 9. Alertas proativos (dispatcher)

Novo job em `src/rituals/dispatcher.js`, reusando o padrão de `collaboratorsWithActiveBills`/`billsDueWithin`:

1. **Limite:** para cada cartão ativo, calcular `pct` (§5.4). Se cruzou faixa nova (50/70/80/90) vs `alert_threshold` do ciclo → enviar alerta (§7.3) e atualizar `alert_threshold`. Trocou de ciclo → resetar. **Disparo também no momento do lançamento** (quando a compra cruza a faixa) para feedback imediato — o cron é a rede de segurança.
2. **Vencimento da fatura:** N dias antes do `due_day`, se a fatura da competência ainda não tem `pf_card_payments` → lembrete (§7.4).
3. Respeitar **silêncio diário** (`quiet-hours.js`) e o contexto do colaborador. Sem spam: 1 disparo por faixa por ciclo; lembrete de vencimento idempotente por (card, competência).

---

## 10. Edge cases
- Fechamento/vencimento em dias 29-31 e meses curtos → clampar ao último dia.
- Compra editada/excluída que muda a fatura → recalcular `pct`; não "des-alertar" (faixa já avisada fica registrada no ciclo).
- Parcela no limite do ciclo (compra no próprio `closing_day`) → regra §5.1 (≤ fecha neste mês).
- Cartão desativado (`is_active=false`) → some da lista e dos alertas; faturas históricas preservadas.
- Fuso: sempre America/Sao_Paulo pro "hoje"/competência.
- **Pagamento parcial E total (decisão do Alf):** aceitar `amount` ≤ total restante. A competência só vira "paga" quando `soma(pf_card_payments) >= total da competência`. Antes disso, mostrar "pago parcial: R$ X de R$ Y" na fatura. Cada pagamento debita a `paid_from_account` pelo seu `amount`.

---

## 11. Anchors de código (para o chat executor)

| O quê | Arquivo |
|---|---|
| Service finanças (service_role) | `src/services/financeiro-service.js` |
| Engine: marker/handler financeiro | `src/engine.js` (confirmar nome do marker e localização do handler) |
| Dispatcher (molde cron→WhatsApp) | `src/rituals/dispatcher.js` (`billsDueWithin`, `collaboratorsWithActiveBills`) |
| Silêncio diário | `src/.../quiet-hours.js` |
| PWA finanças (telas) | `web/src/screens/financeiro/{FinanceiroPage,CarteirasPage,ContasFixasPage,TransacoesPage}.tsx` |
| PWA lib finanças | `web/src/lib/financeiro.ts` (`deriveBillStatus`, helpers) |
| PWA realtime | `web/src/hooks/useRealtimeFinance.ts` |
| DS | `web/src/components/` (BottomSheet, CustomSelect, DateInput, Button, Field, Fab) |

**Deploy:** PWA via Vercel (auto-deploy no push). Engine (`src/`) via scp + `pm2 restart tom`. Migrations via MCP `apply_migration` (Supabase `cesnbnrynvxvgdhfmaua`).

**Smoke (WhatsApp):** criar cartão (limite 5.000, fecha 06, vence 10) → "comprei TV 3.200 em 10x no nubank" → conferir 10 parcelas/competências + "vai na fatura de" + barra → "quanto tá minha fatura?" → simular gastos até cruzar 70% e 90% (alertas únicos por faixa) → "paguei a fatura" (debita carteira, não duplica despesa). Validar no Preview (375 + 1440) antes de pedir retest.

# Design — Módulo Finanças Pessoais (TOM como Parceiro Financeiro)

> **Data:** 2026-05-29 · **Sprint:** 27 · **Status:** aprovado para escrever plano de implementação
> **Fonte de verdade do escopo:** `C:\Users\Texeira\Downloads\PRD-financeiro-pessoal-sprint27.md` (v1.1)
> Este documento **complementa** o PRD: registra as decisões de brainstorm, os deltas vs PRD e os guard-rails. Onde este doc e o PRD divergirem, **este doc vence** (decisões mais recentes).

---

## 1. Resumo

Transforma o TOM em parceiro financeiro pessoal dos colaboradores via WhatsApp + PWA: registro de receitas/despesas em linguagem natural, contas fixas a pagar/receber, metas/sonhos com projeção de juros compostos, orçamento por categoria com alertas em tempo real, carteiras com saldo, rituais automáticos e educação financeira. Dado financeiro é **pessoal e sagrado** (RLS owner-only, nunca exposto a coordenador/diretor).

## 2. Decisões travadas (brainstorm 2026-05-29)

| # | Tema | Decisão |
|---|---|---|
| D1 | Fatiamento | **Horizontal por camada**: Fase A (núcleo backend) → Fase B (rituais + educação) → Fase C (PWA). Cada fase testável isolada; valor central (registrar pelo Whats) chega na Fase A. |
| D2 | Voz do TOM | **Herda do `SOUL.md`** (sempre carregado). A skill financeira NÃO redefine voz — só adiciona princípios do domínio ("pague-se primeiro", "sugiro nunca mando", sem jargão). |
| D3 | Dedup alertas orçamento | **Detecção de cruzamento, stateless.** O handler calcula total ANTES e DEPOIS da transação; dispara só o threshold cruzado (`prev < limite ≤ novo`). Múltiplos cruzamentos numa transação → mostra só a faixa mais alta. Sem coluna/tabela de estado. |
| D4 | Selic | **API do Banco Central (SGS) + cache diário + fallback constante.** TOM cita o valor real; se a API cair, usa a constante. Simulação de juros usa a Selic viva como taxa base. |
| D5 | Carteiras (`pf_accounts`) | **Primeira classe.** v1 inclui gestão completa: 5ª tela no PWA, seletor de carteira em toda transação, saldo por carteira visível. |
| D6 | Ciclo de contas fixas | **Status derivado de `last_paid_at`.** "Paga este mês" = `last_paid_at` no mês corrente; "atrasada" = `due_day` passou no mês e não paga este mês. Sem job de reset; a coluna `status` vira cache opcional. |
| D7 | Contribuição de meta ↔ transação | **Contribuição de meta atualiza SÓ `pf_goals.current_amount`; NÃO gera transação no ledger.** Guardar é alocação, não gasto — virar `expense` reduziria o líquido do mês como perda (número errado). "Guardou R$X" no ritual/relatório vem da soma das contribuições do mês (via `update_goal`). Carteira savings é ledger separado; v1 não cria transferência automática (transferência exigiria type novo + trigger de duas contas — fora de escopo). |

## 3. Deltas vs PRD v1.1

1. **Carteiras de primeira classe (D5):** o PRD tem `pf_accounts` + trigger + `create_account` mas nenhuma tela. Este design adiciona:
   - Tela PWA `CarteirasPage.tsx` (lista de carteiras, saldo, criar/editar/desativar).
   - Componente `AccountSheet.tsx` (bottom sheet de carteira).
   - Seletor de carteira no `TransactionSheet`.
   - Saldos por carteira no dashboard `FinanceiroPage`.
   - Rota `/financeiro/carteiras` no menu de sub-rotas.
2. **Ciclo de contas (D6):** schema `pf_bills` mantém-se, mas handlers/cron usam `last_paid_at` como verdade. `pay_bill` grava `last_paid_at = CURRENT_DATE`. Queries de "pendente/paga/atrasada" derivam do mês corrente, não da coluna `status`.
3. **Selic (D4):** novo serviço de fetch BCB com cache (Fase B). Não existe no PRD como módulo separado.
4. **Trigger de saldo endurecido (ver §6):** o PRD usa `SECURITY DEFINER` sem checagem de dono. Este design exige checagem de que `account_id` pertence ao mesmo `collaborator_id`.

## 4. Arquitetura por fase

### Fase A — Núcleo backend
Objetivo: registrar e consultar finanças pelo WhatsApp, ponta a ponta.

- **Migration** (`_remote/migrations/` — confirmar pasta no plano; aplicar via MCP Supabase, projeto `cesnbnrynvxvgdhfmaua`):
  - 5 tabelas `pf_accounts`, `pf_transactions`, `pf_bills`, `pf_goals`, `pf_budgets` (schema do PRD §4).
  - RLS owner-only nas 5 (PRD §4.6).
  - Indexes (PRD §4.2).
  - Trigger de saldo **endurecido** (§6 deste doc).
- **Skill** `_remote/skills/financeiro-pessoal.md`: gatilhos, normalizer de aliases, mapeamento de categorias, regra de ouro (registra direto se veio tudo), princípios do domínio. NÃO redefine voz (D2).
- **Engine** `_remote/src/engine.js`: parser do marker `<<FINANCE_ACTION>> ... <<END>>` (convenção: abre `<<NOME>>`, fecha `<<END>>`; o parser só reconhece `<<END>>`). Handlers de todas as actions: `register_transaction`, `register_bill`, `pay_bill`, `create_goal`, `update_goal`, `set_budget`, `create_account`, `query_summary`, `query_budget`, `query_goal`.
- **System prompt** `_remote/src/prompts/system.js`: quando carregar a skill financeiro-pessoal + formato do `FINANCE_ACTION`.
- **Services** `_remote/src/services/` (novos, CRUD por domínio `pf_*`, seguindo o padrão dos services existentes).
- **Alerta de orçamento inline** no handler `register_transaction` (D3, cruzamento stateless + sugestões práticas hardcoded por categoria — PRD §6.3).

### Fase B — Rituais + educação
- **Dispatcher** `_remote/src/rituals/dispatcher.js` (mesmo padrão dos rituais existentes), todos em BRT:
  - `financeiro_mensal` — dia 10, 18h (PRD §6.1).
  - `lembrete_conta` — diário, 8h (PRD §6.2), usando `last_paid_at` (D6).
  - `relatorio_financeiro_mensal` — dia 1, 18h, mês anterior (PRD §6.4).
  - Registro em `ritual_logs.ritual_type`.
- **Briefing pessoal** `_remote/skills/rituais-diarios.md`: seção financeira (contas vencendo hoje, emoji 💰) — PRD §6.5.
- **Educação** `_remote/skills/educacao-financeira.md`: tópicos (PRD §7.1), simulador de juros compostos (fórmula PRD §7.2), regra "sugere nunca manda".
- **Serviço Selic** (ex. `_remote/src/services/selic.js`): fetch BCB SGS + cache de 1 dia + fallback constante (D4). Consumido pela skill de educação e pelo simulador.

### Fase C — PWA
- **Dependência:** adicionar `recharts` ao `_remote/web/package.json` (não está instalado).
- **Telas** em `_remote/web/src/screens/financeiro/`:
  - `FinanceiroPage.tsx` — dashboard (saldo mensal, saldos por carteira, barras de orçamento, pizza, linha, últimas transações).
  - `TransacoesPage.tsx` — histórico com filtros.
  - `ContasFixasPage.tsx` — contas a pagar/receber, status derivado (D6).
  - `MetasPage.tsx` — metas + simulador.
  - `CarteirasPage.tsx` — gestão de carteiras (**delta D5**).
- **Componentes** em `.../financeiro/components/`: `TransactionSheet` (com seletor de carteira), `BillSheet`, `GoalSheet`, `AccountSheet` (**delta D5**), `BudgetBar`, `CompoundInterestSimulator`.
- **Hooks/services:** `_remote/web/src/hooks/useFinanceiro.ts` (queries + mutations + realtime), `_remote/web/src/services/financeiro-service.ts` (cálculo de juros/projeção).
- **Navegação:** rotas `/financeiro/*` (incl. `/financeiro/carteiras`) + item "Finanças" no menu (ícone Wallet/💰).
- **DS obrigatório:** `CustomSelect`, `BottomSheet`, `Fab`, `Field`, tokens `tom`/`bg-bg-surface`/`text-fg`/`border-border`. Componente novo segue tokens antes de usar.
- **Guardrail mobile/desktop:** telas com versão desktop usam dispatcher por `useBreakpoint` (`XMobile`/`XDesktop`); testar 375px e 1440px; nunca sobrescrever telas existentes.

## 5. Marker e actions

Marker único `<<FINANCE_ACTION>>` com campo `action` discriminador (PRD §5.2/§5.3). Aliases do normalizer e mapeamento de categorias por palavra-chave conforme PRD §5.3. Regra de ouro: se a mensagem já tem tudo, registra e confirma sem perguntar; só pergunta o essencial faltante (valor), uma coisa por vez.

## 6. Segurança e privacidade (guard-rails)

> Contexto: dev single-user hoje, mas dado financeiro é sensível — estes itens são **pré-requisito de produção**, com pushback honesto.

1. **Trigger de saldo NÃO pode confiar cegamente em `account_id`.** A função `pf_sync_account_balance()` roda `SECURITY DEFINER` (ignora RLS). Endurecer: rejeitar/ignorar transação cujo `account_id` aponte para carteira de outro `collaborator_id`. Opções a decidir no plano:
   - (a) `BEFORE INSERT/UPDATE` em `pf_transactions` que valida `pf_accounts.collaborator_id = NEW.collaborator_id` e rejeita se divergir; ou
   - (b) a própria `pf_sync_account_balance()` só atualiza saldo quando `pf_accounts.collaborator_id = NEW.collaborator_id`.
   - Recomendação: (a) — falha barulhenta no insert é melhor que saldo silenciosamente não-sincronizado.
2. **No caminho do TOM (service_role), RLS NÃO protege — o filtro manual por `collaborator_id` é a única blindagem.** O engine escreve via `service_role`, que ignora RLS por completo. Confirmado no código: o cliente é criado com `serviceRoleKey` em `src/supabase/client.js`, e `src/prompts/system.js:1712` admite "Filtra por permissão manualmente (RLS só vale com JWT, aqui usamos service_role)"; o mesmo padrão de filtro manual aparece nos services (ex. `src/services/inventario-service.js`) e no dispatcher de rituais (`src/services/ritual.js`). A RLS owner-only só vale pro PWA (JWT/`current_collab_id()`); o caminho de maior volume de escrita — o WhatsApp — não toca RLS. Para dado financeiro isso exige, sem exceção:
   - **O `collaborator_id` SEMPRE vem do remetente WhatsApp resolvido server-side — NUNCA do JSON do marker `<<FINANCE_ACTION>>`.** O JSON é gerado pelo LLM; confiar no `collaborator_id` (ou `account_id`) que veio nele permitiria gravar/ler na conta errada. O LLM não escolhe de quem é o dado.
   - **Todo SELECT/UPDATE/DELETE nos services `pf_*` filtra explicitamente pelo `collaborator_id` resolvido do remetente** — não confiar em RLS no caminho service_role.
   - Este guard-rail é o irmão do trigger endurecido (item 1): o trigger cobre `account_id` cross-owner; este cobre o resto das queries.
3. **RLS owner-only** nas 5 tabelas (`collaborator_id = current_collab_id()`) — proteção do caminho PWA (JWT). Com teste cross-user explícito (User A não enxerga dados de User B — retorna vazio).
4. **Isolamento de visibilidade:** dado financeiro aparece SÓ no briefing pessoal (7h) e nos rituais financeiros dedicados. NUNCA em dashboard gerencial, relatório de time ou visão de coordenador. Reforçar nos never-dos da skill.
5. **TOM nunca cruza dado financeiro** entre colaboradores nem reporta ao Alf (já nos never-dos do SOUL; reforçar na skill).

## 7. Plano de testes (além do smoke do PRD §10)

- Cross-user nos **dois caminhos**: (a) PWA (JWT/RLS) → vazio; (b) engine (service_role + filtro manual) → handler nunca lê/grava dado de outro `collaborator_id`, mesmo que o JSON do marker traga um `collaborator_id`/`account_id` forjado de outro dono.
- `account_id` de outra carteira → insert rejeitado pelo trigger, saldo alheio intacto.
- Dedup (D3): transações levando categoria a 60→72→85% disparam alerta só em 72 (faixa 70) e 85 (faixa 80), 1x cada; nada nas demais.
- Selic API indisponível → fallback constante, TOM responde normalmente.
- Conta paga em maio aparece **pendente** em junho (derivação por `last_paid_at`, D6).
- Saldo de carteira consistente após insert/update/delete de transação (trigger).
- "Guardei R$500 pro carro" (D7): `pf_goals.current_amount` sobe R$500, NÃO cria transação, NÃO altera despesas/líquido do mês. "Guardou R$X" no relatório bate com a soma das contribuições do mês.

## 8. Resoluções e pontos abertos

Resolvido (confirmado pelo Alf em 2026-05-29):
- **Migration:** aplicar via MCP `apply_migration` (projeto `cesnbnrynvxvgdhfmaua`) — convenção do projeto. O arquivo `.sql` em pasta é só histórico.
- **`SOUL.md`:** fica em `soul/SOUL.md` na raiz (fora de `_remote/`), sempre carregado pelo system prompt. A skill financeira **não mexe nele** — só adiciona princípios de domínio (consistente com D2).

Aberto (decidir no plano, não bloqueia):
- **Nomes finais dos arquivos de service** (backend `pf_*` e Selic) seguindo a convenção dos services existentes.

## 9. Out-of-scope (mantém PRD §11)

Integração com API de banco, importação de extrato, financeiro da empresa/DRE (Sprint 28), múltiplas moedas, OCR de comprovante, dashboard gerencial de finanças do time (NUNCA — viola privacidade).

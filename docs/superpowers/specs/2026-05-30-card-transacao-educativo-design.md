# Design — Card de Confirmação de Transação (educativo / autoinstrutivo)

> **Data:** 2026-05-30 · **Módulo:** Finanças Pessoais (TOM/WhatsApp) · **Status:** aprovado para plano
> **Escopo:** apenas a confirmação de `register_transaction` (gasto/receita). NÃO cobre contas, metas, cartão, resumos.

---

## 1. Problema

Hoje, "gastei 30 no Nubank" devolve `✅ R$30 em outros.` — funcional, mas **indigno e mudo**: não mostra a carteira nem o saldo resultante, e não ensina a pessoa a falar direito com o TOM. Sem educação no próprio retorno, o uso vira bagunça ("gastei tanto, não sei o quê").

## 2. Objetivo

A confirmação de transação vira um **card com hierarquia semântica e respiro visual**, e **autoinstrutivo**: um rodapé em itálico que ensina, naquela hora, o que faltou na mensagem. É uma contribuição de **educação financeira** — premia quem manda completo (rodapé enxuto) e ensina quem manda solto.

Princípio herdado do sistema de referência (Personal Finance/"Ana Clara"), **calibrado pra baixo**: nada de digests gigantes, comparativos diários, projeções ou "dica da persona" em todo box. Só o card da transação.

## 3. Formato do card

Três blocos separados por linha em branco: **confirmação → dados → educação**.

**Gasto com carteira vinculada:**
```
✅ *Gasto registrado*

💸 R$ 30,00  ·  📦 Outros
💜 Nubank → saldo agora: *−R$ 30,00*

_💡 Faltou a categoria. Da próxima, diga pra onde foi:_
_"gastei 30 no Nubank com lazer" — assim eu organizo certo._
```

**Gasto sem carteira** (omite a 2ª linha de dados):
```
✅ *Gasto registrado*

💸 R$ 80,00  ·  🍔 Alimentação

_💡 De onde saiu? Ex: "gastei 80 no Nubank" ou "...no dinheiro"._
```

**Receita:**
```
✅ *Receita registrada*

💰 R$ 5.000,00  ·  💼 Salário
🧡 Itaú → saldo agora: *+R$ 9.875,00*

_💡 ...rodapé contextual..._
```

**Com orçamento estourado** (insere bloco de orçamento ANTES do rodapé, reaproveitando `buildBudgetAlert`):
```
✅ *Gasto registrado*

💸 R$ 80,00  ·  🍔 Alimentação

📊 Alimentação: R$ 125,00 / R$ 100,00 (125%)
💀 100% do orçamento de alimentação. Já pensou em levar marmita essa semana?

_💡 ...rodapé contextual..._
```

Regras de montagem:
- Linha de saldo (`{emoji} {Carteira} → saldo agora: *{±R$}*`) **só** aparece quando a transação vinculou carteira (`account_id != null`).
- Valor sempre formatado pt-BR (`R$ 1.234,56`) via `finance-format`.
- Emoji da categoria pelo mapa existente (`CAT_EMOJI`/equivalente); emoji da carteira vem de `pf_accounts.icon`.
- Sinal do saldo: `+` se ≥ 0, `−` se < 0.

## 4. Rodapé educativo (contextual, prioridade nesta ordem)

1. **Sem categoria** (`category === 'outros'`) →
   `_💡 Faltou a categoria. Ex: "gastei 30 no Nubank com lazer"._`
2. **Com categoria, sem carteira** (`account_id == null`) →
   `_💡 De onde saiu? Ex: "gastei 30 no Nubank" ou "...no dinheiro"._`
3. **Completo** (categoria real + carteira) → **dica rotativa** de educação financeira, de um pool fixo pequeno. Ex:
   - `_💡 Já separou algo pra sua meta esse mês?_`
   - `_💡 Dá pra ver pra onde foi tudo: "quanto gastei esse mês?"._`
   - `_💡 Quer um teto pra essa categoria? "define orçamento de alimentação 500"._`

**Integridade (regra dura):** o rodapé **só ensina comandos que o TOM realmente executa hoje**. Comandos de correção/edição ("era 50", "muda pra alimentação", "apaga isso") **NÃO** entram neste round — não existe ação de editar/excluir transação. Ensinar comando que falha quebra a confiança.

## 5. Arquitetura

- **Builder puro** novo em `src/services/finance-format.js`: `buildTxnConfirmation(input) → string`.
  - `input`: `{ type, amount, categoryKey, categoryLabel, categoryEmoji, account: {name, icon}|null, newBalance: number|null, budget: {category, novo, limit, crossedBand}|null, footer: string }`.
  - 100% determinístico e sem I/O → testável por unidade (segue o padrão TDD das funções puras de finanças, ex. `categorize.test.js`).
- **Seleção da dica rotativa** fica FORA do builder (no handler), passada via `footer`, pra manter o builder puro/testável. Seleção determinística (ex.: índice por `dia-do-mês % tamanho-do-pool`) — sem `Math.random`.
- **Handler** `register_transaction` em `engine.js`: após inserir a transação, (a) resolve carteira (já feito), (b) busca saldo atualizado da carteira quando vinculada (`pf_accounts.balance` pós-trigger), (c) calcula footer contextual, (d) monta o card via `buildTxnConfirmation` (compondo `buildBudgetAlert` quando cruzou limite). Substitui a string atual `✅ R$X em ${category}.`
- Texto da skill `financeiro-pessoal.md`: reforçar que a pessoa pode mandar `categoria` e `de onde saiu` numa frase só — alinhado ao que o rodapé ensina.

## 6. Fora de escopo (rounds futuros, reconhecidos)

- **Correção/edição/exclusão de transação** por linguagem natural: "era 50", "muda pra alimentação", "apaga isso" — incluindo o fluxo **listar → apagar** ("me diz o que gastei esse mês" → lista → "apaga a compra da geladeira"). Requer ações novas `edit_transaction` / `delete_transaction` + identificação da transação alvo. Round dedicado.
- Captura interativa de meio de pagamento ("como você pagou? 1/2/3/4") — o escopo #2 que ficou de fora.
- Cards equivalentes pra contas, metas, cartão, resumos.

## 7. Testes

- Unit (puro) do `buildTxnConfirmation`: gasto com/sem carteira, receita, saldo negativo/positivo, com/sem bloco de orçamento, cada um dos 3 rodapés.
- Smoke E2E no WhatsApp: "gastei 30 no Nubank" (rodapé categoria), "gastei 80 com mercado" (rodapé carteira), "gastei 50 no Nubank com lazer" (completo → dica), "recebi 5000 de salário" (receita), gasto que estoura orçamento (bloco de alerta + rodapé).
- Reconciliação no banco: saldo da carteira no card == `pf_accounts.balance`.

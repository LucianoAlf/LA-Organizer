# Biblioteca de Categorias Data-Driven — Design

**Data:** 2026-05-31
**Status:** Aprovado (brainstorming via diálogo)

## Objetivo

Expandir as categorias do financeiro de **10 hardcoded** (espalhadas em ~6 lugares)
para **44 categorias data-driven** (31 despesas + 13 receitas), com ícone/cor/
keywords/tipo, lidas de uma tabela `pf_categories`. Meta de produto: classificação
**granular** — o usuário quer ver exatamente onde gasta, **não** ver tudo caindo em
"Outros". `outros`/`outras_receitas` é último recurso, não destino padrão.

## Princípios

- **1 fonte de verdade:** as 44 defaults vivem num módulo de dados (engine) + seed
  na tabela `pf_categories` (PWA lê). Mata o espalhamento em 6 lugares.
- **Keywords fortes:** cada categoria tem palavras-chave pra `mapCategory` rotear
  certo (ifood→Delivery, salão→Beleza). A skill expõe as 44 ao LLM pra ele
  classificar direto.
- **Tipo-aware:** categorias são tipadas (expense/income). `mapCategory`/
  `safeCategory` respeitam o tipo — fallback de despesa = `outros`, de receita =
  `outras_receitas`. Evita colisão de keyword (aluguel pago vs aluguel recebido).
- **Backward-compatible:** `pf_transactions.category` continua **slug em texto**.
  Sem FK rígida (custom no v2 encaixa). Validação app-level.

## Taxonomia (44 defaults)

### Despesas (31)
| slug | label | emoji | keywords |
|---|---|---|---|
| alimentacao | Alimentação | 🍔 | comida, almoço, almoco, lanche, padaria, café, cafe |
| assinaturas | Assinaturas | 🔁 | netflix, spotify, disney, hbo, prime, assinatura, mensalidade streaming |
| beleza | Beleza | 💅 | salão, salao, cabelo, manicure, barbeiro, estética, estetica, maquiagem |
| combustivel | Combustível | ⛽ | gasolina, etanol, álcool, alcool, diesel, posto, combustível |
| compras | Compras | 🛍️ | loja, shopping, compra |
| contas_consumo | Contas de Consumo | 💡 | luz, água, agua, gás, gas, energia, saneamento, conta de luz, internet, telefone |
| delivery | Delivery | 🛵 | ifood, rappi, uber eats, ubereats, delivery, entrega |
| educacao | Educação | 📚 | curso, livro, escola, faculdade, material escolar |
| eletrodomesticos | Eletrodomésticos | 🔌 | geladeira, fogão, fogao, microondas, máquina, maquina, eletrodoméstico |
| emprestimo | Empréstimo | 💸 | empréstimo, emprestimo, parcela empréstimo |
| esportes | Esportes | 🏋️ | academia, gym, esporte, personal, crossfit, futebol, natação, natacao |
| estacionamento | Estacionamento | 🅿️ | estacionamento, zona azul, parquímetro, parquimetro |
| farmacia | Farmácia | 💊 | farmácia, farmacia, remédio, remedio, drogaria |
| filhos | Filhos | 👶 | filho, criança, crianca, fralda, brinquedo, escola filho |
| financiamento | Financiamento | 🏦 | financiamento, prestação, prestacao, parcela financiamento |
| impostos | Impostos | 🧾 | ipva, iptu, imposto, darf, taxa |
| lazer | Lazer | 🎬 | cinema, teatro, show, bar, jogo, parque, lazer |
| mercado | Mercado | 🛒 | mercado, supermercado, hortifruti, feira, atacadão, atacadao |
| moradia | Moradia | 🏠 | aluguel, condomínio, condominio, moradia |
| outros | Outros | 📦 | (sem keywords — fallback de despesa) |
| pets | Pets | 🐾 | pet, ração, racao, veterinário, veterinario, petshop, cachorro, gato |
| presentes | Presentes | 🎁 | presente, gift, lembrança, lembranca |
| reparos_manutencoes | Reparos e Manutenções | 🔧 | reparo, conserto, manutenção, manutencao, encanador, eletricista, pintura |
| restaurante | Restaurante | 🍽️ | restaurante, jantar, churrascaria, pizzaria, lanchonete |
| saude | Saúde | 🏥 | médico, medico, dentista, consulta, plano de saúde, plano saude, exame, hospital |
| seguros | Seguros | 🛡️ | seguro, apólice, apolice, seguro auto, seguro vida |
| tecnologia | Tecnologia | 💻 | notebook, celular, computador, software, gadget, eletrônico, eletronico |
| transferencia_contas | Transferência entre Contas | 🔄 | transferência, transferencia, ted, doc |
| transporte | Transporte | 🚗 | uber, 99, ônibus, onibus, metrô, metro, táxi, taxi, passagem |
| vestuario | Vestuário | 👕 | roupa, sapato, tênis, tenis, vestuário, vestuario |
| viagens | Viagens | ✈️ | viagem, hotel, passagem aérea, passagem aerea, airbnb, hospedagem |

### Receitas (13)
| slug | label | emoji | keywords |
|---|---|---|---|
| salario | Salário | 💼 | salário, salario, pagamento la, holerite |
| comissao | Comissão | 💰 | comissão, comissao, venda loja, venda |
| decimo_terceiro | 13º Salário | 🎄 | 13º, décimo terceiro, decimo terceiro, 13 salário |
| aluguel_recebido | Aluguel | 🏠 | aluguel recebido, recebi aluguel, renda aluguel |
| aposentadoria | Aposentadoria | 👴 | aposentadoria, inss, previdência, previdencia |
| bonus | Bônus | ⭐ | bônus, bonus, prêmio, premio, bonificação |
| ferias | Férias | 🏖️ | férias, ferias, adicional férias |
| freelance | Freelance | 🧑‍💻 | freelance, freela, bico, projeto extra, renda extra, extra |
| investimentos | Investimentos | 📈 | investimento, dividendo, rendimento, juros, cdb, tesouro, ações, acoes |
| outras_receitas | Outras Receitas | 💵 | (sem keywords — fallback de receita) |
| pensao | Pensão | 🤝 | pensão, pensao, pensão alimentícia |
| presente_recebido | Presente | 🎁 | presente recebido, ganhei, recebi presente |
| restituicao_ir | Restituição IR | 🧾 | restituição, restituicao, restituição ir |

> Cores: eu atribuo um hex coerente por categoria no plano (a tabela guarda `color`;
> v2 refina). Não bloqueia o v1.

## Arquitetura

### 1. Tabela `pf_categories`
Colunas: `id uuid pk`, `slug text`, `label text`, `emoji text`, `color text`,
`type text check (type in ('expense','income'))`, `keywords text[]`,
`is_default bool`, `collaborator_id uuid null` (null = global; preenchido = custom
no v2), `sort_order int`, `is_active bool default true`.
- Unicidade: `slug` único por escopo (`unique (collaborator_id, slug)`; defaults têm
  collaborator_id null).
- RLS: SELECT defaults (collaborator_id null) + próprias; INSERT/UPDATE próprias (v2).
- Seed: 44 defaults via migration.

### 2. Binding com transações
`pf_transactions.category` permanece **slug em texto**. **Remove o CHECK restritivo**
(`pf_transactions_category_check`) das 10 — passar a validar no app:
- Engine: `safeCategory(cat, description, type)` coage pra slug válido; desconhecida →
  `mapCategory(description, type)` → se ainda inválida, `outros` (expense) /
  `outras_receitas` (income).
- PWA: o picker só oferece slugs válidos (lidos da tabela).
Mesmo tratamento em `pf_budgets`/`pf_bills` se tiverem CHECK de categoria.

### 3. Engine — módulo de dados único
`src/finance/categories.data.js` exporta as 44 (`slug→{label,emoji,color,type,keywords}`).
- `categorize.js`: `mapCategory(text, type)` lê os keywords do módulo, filtrando por
  tipo (só income p/ receita, só expense p/ despesa).
- `engine.js`: `safeCategory`/`PF_VALID_CATEGORIES` derivam do módulo.
- `finance-format.js`: `CAT_META` deriva do módulo (label+emoji por slug).
- `skills/financeiro-pessoal.md`: a seção "Categorias válidas" passa a listar as 44
  (por tipo) pro LLM classificar direto — é assim que o TOM "reconhece" a categoria
  certa em vez de jogar em Outros.

### 4. PWA — lê da tabela
- `useCategories()` (novo hook): lê `pf_categories` (cacheado via TanStack Query).
- `lib/financeiro.ts`: `PfCategory` deixa de ser union fechada de 10 → `string` (slug),
  com a tabela como fonte de label/emoji/cor.
- `CAT_EMOJI` (FinanceiroPage) e labels saem do hook.
- Pickers (`TransactionSheet`, `BillSheet`): listam categorias **filtradas por type**
  (despesa→31, receita→13), com emoji+label.
- Charts/labels (`FinanceCharts`, `BudgetBar`): usam o hook pra label/cor.

### 5. Migration de dados
- Seed as 44 em `pf_categories`.
- `UPDATE pf_transactions SET category='freelance' WHERE category='extra';`
  (único remap — os outros 9 slugs antigos já existem no set novo).
- Mesmo UPDATE em `pf_budgets`/`pf_bills` se usarem 'extra'.
- Dropar/ajustar o CHECK de categoria nas tabelas afetadas.

## Coordenação
Toca o core de finanças do outro chat: `categorize.js`, `CAT_META`
(`finance-format.js`), `safeCategory`/`PF_VALID_CATEGORIES` (`engine.js`), DB. Avisar:
o CHECK sai, e o `safeCategory` recém-adicionado é refatorado pro módulo de dados +
fica type-aware.

## Fora de escopo (v2)
- Tela "Biblioteca de categorias" (CRUD de categorias custom, "Minhas categorias").
- Paridade exata de ícone/cor com o app de referência.
- Edição de keywords pela UI.

## Testes
**Unit (node:test):**
- `mapCategory`: ifood→delivery, salão→beleza, mercado→mercado, restaurante→restaurante,
  uber→transporte, posto→combustivel; type-aware (aluguel+income→aluguel_recebido,
  aluguel+expense→moradia); fallback expense→outros, income→outras_receitas.
- `safeCategory`: slug inválido + type → fallback correto por tipo.
**Migration:** pós-migrate, `SELECT count(*) WHERE category NOT IN (slugs válidos)` = 0;
nenhuma transação com category='extra'.
**PWA:** picker de despesa mostra 31, de receita mostra 13; build+tsc verdes.
**Smoke WhatsApp:** foto de salão → **Beleza**; iFood → **Delivery** (não mais
alimentação genérico); nada cai em Outros indevidamente.

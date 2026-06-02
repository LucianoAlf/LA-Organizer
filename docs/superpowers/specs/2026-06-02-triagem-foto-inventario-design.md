# Design — Triagem de foto de item + Trava de sala no inventário

**Data:** 2026-06-02
**Status:** Aprovado (aguardando review da spec)

## Contexto e problema

O TOM recebe fotos de instrumentos/equipamentos por WhatsApp (auditoria de salas do
Rodrigo). Hoje, qualquer foto de item **pula direto para `<<INVENTORY_ACTION>>`**
(cadastro no inventário), com dois defeitos graves observados no teste 02/06:

1. **Sala chutada do histórico.** Ao cadastrar a "Guitarra Tagima GJ", o TOM gravou
   na **Sala 13 sem perguntar** — o engine logou `[InvCtx] salaRecentePersistida=NENHUMA`
   (não havia sala confirmada), mas o LLM puxou "Sala 13" da conversa anterior (do
   Condor, hist=5) e inseriu. Risco real: item cadastrado na sala errada.
2. **Sem triagem de intenção.** Nem toda foto é para inventário. Um assistente pode
   mandar a foto de uma guitarra dizendo "tá com a corda velha" — isso é um **problema**
   que deveria virar task para o responsável (Operações Técnicas → Rafinha), não um
   cadastro de inventário. Também pode ser item novo para a **lojinha**.

O sistema **já tem** as rotas certas: `skills/operacoes-tecnicas.md` captura problemas
técnicos e cria task roteada (default `to_name` = **Rafinha**); `skills/inventario.md`
e o fluxo lojinha existem. O que falta é (1) um **roteador de triagem** que decida a
rota da foto, e (2) uma **trava determinística de sala** que o LLM não consiga furar.

## Decisões de produto (aprovadas)

- **Triagem só no ambíguo.** Intenção clara → age direto na rota certa. Sessão de
  inventário aberta → fotos seguintes vão direto. Ambíguo → o TOM pergunta.
- **Trava de sala no engine** (determinística), com a regra no prompt como reforço.

## Parte 1 — Roteador de triagem (prompt)

Editar `skills/inventario.md` (e reforço em `skills/reagir-mensagens.md` se necessário)
para que, ao chegar **foto de item**, o TOM decida a rota:

| Situação | Rota |
|---|---|
| Intenção clara = inventário ("cadastra", "registra no inventário") | `<<INVENTORY_ACTION>>` (sujeito à trava da Parte 2) |
| Intenção clara = problema ("defeito", "corda velha", "quebrado", "não funciona", "estragado") | fluxo `operacoes-tecnicas` (task em Operações Técnicas → Rafinha) |
| Intenção clara = lojinha ("pra vender", "produto novo da lojinha") | fluxo lojinha |
| Sessão de inventário ABERTA (user disse "tô fazendo o inventário da Sala X") | fotos seguintes → inventário daquela sala (fluxo rápido preservado) |
| Ambíguo (só a foto, ou descrição que não deixa claro) | **PERGUNTAR**: "O que você quer com essa *[item]*?\n1) Cadastrar no inventário\n2) Reportar um problema (mando pro responsável)\n3) Outra coisa" |

**Regras-chave:**
- Foto pelada de item **NÃO** é inventário automático.
- "Condição" do item (ex.: "sem cordas") **dentro** de uma sessão de inventário vira o
  campo `condicao`. **Fora** de sessão, "tá com problema" vira **task pro Rafinha**.
- A triagem não inventa categorias novas — reusa inventário / operacoes-tecnicas / lojinha.

## Parte 2 — Trava de sala no engine (determinística)

**Fonte de verdade:** o engine só aceita um insert de inventário (`action` create/
add_item) quando a sala é **confirmada**. Confirmada = uma de:
- (a) há **sessão travada** com sala persistida (`salaRecentePersistida` em
  `src/prompts/system.js`), e o marker aponta para ela; **ou**
- (b) o user **disse a sala na mensagem atual** — a `sala_nome` (ou nº/unidade) do
  marker aparece no texto/legenda do turno corrente.

Se nenhuma → o engine **bloqueia** o insert e responde (texto do engine, anti-mentira):
*"Em qual unidade e sala você quer cadastrar a [nome]?"*. O LLM não consegue furar
porque a decisão é do engine, não do prompt.

**Implementação:**
1. `src/prompts/system.js` — expor o contexto de sala já calculado em `ctx`
   (ex.: `ctx.invSalaContext = { sala_id, sala_nome } | null`).
2. `src/engine.js` (handler `<<INVENTORY_ACTION>>`, branch insert) — antes do
   `inserirItem`, computar `salaConfirmada` e, se falso, substituir o fluxo por uma
   pergunta (sem inserir). Reusa o padrão anti-mentira já implementado (engine = fonte
   da verdade; descarta prosa otimista do LLM).
3. Função pura `salaConfirmada({ markerSalaNome, markerSalaId, persisted, inboundText })`
   em um módulo testável (`src/services/inventory-sala-guard.js`), com TDD.

**Detecção de (b):** normalizar (lowercase, sem acento) o `inboundText` do turno e
verificar se contém a `sala_nome` do marker, ou o número da sala, ou um nome de unidade
(Barra/Recreio/Campo Grande/CG). A legenda da foto entra no `inboundText` (o webhook a
inclui), então captions com a sala contam como confirmação.

## Componentes e fronteiras

- **`inventory-sala-guard.js`** (novo, puro): decide `salaConfirmada` — entrada
  (marker sala, sala persistida, texto do turno), saída boolean. Testável isolado.
- **`system.js`**: produtor do contexto de sala (já existe; só expõe em `ctx`).
- **`engine.js`**: consumidor — aplica a trava no branch de insert.
- **`skills/inventario.md`**: o roteador de triagem (comportamento do LLM).

## Tratamento de erros / edge cases

- Sala no caption ("Guitarra X — Sala 14") → `inboundText` contém → passa.
- Sessão de inventário aberta → `persisted` casa → passa (fluxo rápido intacto).
- Foto fria sem sala → bloqueia → pergunta unidade+sala.
- `update_item`/`move_item` não são cobertos pela trava de insert (têm lógica própria
  de origem/destino) — fora de escopo desta trava.
- Falha ao computar contexto de sala → trata como NÃO confirmada (erra pro seguro: pergunta).

## Testes

- **TDD** do `inventory-sala-guard.js`: confirmada via sessão; confirmada via texto do
  turno (sala_nome / número / unidade); NÃO confirmada (texto sem sala, sem sessão);
  caption com sala; normalização (acentos/caixa).
- **Não unit-testável** (verificar em teste controlado no WhatsApp): a triagem do LLM
  e o bloqueio end-to-end (foto fria → TOM pergunta; sessão aberta → cadastra direto).

## Fora de escopo

- Redesenho do fluxo de movimentação/baixa de inventário.
- Triagem para fotos que não são de item (documentos, prints) — segue o fluxo de visão atual.
- Compressão server-side da foto no caminho do TOM (bucket não tem limite; desnecessário).

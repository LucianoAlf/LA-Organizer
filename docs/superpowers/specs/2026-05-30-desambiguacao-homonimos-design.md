# Desambiguação de homônimos no resolvedor de nomes (Dai / Daiana)

**Data:** 2026-05-30
**Autor:** Claude Code + Alf
**Status:** Aprovado (design) — pronto para plano de implementação

## Problema

Dois colaboradores ativos, pessoas diferentes com nomes coloquialmente
intercambiáveis pela equipe ("a Dai"):

| | id | full_name | function_role | pedagogical_role | unit | phone |
|---|---|---|---|---|---|---|
| Pedagógica | `4c5796ca-dea0-40ea-9d96-3b1fd3929bb7` | `Dai` | `pedagogico` | `assistant` | `all` | 5521986409985 |
| Farmer | `e6afed0d-59af-432b-aec3-ce2427db7be2` | `Daiana` | `farmer` | `null` | `recreio` | 5521968060404 |

Aliases atuais:
- Dai-ped: `Dai Ped, Daiana Ped, Dai Pedagógica, Day Ped, Day Pedagógica`
- Daiana: `Dayana, Dai ADM, Dai Recreio, Dai DM, Daiana Farmer, Day ADM, Day Recreio, Diana, Diana Recreio`

### Mecanismo real do bug

`findCollaboratorByName(name)` em `src/engine.js` faz **short-circuit no
primeiro tier** que retorna exatamente 1 candidato:

1. match exato da string completa em `preferred_name`/`aliases[]`
2. match no primeiro-token do `full_name`
3. match em `preferred_name`
4. match em `aliases[]` (primeiro-token)
5. prefixo em `full_name`

Para o nome cru **"Dai"**, o tier 2 casa o primeiro-token de `full_name`
da Dai-pedagógica (`"Dai"` → `"dai"`) e retorna na hora (`length === 1`).
Resultado: **"Dai" SEMPRE resolve para a pedagógica e nunca pergunta.**
Quando um Farmer do Recreio fala "Dai" querendo a Daiana, a mensagem
(relay/cobrança/task) vai **silenciosamente para a pessoa errada**.

Não é o caso "ambíguo → null"; é "match confiante na pessoa errada".
O espelho vale para "Daiana" (a pedagógica também é "Daiana Ped").

A função recebe **só o nome** — não tem acesso a quem mandou (requester)
nem ao assunto, então hoje é impossível desambiguar por contexto.

## Decisões aprovadas (Alf, 2026-05-30)

1. **Fonte do domínio:** reusar `function_role` + `unit` (já populados e já
   distinguem as duas). Sem coluna nova. A migration só adiciona aliases.
2. **"Pergunta 1 vez":** stateless via aliases — TOM pergunta e cria nada no
   turno; a resposta natural resolve único via qualifier-aliases. Sem máquina
   de estado nova.
3. **Escopo do ASK:** aplicar desambiguação por contexto em **todos os 5
   callsites**; quando ainda ambíguo, task/event **também perguntam** (em vez
   de falha silenciosa atual).

### Revisão 2026-05-30 (pós-review do Alf) — desambiguação SÓ por quem-fala

A 1ª versão usava também o **assunto da mensagem** (palavra-chave: `aluno` →
pedagógico, `estoque` → farmer) como sinal, com peso maior que o requester.
**Furo apontado pelo Alf:** o vocabulário é **compartilhado** — a Daiana Farmer
também trata de "o aluno chegou atrasado" no Recreio. Logo "avisa a Dai que o
aluno Guilherme atrasou", vindo do Clayton (Recreio), cairia errado na Dai-ped.

**Decisão:** **remover o sinal de assunto por completo.** Desambiguar **só por
quem fala** — o domínio do requester (`unit`/`function_role`/`pedagogical_role`),
que é confiável (vem do phone). Quem é do Recreio (Clayton `unit=recreio`, Fefê
`farmer`/`recreio`, e futuros) → Daiana; quem é pedagógico → Dai-ped; quem não
pertence claramente a um lado (ou pertence aos dois) → **pergunta**, não chuta.
Lock "por unit/função" auto-inclui gente nova do Recreio sem lista manual.

## Design

### 1. Arquitetura do resolvedor

Novo `resolveCollaboratorByName(name, { requester, subject })` retornando um
de três estados:

```js
{ status: 'resolved',  collaborator }       // único OU resolvido por contexto
{ status: 'ambiguous', candidates: [...] }  // >1 após contexto → perguntar
{ status: 'not_found' }                     // 0 candidatos
```

`findCollaboratorByName(name)` vira **wrapper fino** (chama o resolver sem
contexto; devolve `collaborator` se `resolved`, senão `null`). Isso preserva
qualquer caller não migrado.

### 2. Coleta de candidatos (a correção de raiz)

Trocar o short-circuit por **união** dos tiers de token:

- primeiro-token de `full_name`
- `preferred_name` (exato ou primeiro-token)
- primeiro-token de cada `alias`

**Precedência de qualificador:** se houver match **exato da string completa
normalizada** em `preferred_name`/`alias`/`full_name` resolvendo a **um único**
candidato, retorna esse imediatamente (ex.: "Dai Recreio" → Daiana; "Dai Ped"
→ Dai-ped). Qualificador explícito sempre ganha.

Senão, monta a união. Com os aliases atuais, "Dai" casa Dai-ped (full_name +
alias) **e** Daiana (aliases `Dai ADM`/`Dai Recreio` → token `dai`) → 2
candidatos → entra na desambiguação. Idem "Day" e "Daiana".

### 3. Desambiguação por quem-fala (revisado — sem assunto)

`domainOf(collab)` → `Set` de tokens de domínio, derivado dos campos
existentes:
- `function_role` (`pedagogico`, `farmer`, …)
- `pedagogical_role` presente → adiciona `pedagogico`
- `unit` ≠ `all`/null → adiciona `unit:<unit>` (ex.: `unit:recreio`)

Dai-ped → `{pedagogico}` · Daiana → `{farmer, unit:recreio}` ·
Clayton (manager Recreio) → `{unit:recreio}` · Fefê → `{farmer, unit:recreio}`.

**Único sinal: o requester** (confiável — vem do phone). O assunto **não** é
usado (vocabulário compartilhado puxa errado — ver Revisão acima).

Regra (`disambiguate`) — **localização (unit) ganha de função**, porque a
Daiana é a *dona do Recreio* (operação Farmer + ops pedagógicas locais:
presença de professor, checklist de aluno daquela unidade), enquanto a Dai-ped
é pedagógica *cross-unidade*:
- 0 candidatos → `not_found`; 1 candidato → `resolved`.
- 2+ candidatos:
  1. **Unit match:** `unitHits = candidatos cujo domainOf compartilha um token
     `unit:*` com o requester`. Se `unitHits.length === 1` → `resolved`.
  2. **Senão, função:** `hits = candidatos cujo domainOf ∩ domainOf(requester)
     ≠ ∅`. Se `hits.length === 1` → `resolved`.
  3. Senão (sem lado, ou empate irredutível) → `ambiguous` → pergunta.

Casos: Clayton/Fefê (`unit:recreio`) → Daiana. **Professor do Recreio**
(`pedagogico` + `unit:recreio`) → Daiana (unit ganha). Professor de outra
unidade (`pedagogico` + `unit:tijuca`) → Dai-ped. Director (`{director}`, sem
interseção) → pergunta. Quem precisa da pedagógica cross-unidade estando no
Recreio usa o qualificador "Dai Ped".

### 4. Comportamento por callsite (`src/engine.js`)

Todos passam **só** `{ requester }` (o emissor, vindo do phone). Sem assunto.

| Linha | Fluxo | requester | `resolved` | `ambiguous` | `not_found` |
|---|---|---|---|---|---|
| ~1660 | COORDINATION (relay/cobrança) | `collab` | segue | **pergunta** (`replyText`), cria nada | "não achei" (atual) |
| ~2239 | EVENT create-for-other | `collaborator` | segue | **pergunta** (via `integrityPayload`) | atual (failCount) |
| ~3778 | TASK create-for-other | `collaborator` | segue | **pergunta** (via `integrityPayload`) | atual (failCount) |
| ~4228 | TASK delegate | `collaborator` | segue | **pergunta** | atual |
| ~2301 | EVENT related_to (inferência) | `collaborator` | seta | **ignora** (deixa vazio) | ignora |

Nota de implementação: a fiação exata do "perguntar via `integrityPayload`"
nos handlers de task/event será detalhada no plano (o canal já existe; os
handlers retornam `{okCount, failCount, integrityPayload}`).

### 5. Migration (somente dados — sem coluna nova)

Append idempotente (dedup) em `collaborators.aliases`:
- Dai-ped `4c5796ca…`: `+ ["Dai", "Day", "Dai do Pedagógico", "Daiana do Pedagógico"]`
- Daiana `e6afed0d…`: `+ ["Dai", "Day", "Daiana do Recreio", "Daiana Recreio"]`

Adicionar "Dai"/"Day" cru às duas é belt-and-suspenders: torna o nome
compartilhado **explícito e data-driven**. A regra de desambiguação vive no
**código**; um homônimo futuro só precisa do apelido curto cadastrado nas
duas pessoas + `function_role`/`unit` corretos.

### 6. ASK stateless

Quando `ambiguous`, TOM pergunta 1x e não cria nada no turno:

> "Tem a Dai do Pedagógico e a Daiana do Recreio — é qual delas?"

As respostas naturais ("a do Recreio", "Daiana do Recreio", "a do Pedagógico",
"Dai Ped") resolvem único via os qualifier-aliases da migration. Adicionar um
nudge curto na skill de coordenação para o TOM re-emitir o nome **qualificado**
após a escolha do usuário.

### 7. Smoke test (read-only contra o banco, antes do deploy)

Script node que chama `resolveCollaboratorByName` com dados reais:

1. requester=Farmer(recreio) · name="Dai" · subject="repor estoque da lojinha" → **Daiana**
2. requester=assistente pedagógico · name="Dai" · subject="aula do aluno João" → **Dai-ped**
3. requester=director(neutro) · name="Dai" · subject="" → **ambiguous** (pergunta)
4. name="Dai Recreio" (qualquer contexto) → **Daiana**
5. name="Dai Ped" → **Dai-ped**

### 8. Segurança

Ver [[feedback_sensitive_data_service_role]]. O caminho service_role ignora
RLS, então identidade nunca pode vir do marker do LLM:

- **requester** vem do **phone** (confiável) → é o **único** sinal de
  desambiguação. O assunto da mensagem (texto do LLM) **não** é usado.
- `recipient_name`/`to_name` do marker são **strings de busca**, não
  identidade. A pessoa resolvida sempre sai de uma row do `collaborators`.

## Fora de escopo

- Coluna `domain_tag` dedicada (rejeitada — `function_role`/`unit` bastam hoje).
- Pending-intent persistido (rejeitado — stateless via aliases basta).
- UI/admin para gerenciar aliases (não necessário para esta correção).

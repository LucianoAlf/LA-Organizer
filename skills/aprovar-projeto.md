---
name: aprovar-projeto
description: Permite que coord/diretor aprove ou rejeite projeto pendente via mensagem. SEMPRE exige identificador explícito (APROVA TOKEN ou REJEITA TOKEN motivo). Mensagem nua "aprovo" NUNCA aprova — pede identificador.
---

# Aprovar / rejeitar projeto pendente

## Gate de permissão (PRIMEIRA COISA)

Olhe `Role` no contexto:
- `coordinator` ou `director` → siga o fluxo abaixo
- outros → recuse: *"Aprovar projeto é só pra coordenador ou diretor."* E PARE.

## Como o supervisor recebeu o pedido

Quando o PWA cria um projeto que precisa de aprovação, o engine manda uma mensagem WhatsApp tipo:

```
*Anne* criou um projeto novo:

🗂️ *Sarau de Violinos*
🎯 Celebrar 14 anos da escola
📍 Recreio · 01/06 → 30/07/2026

Pra aprovar, responde: *APROVA SARAU*
Pra rejeitar, responde: *REJEITA SARAU motivo*
```

O **token** (`SARAU`) é a primeira palavra distintiva do nome do projeto, em maiúsculas. Stopwords (LA, DA, DE, DO, etc) são ignoradas. "LA Session" → `SESSION`. "Sarau de Violinos" → `SARAU`. "Workshop de Bateria" → `WORKSHOP`.

## Fluxo de resposta

### Caso A — usuário disse "aprovo" / "pode aprovar" / "rejeito" sem token

NUNCA aprove. Peça identificador:

> *Qual projeto? Responde APROVA <NOME> (ou REJEITA <NOME> motivo).*
>
> Exemplo: `APROVA SARAU`

NÃO emita marker. NÃO improvise.

### Caso B — `APROVA <TOKEN>`

⚠️ **REGRA INVIOLÁVEL**: sempre que o supervisor enviar `APROVA <TOKEN>` (qualquer token, qualquer projeto), você **DEVE emitir o marker**. NÃO tente verificar se o projeto existe pelo seu contexto — o engine faz a validação, e se o token não bater com nenhum projeto pendente, o engine responde por você com mensagem amigável ("não tenho projeto pendente com esse nome…").

**Você não tem visibilidade dos projetos pending_approval no system prompt** — só dos `planning`. Não confie no que você "vê" — confie no engine.

Liberdade na resposta texto, contrato no marker.

**Texto** — confirme com naturalidade, **mencionando o nome do projeto** (capitalize o token: `CORAL` → "Coral", `SARAU` → "Sarau", `WORKSHOP` → "Workshop"). Pode prometer estruturação. Exemplos:
- `✅ Coral aprovado! Vou avisar quem criou e começar a estruturar.`
- `Beleza, *Sarau* aprovado. Já mandei pra Anne.`
- `✅ Workshop tá em planejamento. Bora.`

⛔ **Veto de jargão**: NUNCA diga "engine", "sistema", "API", "banco", "marker", "checkpoint", "milestone", "roadmap", "sprint", "5W2H", "Eisenhower". Você fala como TOM, não como tech. Em vez de "encaminhei pro engine" → "vou estruturar" ou "já mapeei as etapas iniciais".

**Marker** — sempre emita, sempre com o token literal que o usuário digitou:

<<PROJECT_APPROVE>>
{"token":"SARAU"}
<<END>>

### Caso C — `REJEITA <TOKEN> motivo`

Mesma lógica, com `reason`. O motivo é obrigatório — se o usuário só digitou `REJEITA SARAU` sem motivo, peça:

> *Qual o motivo da rejeição?*

⚠️ **Mesma regra inviolável**: sempre emita o marker para `REJEITA <TOKEN> motivo`. Não verifique existência — o engine valida.

**Texto** — naturalidade, **mencione o nome do projeto** (capitalize o token):
- `Avisei a Anne. *Coral* tá rejeitado.`
- `❌ Sarau recusado. Já mandei o motivo pra quem criou.`
- `Workshop negado. Avisei.`

⛔ Mesmo veto de jargão: nada de "engine", "sistema", "API", "banco".

**Marker** — token literal + motivo do usuário:

<<PROJECT_REJECT>>
{"token":"SARAU","reason":"Sem orçamento esse mês"}
<<END>>

### Caso D — engine não encontrou ou achou múltiplos

Se o engine devolver erro (token_not_found ou ambiguous_token), responda na próxima vez:

- token_not_found: *"Não tenho nenhum projeto pendente com esse nome. Tem certeza?"*
- ambiguous_token: *"Tenho mais de um projeto começando com {TOKEN}. Pode reescrever o nome inteiro?"*

## Veto (NUNCA)

- NUNCA aprovar/rejeitar sem token explícito (mensagem nua "aprovo" não vale).
- NUNCA exibir o marker, IDs internos, ou estrutura técnica ao usuário.
- NUNCA processar APROVA/REJEITA se role for `collaborator` ou `leader`.
- NUNCA inventar token — sempre o que o usuário literalmente digitou.
- NUNCA emitir REJEITA sem `reason`. Se faltar, peça.

## Casos de borda

- Usuário digitou `APROVA sarau` (minúsculas) → trate como `SARAU` no marker.
- Usuário digitou só `APROVA` sem token → mesmo caso A: peça identificador.
- Usuário digitou `APROVA SARAU DE VIOLINOS` → use só `SARAU` (primeiro token significativo).
- Usuário digitou `REJEITA SARAU sem motivo agora` → motivo é "sem motivo agora" (todo texto após o token).

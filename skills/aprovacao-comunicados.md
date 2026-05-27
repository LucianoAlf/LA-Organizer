# Aprovação de Comunicados

Esta skill ensina o TOM a coordenar o fluxo de aprovação de comunicados quando criados por coordinator.

## Quando ativar

- O usuário é **coordinator** e está criando um comunicado: TOM informa que o comunicado vai para aprovação.
- O usuário é **director** e responde mensagens contendo `APROVAR <id>` ou `REJEITAR <id> [motivo]`.
- O usuário pergunta "quais comunicados estão aguardando aprovação?" ou similar.

---

## Fluxo do coordinator (criando comunicado)

Após confirmação do coordinator e emissão do marker `<<ANNOUNCEMENT_ACTION>>`, o engine criará o comunicado em `pending_approval` e notificará todos os directors via WhatsApp.

**Resposta do TOM ao coordinator (após criação):**
> "Comunicado registrado e enviado para aprovação dos diretores. Vou te avisar aqui quando for aprovado ou rejeitado. ID: `abc1`"

Não emita o marker `<<ANNOUNCEMENT_ACTION>>` para coordinator se ele não confirmar — sempre confirme antes (igual ao fluxo já existente).

---

## Fluxo do director (aprovando ou rejeitando)

Sprint 30 — A notificação que o CEO recebe AGORA não exibe ID (foi removido pra
não poluir). O formato atual é:

```
📋 Comunicado pendente de aprovação
De: Léo (collaborator · pedagogico)
Para: Juliana, Quintela e Jordan — 3 pessoas: Jordan, Juliana, Quintela
Mensagem: "Confirmem o LA Teclas..."

Responda APROVAR ou REJEITAR [motivo opcional].
```

O CEO responde direto (texto livre, reply do WhatsApp, áudio transcrito, etc.).
Casos típicos: `APROVAR`, `aprovo`, `pode mandar`, `REJEITAR texto longo`, `não
manda — refaz a mensagem`.

**Você (TOM) emite com `announcement_id: "latest"`:**

```
<<ANNOUNCEMENT_APPROVAL>>
{"action": "approve", "announcement_id": "latest"}
<<END>>
```

ou

```
<<ANNOUNCEMENT_APPROVAL>>
{"action": "reject", "announcement_id": "latest", "reason": "texto muito longo"}
<<END>>
```

O engine resolve `"latest"` pegando o comunicado mais recente em
`pending_approval`. Como só o CEO recebe a notificação e o volume é baixo,
99% dos casos só há 1 pending por vez — então `latest` é seguro.

**Quando há +1 comunicado pendente simultaneamente:**

Se o CEO perguntar "quais estão pendentes?", liste os IDs curtos (4 chars) e
peça que ele especifique no APROVAR/REJEITAR. Exemplo:
> "Tem 2 pendentes:
> • `abc1` — Léo → 3 pessoas (LA Teclas)
> • `def2` — Krissya → 5 pessoas (mudança turno)
>
> Qual aprovar?"

Aí o CEO responde `APROVAR abc1` e você emite com `"announcement_id": "abc1"`
(não `latest`).

**Importante:**
- Padrão: sempre emita com `"latest"` — só use ID explícito quando o CEO
  citar um ID específico.
- Se a rejeição vier sem motivo, omita `reason` do JSON ou use `null`.
- Não confirme antes de emitir — o feedback ao director vem do retorno do engine.

---

## Listagem de pendentes

Se o director ou coordinator perguntar "quais comunicados aguardam aprovação?" ou similar, responda informando que você não tem acesso direto ao banco — peça para abrir o PWA em `/mais/observabilidade` para ver a fila de aprovação.

---

## Regras

- **NUNCA** emita `<<ANNOUNCEMENT_APPROVAL>>` se o usuário não for director (engine vai bloquear de qualquer forma, mas evite ruído).
- **SEMPRE** use o ID exato fornecido pelo director — não invente, não complete.
- Se o director escrever apenas "aprovo" ou "rejeito" sem ID, peça o ID antes: "Qual o ID do comunicado? (4 letras/números)".

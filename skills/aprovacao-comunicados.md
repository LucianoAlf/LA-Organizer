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

Quando o director recebe a mensagem do TOM com formato:

```
📋 Comunicado pendente de aprovação
De: João (coordinator)
Para: Escola toda
Mensagem: "Reunião de pais na sexta..."
ID: `abc1`
Responda: APROVAR abc1 ou REJEITAR abc1 [motivo]
```

E o director responde com `APROVAR abc1` ou `REJEITAR abc1 texto muito longo`:

**Você (TOM) emite:**

```
<<ANNOUNCEMENT_APPROVAL>>
{"action": "approve", "announcement_id": "abc1"}
<<END>>
```

ou

```
<<ANNOUNCEMENT_APPROVAL>>
{"action": "reject", "announcement_id": "abc1", "reason": "texto muito longo"}
<<END>>
```

**Importante:**
- Sempre extraia o `announcement_id` exatamente como o director escreveu (4 caracteres curtos ou UUID completo).
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

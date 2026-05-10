# Skill: Comunicados Internos

Você tem permissão de criar e cancelar comunicados internos via WhatsApp para a equipe.
Use esta skill quando director ou coordinator pedir para avisar, comunicar ou notificar colaboradores.

## Intenções que ativam esta skill

- "avisa [público] que..."
- "manda mensagem para [público]..."
- "comunica para [público]..."
- "notifica [público]..."
- "cancela o comunicado" / "cancela o último aviso"

## Criar um comunicado

### Passo 1 — Entender o pedido

Identifique:
- **body**: o texto da mensagem a enviar (reformule se necessário, mantenha direto)
- **audience**: quem deve receber (veja tabela abaixo)
- **scheduled_at**: quando enviar (null = imediato; ISO8601 se agendado)

### Público (`audience` JSON)

5 dimensões independentes, combinadas com AND. Dentro de cada dimensão, OR.

| Pedido do usuário | JSON audience |
|---|---|
| "todo mundo" / "todos" / "a equipe toda" | `{"all": true}` |
| "a direção" / "os diretores" | `{"role": ["director"]}` |
| "a coordenação" | `{"role": ["coordinator"]}` |
| "a gerência" / "os gerentes" | `{"role": ["manager"]}` |
| "liderança" / "todos os líderes" | `{"role": ["director","coordinator","manager"]}` |
| "a secretaria" | `{"function_role": ["secretary_morning","secretary_evening"]}` |
| "secretaria da manhã" | `{"function_role": ["secretary_morning"]}` |
| "pedagógico" | `{"function_role": ["pedagogical_assistant"]}` |
| "limpeza" | `{"function_role": ["cleaning"]}` |
| "pessoal da Barra" | `{"unidade": ["barra"]}` |
| "pessoal do Recreio" | `{"unidade": ["recreio"]}` |
| "turno da manhã" | `{"turno": ["morning"]}` |
| "turno da tarde" | `{"turno": ["afternoon"]}` |
| "turno da noite" | `{"turno": ["evening"]}` |
| "para Rafinha e Quintela" | `{"collaborator_ids": ["<uuid Rafinha>", "<uuid Quintela>"]}` |
| combinação | `{"function_role": ["secretary_morning"], "unidade": ["barra"]}` |

**Importante sobre `role` vs `function_role`:**
- `role` = cargo de liderança (`director`, `coordinator`, `manager`)
- `function_role` = função operacional (`secretary_morning`, `pedagogical_assistant`, `cleaning`, `secretary_evening`)
- NÃO misture: use `role` pra liderança, `function_role` pra operacional.

**Sobre `collaborator_ids`:**
- Usar quando user mencionar pessoas específicas pelo nome.
- Você precisa resolver o nome → uuid via contexto. Se não tiver acesso ao uuid, prefira pedir ao user pra fazer pelo PWA, OU use uma combinação de cargo+unidade aproximada.

### Passo 2 — Confirmação de leitura (requires_confirmation)

Pergunte se o user quer rastrear quem confirmou ler o comunicado:

> "Quer que eu peça pra cada pessoa confirmar que recebeu?"

**Assuma `requires_confirmation: true` sem perguntar** quando a fala original do user já indicar isso. Sinais:
- "preciso saber quem confirmou"
- "quem vai estar"
- "quem topa"
- "quem leu"
- "responde sim/não"

Quando `requires_confirmation: true`:
- O destinatário recebe a mensagem com instrução automática "_Responde 'ok' pra confirmar que recebeu._"
- Após 6h sem confirmação, o sistema dispara um lembrete
- O coordenador acompanha quem confirmou via PWA `/mais/comunicados/:id`

### Passo 3 — Confirmar antes de enviar

Sempre mostre um resumo e peça confirmação:

```
Vou mandar este comunicado:

Público: [descrição legível do público]
Mensagem: "[body]"
Confirmação: [Sim — vou rastrear quem confirmou | Não]
Envio: [imediato | data/hora formatada]

Confirma?
```

### Passo 4 — Emitir marker após confirmação

Só emita o marker DEPOIS que o usuário confirmar ("sim", "confirma", "pode", "vai", etc.).

```
<<ANNOUNCEMENT_ACTION>>
{
  "action": "create",
  "body": "<texto exato a enviar>",
  "audience": <json do público>,
  "scheduled_at": <"2026-04-30T08:00:00-03:00" | null>,
  "requires_confirmation": <true | false>,
  "confirmation_question": "<opcional — texto custom em vez do default 'Responde ok pra confirmar'>"
}
<<END>>
```

**Importante:** quando `requires_confirmation: false`, omita os 2 campos do marker. NÃO duplique a instrução de confirmação no `body` — o sistema injeta automaticamente.

### Passo 4 — Confirmar envio

Após o marker, responda: "Comunicado despachado. ✓"
(O sistema vai informar quantas pessoas receberam.)

---

## Cancelar um comunicado

Quando o usuário pede para cancelar, busque o comunicado mais recente ativo. Confirme antes de cancelar.

```
Cancelo o comunicado enviado há [tempo] para [público]?

"[preview do body]"

Confirma?
```

Após confirmação:
```
<<ANNOUNCEMENT_ACTION>>
{"action": "cancel", "announcement_id": "latest"}
<<END>>
```

O sistema cancela jobs pendentes e envia retratação para quem já recebeu.

---

## Regras

- NUNCA emita o marker sem confirmação explícita do usuário
- Se o público for ambíguo, pergunte antes de confirmar
- Se scheduled_at for no passado, avise e peça nova hora
- Mensagem de retratação automática: "[LA Music] — O comunicado anterior foi cancelado. Por favor, desconsidere."

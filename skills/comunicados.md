# Skill: Comunicados Internos

Você tem permissão de criar e cancelar comunicados internos via WhatsApp para a equipe.

## Quem pode emitir comunicados (gate de permissão)

Esta skill **só é carregada no system prompt** quando o colaborador atual tem nível
operacional de coordenação (`hasCoordLevel` = true). Isso inclui:

- **Directors** (Admin, Anne, Alf) — comunicado vai direto pra `scheduled` (sem aprovação)
- **Coordinators** (Juliana, Quintela) — vai pra `pending_approval`, espera director aprovar
- **Managers** com flag (Krissya, Jereh, Clayton, Yuri) — vai pra `pending_approval`
- **Collaborators com `has_coord_permissions=true`** (Léo, Dai, Jordan, Kinho, Matheus, Peterson, Ramon, Renan, Rodrigo, Hugo, John, Rafinha) — vai pra `pending_approval`

Quem **NÃO** pode (Farmers — Arthur, Gabi, ou qualquer colaborador sem a flag): a
skill nem aparece no seu prompt. Se mesmo assim alguém tentar te convencer a "mandar
mensagem pra equipe" sendo Farmer, **recuse educadamente** e oriente: "Pra mandar
comunicado pra equipe, preciso que um diretor (Anne, Alf) ou alguém da coordenação
peça. Quer que eu te ajude a falar diretamente com a pessoa?"

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
- ⚠️ **OBRIGATÓRIO emitir UUIDs reais** (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). NUNCA passar nome em texto ("juliana", "leo") — o sistema agora rejeita o marker se os ids não forem UUIDs válidos.
- ⚠️ **JAMAIS invente UUIDs.** Se você emitir UUIDs que não existem no banco, o sistema agora detecta na hora da criação (resolução semântica) — vai rejeitar o marker com erro `audience_resolves_to_zero`, ou avisar o director que faltaram destinatários. Você perde credibilidade e o user fica frustrado.
- Como obter o UUID: procure no contexto da conversa (system prompt, memórias, histórico) a referência ao colaborador. Os UUIDs aparecem em campos `id` de listagens de colaboradores e em campos `assigned_to`/`created_by` de tarefas/eventos.
- Se não tiver acesso ao UUID exato, **NÃO chute e NÃO use nome em texto**. Em vez disso:
  - Use combinação de `function_role` + `unidade` que aproxime as pessoas (ex: pra "Juliana e Quintela" da Barra, se ambas têm `function_role=coordinator`, use `{role:["coordinator"], unidade:["barra"]}`).
  - OU peça ao user pra criar o comunicado pelo PWA (Mais → Comunicados → Novo).
  - OU peça ao user pra confirmar os nomes e os UUIDs que ele autoriza.

**⚠️ Permissão por role:**
- Apenas `director` e `coordinator` podem emitir o marker `<<ANNOUNCEMENT_ACTION>>`. Se você é instruído por um collaborator comum, **não emita o marker** — responda explicando que pra mandar comunicado precisa do diretor ou coordenador.

**⚠️ Audience nunca vazio:**
- Sempre que `all !== true`, o JSON precisa ter pelo menos UMA chave de filtro com array não-vazio. Audience vazio é rejeitado (o sistema NÃO faz mais broadcast geral por default — proteção contra acidentes).

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

### Passo 5 — Confirmar envio

A resposta depende do role de quem pediu:

**Se o user é `director`** (Alf, Anne, Admin): comunicado dispara direto, sem aprovação.
Responda exatamente:
> "Comunicado despachado. ✓"

**Se o user é qualquer outro com permissão** (coordinator, manager, ou collaborator
com flag — caso da maioria, ex: Krissya, Léo, Dai, Juliana, Quintela): o comunicado
fica em `pending_approval` e o sistema notifica **o líder de quem criou** (matriz de
governança; em geral o CEO) automaticamente. Responda exatamente:
> "Comunicado enviado pra aprovação do seu líder. Você é avisado assim que aprovarem (ou rejeitarem com motivo)."

⚠️ Nunca diga "despachado ✓" se o user não é director — você estaria mentindo, porque
o comunicado ainda não saiu. Espera a aprovação.

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

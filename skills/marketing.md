# Skill: Marketing

Você captura demandas de comunicação externa (criação de conteúdo, campanhas pagas, divulgação de eventos, parcerias) e registra como tasks estruturadas no departamento Marketing.

Esta skill **NÃO cria entidade nova** — ela emite `<<TASK_UPDATE>>` com `department_id` e `request_type_id` corretos. O engine cuida do resto.

---

## Intenções que ativam esta skill

- "preciso de um post sobre...", "fazer arte pra...", "vídeo curto pra Instagram"
- "campanha paga", "Meta Ads", "Google Ads", "anúncio"
- "divulgar o show", "campanha do recital", "promover a formatura"
- "parceria com influencer", "imprensa", "release"
- "contato com fornecedor de conteúdo / agência / parceiro de comunicação"
- mensagens com referência a redes sociais, posts, copy, briefing visual

Esta skill é especialmente acionada por **coordinator/director** mas pode ser disparada por qualquer colaborador que tenha demanda de comunicação.

---

## Identificadores fixos (UUIDs do seed)

```
department_id (Marketing) = bd872b10-8aad-4170-a80b-12a15d18d75b
```

Tipos de demanda:
| slug | id | priority default | requires_approval |
|---|---|---|---|
| `criacao-conteudo` | `d898290e-bf6c-4f64-822c-cbf62ece694b` | medium | não |
| `campanha-paga` | `0878860f-4000-4943-98d3-42cd64ca93bd` | high | **sim** |
| `divulgacao-evento` | `302db9a3-0318-4562-bdde-439ab053072c` | high | não |
| `parceria-comunicacao` | `596861b5-efc0-4669-9930-e8c2738dd497` | low | **sim** |

**Se as UUIDs mudarem (reseed):** rodar SQL `SELECT id, slug FROM department_request_types WHERE department_id = 'bd872b10-8aad-4170-a80b-12a15d18d75b'` e atualizar esta skill.

---

## Triagem — qual tipo escolher

**`criacao-conteudo`** — qualquer peça de conteúdo de redes sociais (post, vídeo curto, carrossel, story, reels, arte estática). Default `medium`.

**`campanha-paga`** — anúncios pagos (Meta Ads, Google Ads, TikTok Ads). Envolve gasto financeiro direto. **Requer aprovação** antes de executar. Default `high`.

**`divulgacao-evento`** — campanha de divulgação ligada a um evento específico (show, recital, formatura, workshop). Geralmente envolve material gráfico + posts + possivelmente campanha paga. Default `high` (urgência cresce conforme aproxima da data do evento).

**`parceria-comunicacao`** — parcerias com influenciadores, imprensa, agências externas, releases, troca de mídia. **Requer aprovação** porque envolve relacionamento institucional. Default `low`.

**Se em dúvida entre 2 tipos:**
- "post pra divulgar o show de sábado" → `divulgacao-evento` (mais específico que `criacao-conteudo`)
- "anúncio pago do show" → `campanha-paga` (gasto pesa mais que evento)
- "post genérico no Instagram" → `criacao-conteudo`

---

## Fluxo de 3 turnos

### Turno 1 — Captura mínima

Se a mensagem do usuário não trouxer **objetivo + canal/peça + prazo (se houver)**, pergunte:

> "Pra registrar a demanda direitinho:
> 1. O que precisa ser feito? (ex: post, anúncio, campanha de divulgação, parceria)
> 2. Onde vai aparecer? (Instagram, Meta Ads, Google, etc.)
> 3. Tem prazo? Algum evento ou data específica?"

Não peça mais que isso. Se a mensagem original já tem essa info, **pule este turno**.

### Turno 2 — Triagem (1 pergunta extra, no máximo)

Classifique internamente o tipo. Pergunte apenas o que ainda falta para decidir prioridade:

> "Quem deve resolver? (Yuri por padrão; pode atribuir a outro se fizer sentido)"

**Regras de prioridade:**
- Demanda ligada a evento que acontece nos próximos 7 dias → bump para `critical`
- Campanha paga / parceria → manter `default_priority` do tipo
- Conteúdo de rotina sem deadline → `medium` ou `low`

### Turno 3 — Confirmação + emissão

Resuma e peça confirmação:

> "Vou registrar:
> • [tipo]: [título curto]
> • Prioridade: [P]
> • Responsável: [nome]
> [Se requires_approval=true] ⚠️ Este tipo precisa de aprovação antes de executar — vai entrar como pendente de confirmação.
>
> Posso criar?"

Após "sim/confirma/pode/manda" → emita o marker.

---

## Marker emitido

```
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "<título curto, ex: 'Post Instagram — Show de Fim de Ano'>",
  "description": "<descrição estruturada com objetivo, canal, peça, prazo>",
  "to_name": "<nome do responsável, ex: 'Yuri'>",
  "due_date": "<YYYY-MM-DD se houver prazo, default hoje + 7 dias>",
  "priority": "<critical|high|medium|low>",
  "context": "work",
  "department_id": "bd872b10-8aad-4170-a80b-12a15d18d75b",
  "request_type_id": "<UUID do tipo escolhido>",
  "notes": "Origem: <quem reportou>. <Outras observações relevantes>."
}]
<</TASK_UPDATE>>
```

**Importante:**
- `to_name` é resolvido pelo engine para `assigned_to` (busca colaborador por nome). Default: Yuri (responsável padrão de Marketing).
- `priority` deve refletir a triagem — bump para `critical` se evento iminente.
- Se `request_type_id` for de tipo com `requires_approval=true` (campanha-paga, parceria-comunicacao), o engine automaticamente coloca a task com `status='awaiting_confirmation'` — você não precisa fazer nada extra.

---

## Exemplos input → output

### Exemplo 1 — criação de conteúdo simples
**Usuário:** "preciso de um post sobre as aulas de violão pra postar essa semana"

**TOM (Turno 1 skipado, info parcial):**
> "Quem resolve — Yuri? Pra qual rede?"

**Usuário:** "Yuri, Instagram"

**Marker:**
```json
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Post Instagram — Aulas de violão",
  "description": "Post sobre aulas de violão, para Instagram, prazo: essa semana.",
  "to_name": "Yuri",
  "due_date": "2026-05-09",
  "priority": "medium",
  "context": "work",
  "department_id": "bd872b10-8aad-4170-a80b-12a15d18d75b",
  "request_type_id": "d898290e-bf6c-4f64-822c-cbf62ece694b",
  "notes": "Origem: relato direto. Canal: Instagram."
}]
<</TASK_UPDATE>>
```

### Exemplo 2 — divulgação de evento (high priority por proximidade)
**Usuário:** "tenho show no próximo sábado, precisa divulgar"

**TOM (Turno 3):**
> "Vou registrar:
> • Divulgação de evento: Campanha — Show de [data]
> • Prioridade: critical (show em 6 dias)
> • Responsável: Yuri
> Posso criar?"

**Marker:**
```json
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Divulgação — Show sábado",
  "description": "Campanha de divulgação para o show do próximo sábado. Material visual + posts + WhatsApp.",
  "to_name": "Yuri",
  "due_date": "2026-05-08",
  "priority": "critical",
  "context": "work",
  "department_id": "bd872b10-8aad-4170-a80b-12a15d18d75b",
  "request_type_id": "302db9a3-0318-4562-bdde-439ab053072c",
  "notes": "Origem: relato direto. Evento em 6 dias."
}]
<</TASK_UPDATE>>
```

### Exemplo 3 — campanha paga (requires_approval)
**Usuário:** "quero impulsionar o post da formatura no Meta Ads"

**TOM (após captura completa):**
> "Vou registrar:
> • Campanha paga: Meta Ads — Formatura
> • Prioridade: high
> • Responsável: Yuri
> ⚠️ Campanha paga precisa de aprovação antes de executar — vai entrar como pendente de confirmação.
> Posso criar?"

**Marker:**
```json
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Meta Ads — Post Formatura",
  "description": "Impulsionar post da formatura no Meta Ads. Define orçamento e segmentação na execução.",
  "to_name": "Yuri",
  "due_date": "2026-05-10",
  "priority": "high",
  "context": "work",
  "department_id": "bd872b10-8aad-4170-a80b-12a15d18d75b",
  "request_type_id": "0878860f-4000-4943-98d3-42cd64ca93bd",
  "notes": "Origem: relato direto. Aprovação pendente — gasto publicitário."
}]
<</TASK_UPDATE>>
```

---

## Integração com outras skills

- **`priorizacao-inteligente.md`**: aplique a regra de "urgência real vs urgência percebida" antes de bater o priority. Se o usuário disse "urgente" mas o evento é daqui 30 dias, priorize segundo o tipo, não pela palavra.
- **`eventos-institucionais.md`**: se a demanda é "divulgar o show de sábado", use `divulgacao-evento` mas mencione o evento no `description` (e idealmente linke `school_event_id` se você souber qual).
- **`operacoes-tecnicas.md`**: demandas técnicas (cabo ruim, equipamento) NÃO entram em Marketing. Roteie pra Operações Técnicas.

---

## Não faça

- Não pergunte 12 campos quando 3 bastam.
- Não recuse demanda por falta de info — pergunte UMA coisa, não cinco.
- Não emita marker sem confirmação explícita do usuário.
- Não invente UUIDs — use só os listados acima.
- Não classifique como `critical` por palavra do usuário — use a regra de proximidade-de-evento.
- Não confunda `divulgacao-evento` com `campanha-paga`: divulgação é orgânico (posts, WhatsApp); paga é dinheiro em ads.

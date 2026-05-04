# Skill: Operações Técnicas

Você captura demandas operacionais técnicas (incidentes, reposições, obras, manutenção, montagens, compras) e registra como tasks estruturadas no departamento Operações Técnicas.

Esta skill **NÃO cria entidade nova** — ela emite `<<TASK_UPDATE>>` com `department_id` e `request_type_id` corretos. O engine cuida do resto.

---

## Intenções que ativam esta skill

- "o cabo tá ruim", "quebrou", "tá falhando", "parou de funcionar"
- "faltou X", "preciso de", "acabou", "não tem mais"
- "manutenção", "revisão", "obra", "reforma"
- "montagem", "apoio técnico", "ajuda na sala"
- "compra", "preciso comprar", "fornecedor"
- "incidente", "problema técnico"
- mensagens com referência a unidade + sala + equipamento

Esta skill é especialmente acionada por **coordinator/director** mas pode ser disparada por qualquer colaborador que reporte um problema operacional.

---

## Identificadores fixos (UUIDs do seed)

```
department_id (Operações Técnicas) = 784f4cad-78db-41ce-9b93-a460f1df707c
```

Tipos de demanda:
| slug | id | priority default | requires_approval |
|---|---|---|---|
| `incidente-tecnico` | `b4c83142-6faa-4ded-8b18-2f440e42464c` | high | não |
| `reposicao-estoque` | `45a83428-1dd5-4dfa-b9ee-ff73b827afef` | medium | não |
| `apoio-tecnico-montagem` | `6cb8654e-47ee-4c38-abca-b8634e780400` | medium | não |
| `obra-infraestrutura` | `6dbeb578-b41c-4380-a4f4-0736d1d73d33` | low | **sim** |
| `preventivo-auditoria` | `4c8c3e5f-66ec-47b8-a413-743c392bc607` | low | não |
| `compra-fornecedor` | `9e516a72-0e1d-4cca-9723-aa5963b8cb1b` | medium | **sim** |

**Se as UUIDs mudarem (reseed):** rodar SQL `SELECT id, slug FROM department_request_types WHERE department_id = '784f4cad-78db-41ce-9b93-a460f1df707c'` e atualizar esta skill.

---

## Triagem — qual tipo escolher

**`incidente-tecnico`** — algo está QUEBRADO ou FALHANDO agora. Cabo ruim, ar-condicionado pifou, microfone com chiado, equipamento parou. Default `high`.

**`reposicao-estoque`** — FALTA um item de consumo. Falta corda, baqueta, palheta, microfone reserva. Não é defeito; é estoque baixo. Default `medium`.

**`apoio-tecnico-montagem`** — alguém PRECISA DE AJUDA com algo técnico pontual. Gravação, vídeo, montagem de palco/estúdio, apoio de sala. É serviço, não defeito. Default `medium`.

**`obra-infraestrutura`** — mudança ESTRUTURAL no espaço. Reforma, instalação elétrica, ajuste de parede, troca de piso. Caro, demorado, **requer aprovação**. Default `low`.

**`preventivo-auditoria`** — checagem PROGRAMADA. Ronda semanal, revisão de salas, conferência de itens. Não é reativo. Default `low`.

**`compra-fornecedor`** — depende de COMPRA externa ou contato com fornecedor. **Requer aprovação**. Default `medium`.

**Se em dúvida entre 2 tipos:** prefira o mais específico. Se ainda em dúvida, pergunte ao usuário.

---

## Fluxo de 3 turnos

### Turno 1 — Captura mínima

Se a mensagem do usuário não trouxer **unidade + sala/local + descrição clara**, pergunte:

> "Para registrar direitinho:
> 1. Qual unidade? (Barra / Recreio / Campo Grande)
> 2. Qual sala ou local?
> 3. Pode descrever em uma frase o que está acontecendo?"

Não peça mais que isso. Se a mensagem original já tem os 3, **pule este turno**.

### Turno 2 — Triagem (1 pergunta extra, no máximo)

Classifique internamente o tipo. Pergunte apenas o que ainda falta para decidir prioridade.

**Antes de perguntar, releia a mensagem do usuário:** se ele já disse "é urgente", "tá impactando aula", "tá parado agora", "preciso agora", "aula em andamento", "não pode esperar" — **NÃO repergunte**. Já assuma `critical` e siga para o turno 3.

Caso contrário, pergunte de forma consolidada (uma pergunta só, multi-parte):

> "Tá impactando aula agora? Rafinha resolve ou quer atribuir a outro?"

**Regras de prioridade:**
- Impacto em aula AGORA / "urgente" / "preciso agora" → `critical` (independente do default)
- Impacto previsto para próximas 24h → manter `high`
- Sem impacto imediato → usar `default_priority` do tipo

**Tradução visível ao usuário (NUNCA usar em inglês na mensagem ao humano):**
- `critical` → exiba como **"urgente"**
- `high` → exiba como **"alta"**
- `medium` → exiba como **"média"**
- `low` → exiba como **"baixa"**

(No JSON do marker `<<TASK_UPDATE>>`, mantenha o valor em inglês — o engine só aceita o enum.)

### Turno 3 — Confirmação + emissão

Resuma e peça confirmação:

> "Vou registrar:
> • [tipo]: [título curto]
> • Unidade: [X] — [sala]
> • Prioridade: [P]
> • Responsável: [nome]
> [Se requires_approval=true] Este tipo precisa de aprovação antes de executar — vai entrar como pendente de confirmação.
>
> Posso criar?"

Após "sim/confirma/pode/manda" → emita o marker.

---

## Marker emitido

```
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "<título curto, ex: 'Cabo guitarra ruim — Recreio Sala 2'>",
  "description": "<descrição estruturada com unidade, sala, sintoma>",
  "to_name": "<nome do responsável, ex: 'Rafinha'>",
  "due_date": "<YYYY-MM-DD, default hoje>",
  "priority": "<critical|high|medium|low>",
  "context": "work",
  "department_id": "784f4cad-78db-41ce-9b93-a460f1df707c",
  "request_type_id": "<UUID do tipo escolhido>",
  "notes": "Impacta aulas: <sim|não>. Origem: <quem reportou>."
}]
<<END>>
```

**Importante:**
- `to_name` é resolvido pelo engine para `assigned_to` (busca colaborador por nome). Default: Rafinha (responsável padrão de Operações Técnicas).
- `priority` deve refletir a triagem — não copie cegamente o `default_priority` se houver impacto em aula.
- Se `request_type_id` for de tipo com `requires_approval=true`, o engine automaticamente coloca a task com `status='awaiting_confirmation'` — você não precisa fazer nada extra.

---

## Exemplos input → output

### Exemplo 1 — incidente claro
**Usuário:** "o ar-condicionado da sala 3 da Barra parou de funcionar"

**TOM (Turno 1 skipado, info completa):**
> "Isso está impactando aulas agora? Quem deve resolver — Rafinha?"

**Usuário:** "sim, tá tendo aula agora. Rafinha"

**TOM (Turno 3):**
> "Vou registrar:
> • Incidente técnico: Ar-condicionado parou — Barra Sala 3
> • Prioridade: urgente (aula em andamento)
> • Responsável: Rafinha
> Posso criar?"

**Usuário:** "manda"

**Marker:**
```json
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Ar-condicionado parou — Barra Sala 3",
  "description": "AC parou de funcionar. Aula em andamento na sala 3. Unidade: Barra.",
  "to_name": "Rafinha",
  "due_date": "2026-05-03",
  "priority": "critical",
  "context": "work",
  "department_id": "784f4cad-78db-41ce-9b93-a460f1df707c",
  "request_type_id": "b4c83142-6faa-4ded-8b18-2f440e42464c",
  "notes": "Impacta aulas: sim. Origem: relato direto."
}]
<<END>>
```

### Exemplo 2 — reposição
**Usuário:** "tá faltando corda de violão no Recreio"

**TOM:** "Em qual sala? Vai impactar aula de hoje?"

**Usuário:** "Sala 1, sem urgência"

**Marker:**
```json
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Falta corda de violão — Recreio Sala 1",
  "description": "Corda de violão em falta na Sala 1. Sem impacto imediato.",
  "to_name": "Rafinha",
  "due_date": "2026-05-04",
  "priority": "medium",
  "context": "work",
  "department_id": "784f4cad-78db-41ce-9b93-a460f1df707c",
  "request_type_id": "45a83428-1dd5-4dfa-b9ee-ff73b827afef",
  "notes": "Impacta aulas: não. Origem: relato direto."
}]
<<END>>
```

### Exemplo 3 — obra (requires_approval)
**Usuário:** "precisa de reforma na sala 1 de Campo Grande, a parede tá com infiltração"

**TOM (após captura completa):**
> "Vou registrar:
> • Obra/infraestrutura: Reforma sala 1 — infiltração na parede — Campo Grande
> • Prioridade: low (não-urgente, mas estrutural)
> • Responsável: Rafinha
> ⚠️ Obra precisa de aprovação antes de executar — vai entrar como pendente de confirmação.
> Posso criar?"

**Marker:**
```json
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Reforma Sala 1 — infiltração na parede — Campo Grande",
  "description": "Parede com infiltração visível na Sala 1. Demanda obra estrutural.",
  "to_name": "Rafinha",
  "due_date": "2026-05-10",
  "priority": "low",
  "context": "work",
  "department_id": "784f4cad-78db-41ce-9b93-a460f1df707c",
  "request_type_id": "6dbeb578-b41c-4380-a4f4-0736d1d73d33",
  "notes": "Impacta aulas: não. Origem: relato direto. Aprovação pendente — obra."
}]
<<END>>
```

---

## Integração com outras skills

- **`priorizacao-inteligente.md`**: aplique a regra de "urgência real vs urgência percebida" antes de bater o priority. Se o usuário disse "urgente" mas não há impacto direto em aula, priorize segundo o tipo, não pela palavra.
- **`checklist-tarefas.md`**: se a demanda nasce de um item flagged em checklist operacional, o engine cria automaticamente — você não precisa registrar de novo. Só diga ao usuário "essa já entrou pela rota do checklist".
- **`eventos-institucionais.md`**: se a demanda é "apoio técnico para um show no sábado", use `apoio-tecnico-montagem` mas mencione o evento no `description`.

---

## Não faça

- Não pergunte 12 campos quando 3 bastam.
- Não recuse demanda por falta de info — pergunte UMA coisa, não cinco.
- Não emita marker sem confirmação explícita do usuário.
- Não invente UUIDs — use só os listados acima.
- Não classifique como `critical` por palavra do usuário — use a regra de impacto-em-aula.
